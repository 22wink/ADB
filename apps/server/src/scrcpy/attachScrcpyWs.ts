import type { Server as HttpServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  MockScrcpySession,
  ScrcpySession,
  resolveScrcpyServerJar,
  type ScrcpyAdb,
  type ScrcpyMeta,
} from "./ScrcpySession.js";

const SERIAL_RE = /^[A-Za-z0-9_.:-]+$/;

type Active = {
  serial: string;
  clients: Set<WebSocket>;
  session: ScrcpySession | MockScrcpySession;
  mode: "h264" | "mock";
};

/**
 * 挂载 scrcpy 镜像 WebSocket：
 * 路径 `/api/scrcpy/ws?serial=...`
 * 仅本机；前端开关打开后连接，断开或关开关即停流。
 */
export function attachScrcpyWebSocket(opts: {
  server: HttpServer;
  adb: ScrcpyAdb;
  appRoot: string;
  mock: boolean;
}) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4 * 1024 * 1024,
  });

  const active = new Map<string, Active>();
  const bootstraps = new Map<string, Promise<Active>>();

  opts.server.on("upgrade", (req, socket, head) => {
    try {
      const host = (req.headers.host || "").split(":")[0];
      if (host && host !== "127.0.0.1" && host !== "localhost") {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/api/scrcpy/ws") {
        socket.destroy();
        return;
      }

      const serial = url.searchParams.get("serial") || "";
      if (!SERIAL_RE.test(serial)) {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        void onConnection(ws, req, serial);
      });
    } catch {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
  });

  async function ensureSession(serial: string): Promise<Active> {
    const existing = active.get(serial);
    if (existing) return existing;

    const pending = bootstraps.get(serial);
    if (pending) return pending;

    const boot = (async () => {
      const jar = resolveScrcpyServerJar(opts.appRoot);
      const session = opts.mock
        ? new MockScrcpySession(serial)
        : new ScrcpySession(opts.adb, serial, jar);

      const mode: Active["mode"] = opts.mock ? "mock" : "h264";
      const entry: Active = { serial, clients: new Set(), session, mode };

      session.on("error", (err: Error) => {
        for (const c of entry.clients) {
          if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: "error", message: err.message }));
            c.close();
          }
        }
        void stopSerial(serial);
      });

      active.set(serial, entry);
      try {
        await session.start((frame, m) => {
          broadcastFrame(entry, frame, m);
        });
      } catch (err) {
        active.delete(serial);
        await session.stop().catch(() => undefined);
        throw err;
      }
      return entry;
    })();

    bootstraps.set(serial, boot);
    try {
      return await boot;
    } finally {
      bootstraps.delete(serial);
    }
  }

  async function onConnection(ws: WebSocket, _req: IncomingMessage, serial: string) {
    const sendJson = (obj: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    };

    try {
      const entry = await ensureSession(serial);
      entry.clients.add(ws);
      const meta = entry.session.getMeta();
      sendJson({
        type: "hello",
        serial,
        mode: entry.mode,
        mock: opts.mock,
        deviceName: meta?.deviceName ?? serial,
        width: meta?.width ?? 0,
        height: meta?.height ?? 0,
        codecId: meta?.codecId ?? 0,
      });

      ws.on("close", () => {
        entry.clients.delete(ws);
        if (entry.clients.size === 0) {
          void stopSerial(serial);
        }
      });

      ws.on("error", () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson({ type: "error", message });
      ws.close();
    }
  }

  function broadcastFrame(entry: Active, frame: Buffer, meta: ScrcpyMeta) {
    if (entry.mode === "mock") {
      const msg = JSON.stringify({
        type: "tick",
        t: Date.now(),
        width: meta.width,
        height: meta.height,
      });
      for (const c of entry.clients) {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
      }
      return;
    }

    const packet = Buffer.allocUnsafe(1 + frame.length);
    packet[0] = 1; // h264
    frame.copy(packet, 1);
    for (const c of entry.clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(packet, { binary: true });
      }
    }
  }

  async function stopSerial(serial: string) {
    const entry = active.get(serial);
    if (!entry) return;
    active.delete(serial);
    await entry.session.stop();
  }

  return {
    async closeAll() {
      for (const serial of [...active.keys()]) {
        await stopSerial(serial);
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
