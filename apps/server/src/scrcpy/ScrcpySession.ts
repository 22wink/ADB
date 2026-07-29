import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { AdbError } from "@adb-studio/adb-core";

/** 与 AdbClient / MockAdbClient 对齐的最小接口 */
export type ScrcpyAdb = {
  push(serial: string | undefined, localPath: string, remotePath: string): Promise<{ ok: boolean; stderr: string }>;
  forward(serial: string | undefined, local: string, remote: string): Promise<{ ok: boolean; stderr: string }>;
  removeForward(serial: string | undefined, local: string): Promise<{ ok: boolean; stderr: string }>;
  spawnLongRunning(args: string[]): ChildProcess;
  argsWithSerial(serial: string | undefined, args: string[]): string[]
};

export type ScrcpyMeta = {
  deviceName: string;
  codecId: number;
  width: number;
  height: number;
};

type FrameHandler = (frame: Buffer, meta: ScrcpyMeta) => void;

const REMOTE_JAR = "/data/local/tmp/adb_studio_scrcpy_server.jar";
const ABSTRACT = "localabstract:scrcpy";
const SCRCPY_VERSION = "2.7";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function readUInt32BE(buf: Buffer, offset: number) {
  return buf.readUInt32BE(offset);
}

function readUInt64BE(buf: Buffer, offset: number) {
  const hi = buf.readUInt32BE(offset);
  const lo = buf.readUInt32BE(offset + 4);
  return hi * 0x1_0000_0000 + lo;
}

/** 从 TCP 缓冲流中按长度读取 */
class ByteReader {
  private buf = Buffer.alloc(0);
  private waiters: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void }[] =
    [];

  push(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    this.flush();
  }

  end(err?: Error) {
    for (const w of this.waiters.splice(0)) {
      w.reject(err ?? new Error("socket closed"));
    }
  }

  readExact(n: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ n, resolve, reject });
      this.flush();
    });
  }

  private flush() {
    while (this.waiters.length && this.buf.length >= this.waiters[0]!.n) {
      const w = this.waiters.shift()!;
      const out = this.buf.subarray(0, w.n);
      this.buf = this.buf.subarray(w.n);
      w.resolve(out);
    }
  }
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (!addr || typeof addr === "string") {
        s.close();
        reject(new Error("无法分配端口"));
        return;
      }
      const port = addr.port;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

/**
 * 单设备 scrcpy 镜像会话（video only）。
 * 使用官方 scrcpy-server + adb forward(tunnel_forward)。
 */
export class ScrcpySession extends EventEmitter {
  private child: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private localPort = 0;
  private stopped = false;
  private meta: ScrcpyMeta | null = null;

  constructor(
    private readonly adb: ScrcpyAdb,
    private readonly serial: string,
    private readonly serverJarPath: string,
  ) {
    super();
  }

  getMeta() {
    return this.meta;
  }

  async start(onFrame: FrameHandler): Promise<ScrcpyMeta> {
    if (!fs.existsSync(this.serverJarPath)) {
      throw new AdbError("缺少 scrcpy-server，请检查 vendor/scrcpy");
    }

    const push = await this.adb.push(this.serial, this.serverJarPath, REMOTE_JAR);
    if (!push.ok) throw new AdbError("推送 scrcpy-server 失败", push.stderr);

    this.localPort = await pickFreePort();
    const local = `tcp:${this.localPort}`;

    await this.adb.removeForward(this.serial, local).catch(() => undefined);
    const fwd = await this.adb.forward(this.serial, local, ABSTRACT);
    if (!fwd.ok) throw new AdbError("adb forward 失败", fwd.stderr);

    // scrcpy-server 2.7：仅视频、forward 隧道、带帧元数据
    const serverArgs = [
      SCRCPY_VERSION,
      "tunnel_forward=true",
      "audio=false",
      "control=false",
      "cleanup=true",
      "video=true",
      "max_size=1024",
      "max_fps=15",
      "video_bit_rate=2000000",
      "send_device_meta=true",
      "send_frame_meta=true",
      "send_codec_meta=true",
      "raw_stream=false",
      "power_on=true",
    ];

    const shellArgs = this.adb.argsWithSerial(this.serial, [
      "shell",
      `CLASSPATH=${REMOTE_JAR}`,
      "app_process",
      "/",
      "com.genymobile.scrcpy.Server",
      ...serverArgs,
    ]);

    this.child = this.adb.spawnLongRunning(shellArgs);
    let bootLog = "";
    this.child.stderr?.on("data", (c: Buffer) => {
      bootLog += c.toString("utf8");
      if (bootLog.length > 4000) bootLog = bootLog.slice(-2000);
    });
    this.child.stdout?.on("data", (c: Buffer) => {
      bootLog += c.toString("utf8");
    });
    this.child.on("close", (code) => {
      if (!this.stopped) {
        this.emit("error", new Error(`scrcpy-server 退出 code=${code}: ${bootLog.slice(-500)}`));
        void this.stop();
      }
    });

    // 等待 abstract socket 就绪
    await sleep(400);

    const socket = await this.connectWithRetry(this.localPort, 12);
    this.socket = socket;
    const reader = new ByteReader();
    socket.on("data", (chunk) => reader.push(chunk));
    socket.on("error", (err) => {
      reader.end(err);
      if (!this.stopped) this.emit("error", err);
    });
    socket.on("close", () => {
      reader.end();
      if (!this.stopped) void this.stop();
    });

    const nameBuf = await reader.readExact(64);
    const deviceName = nameBuf.toString("utf8").replace(/\0+$/, "") || this.serial;

    const codecBuf = await reader.readExact(12);
    const codecId = readUInt32BE(codecBuf, 0);
    const width = readUInt32BE(codecBuf, 4);
    const height = readUInt32BE(codecBuf, 8);

    this.meta = { deviceName, codecId, width, height };
    this.emit("meta", this.meta);

    void (async () => {
      try {
        while (!this.stopped) {
          const hdr = await reader.readExact(12);
          const _pts = readUInt64BE(hdr, 0);
          const size = readUInt32BE(hdr, 8);
          if (size <= 0 || size > 8_000_000) {
            throw new Error(`异常帧大小: ${size}`);
          }
          const frame = await reader.readExact(size);
          if (this.meta) onFrame(frame, this.meta);
        }
      } catch (err) {
        if (!this.stopped) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
          void this.stop();
        }
      }
    })();

    return this.meta;
  }

  private connectWithRetry(port: number, attempts: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      let left = attempts;
      const tryOnce = () => {
        const s = net.connect({ host: "127.0.0.1", port });
        s.once("connect", () => resolve(s));
        s.once("error", async () => {
          s.destroy();
          left -= 1;
          if (left <= 0) {
            reject(new Error("无法连接 scrcpy 视频端口（设备未就绪或版本不匹配）"));
            return;
          }
          await sleep(250);
          tryOnce();
        });
      };
      tryOnce();
    });
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.socket = null;
    try {
      this.child?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    this.child = null;
    if (this.localPort) {
      await this.adb
        .removeForward(this.serial, `tcp:${this.localPort}`)
        .catch(() => undefined);
    }
    this.emit("stopped");
  }
}

export function resolveScrcpyServerJar(appRoot: string): string {
  const candidates = [
    path.join(appRoot, "vendor", "scrcpy", "scrcpy-server"),
    path.join(appRoot, "apps", "server", "vendor", "scrcpy", "scrcpy-server"),
    path.join(appRoot, "..", "vendor", "scrcpy", "scrcpy-server"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

/** Mock：周期性推送 JPEG，便于无真机开发 */
export class MockScrcpySession extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private meta: ScrcpyMeta = {
    deviceName: "MockPhone",
    codecId: 0x6d6f636b,
    width: 360,
    height: 640,
  };

  constructor(private readonly serial: string) {
    super();
    this.meta = {
      deviceName: `Mock ${serial}`,
      codecId: 0x6d6f636b,
      width: 360,
      height: 640,
    };
  }

  getMeta() {
    return this.meta;
  }

  async start(onFrame: FrameHandler): Promise<ScrcpyMeta> {
    this.emit("meta", this.meta);
    this.timer = setInterval(() => {
      if (this.stopped) return;
      onFrame(Buffer.alloc(0), this.meta);
    }, 100);
    return this.meta;
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit("stopped");
  }
}
