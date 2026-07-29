import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import dotenv from "dotenv";
import { z } from "zod";
import { AdbClient, AdbError, resolveAdbPath, joinRemotePath } from "@adb-studio/adb-core";
import { DeviceStore } from "./deviceStore.js";
import { localSubnets, scanAdbPorts } from "./lanScan.js";
import { MockAdbClient, MOCK_LAN } from "./mock/MockAdbClient.js";
import { attachScrcpyWebSocket } from "./scrcpy/attachScrcpyWs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 生产包：server 与 public 同级；开发：apps/server/dist → ../public */
function resolveAppRoot(here: string): string {
  if (fs.existsSync(path.join(here, "public", "index.html"))) return here;
  if (fs.existsSync(path.join(here, "..", "public", "index.html"))) {
    return path.resolve(here, "..");
  }
  return path.resolve(here, "../../..");
}

const appRoot = resolveAppRoot(__dirname);

dotenv.config({ path: path.join(appRoot, ".env") });

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3789);
const RATE = Number(process.env.RATE_LIMIT_PER_MIN ?? 120);

/** 仅开发模式：`pnpm dev` → src/dev.ts 设置 ADB_MOCK=1；生产 start/release 永不启用 */
const MOCK =
  process.env.ADB_MOCK === "1" && process.env.NODE_ENV !== "production";

const tmpDir = path.join(appRoot, "tmp");
const shotsDir = path.join(tmpDir, "screenshots");
const uploadsDir = path.join(tmpDir, "uploads");
const dataDir = path.join(appRoot, MOCK ? "data-mock" : "data");
fs.mkdirSync(shotsDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const adb = MOCK
  ? new MockAdbClient()
  : new AdbClient(resolveAdbPath(process.env.ADB_PATH, appRoot));
const deviceStore = new DeviceStore(dataDir);

async function rememberOnlineDevices() {
  const online = await adb.devices();
  for (const d of online) {
    if (d.state !== "device" && d.state !== "unauthorized") continue;
    const isWifi = d.serial.includes(":");
    deviceStore.upsert({
      id: d.serial,
      serial: d.serial,
      model: d.model || d.product,
      address: isWifi ? d.serial : undefined,
      transport: isWifi ? "wifi" : "usb",
      touchConnected: false,
    });
  }
  return online;
}

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith(".apk")) cb(null, true);
    else cb(new Error("仅允许上传 .apk 文件"));
  },
});

const uploadAny = multer({
  dest: uploadsDir,
  limits: { fileSize: 512 * 1024 * 1024 },
});

const app = express();

// 安全响应头（本机工具；HSTS 对 http://127.0.0.1 不适用）
app.use(
  helmet({
    contentSecurityPolicy: false, // 静态页单独启用 CSP；API 返回 JSON
    crossOriginEmbedderPolicy: false,
  }),
);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  next();
});

// 仅允许本机前端
app.use(
  cors({
    origin: [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
    ],
    credentials: false,
  }),
);

app.use(
  rateLimit({
    windowMs: 60_000,
    max: RATE,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "请求过于频繁，请稍后再试" },
  }),
);

app.use(express.json({ limit: "64kb" }));

function serialOf(req: express.Request): string | undefined {
  const q = typeof req.query.serial === "string" ? req.query.serial : undefined;
  const b =
    req.body && typeof req.body.serial === "string" ? req.body.serial : undefined;
  return q || b || undefined;
}

function sendErr(res: express.Response, err: unknown) {
  if (err instanceof AdbError) {
    return res.status(400).json({ error: err.message, detail: err.detail });
  }
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: "参数校验失败", detail: err.flatten() });
  }
  const msg = err instanceof Error ? err.message : "未知错误";
  // 生产不回传堆栈
  return res.status(500).json({ error: msg });
}

app.get("/api/health", async (_req, res) => {
  try {
    const version = await adb.version();
    res.json({ ok: true, host: HOST, port: PORT, version, mock: MOCK });
  } catch (e) {
    sendErr(res, e);
  }
});

app.get("/api/devices", async (_req, res) => {
  try {
    const devices = await rememberOnlineDevices();
    res.json({ devices, history: deviceStore.list() });
  } catch (e) {
    sendErr(res, e);
  }
});

app.get("/api/devices/history", (_req, res) => {
  res.json({ history: deviceStore.list() });
});

app.delete("/api/devices/history/:id", (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const ok = deviceStore.remove(id);
  res.json({ ok });
});

app.get("/api/device/props", async (req, res) => {
  try {
    const props = await adb.deviceProps(serialOf(req));
    res.json({ props });
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/connect", async (req, res) => {
  try {
    const { address } = z
      .object({ address: z.string().min(3).max(80) })
      .parse(req.body);
    const result = await adb.connect(address);
    if (result.ok || /connected to/i.test(result.stdout + result.stderr)) {
      let model: string | undefined;
      let brand: string | undefined;
      try {
        const props = await adb.deviceProps(address);
        model = props["ro.product.model"];
        brand = props["ro.product.brand"];
      } catch {
        /* ignore */
      }
      deviceStore.upsert({
        id: address,
        serial: address,
        address,
        model,
        brand,
        transport: "wifi",
        touchConnected: true,
      });
    }
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/pair", async (req, res) => {
  try {
    const { address, code } = z
      .object({
        address: z.string().min(3).max(80),
        code: z.string().regex(/^\d{6}$/),
      })
      .parse(req.body);
    const result = await adb.pair(address, code);
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/disconnect", async (req, res) => {
  try {
    const { address } = z
      .object({ address: z.string().max(80).optional() })
      .parse(req.body ?? {});
    const result = await adb.disconnect(address);
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.get("/api/lan/subnets", (_req, res) => {
  if (MOCK) {
    res.json({ subnets: MOCK_LAN.subnets });
    return;
  }
  res.json({ subnets: localSubnets().map((p) => `${p}.0/24`) });
});

app.post("/api/lan/discover", async (_req, res) => {
  try {
    if (MOCK) {
      res.json(MOCK_LAN);
      return;
    }
    const [mdns, scanned] = await Promise.all([
      adb.mdnsServices().catch(() => []),
      scanAdbPorts({ ports: [5555], concurrency: 40, timeoutMs: 300 }),
    ]);

    const map = new Map<
      string,
      {
        address: string;
        host: string;
        port: number;
        source: string[];
        name?: string;
        service?: string;
      }
    >();

    for (const s of scanned) {
      map.set(s.address, {
        address: s.address,
        host: s.host,
        port: s.port,
        source: ["port-scan"],
      });
    }
    for (const m of mdns) {
      const [host, portStr] = m.address.split(":");
      const prev = map.get(m.address);
      if (prev) {
        prev.source = [...new Set([...prev.source, "mdns"])];
        prev.name = m.name;
        prev.service = m.service;
      } else {
        map.set(m.address, {
          address: m.address,
          host: host!,
          port: Number(portStr),
          source: ["mdns"],
          name: m.name,
          service: m.service,
        });
      }
    }

    res.json({
      subnets: localSubnets().map((p) => `${p}.0/24`),
      hosts: [...map.values()],
    });
  } catch (e) {
    sendErr(res, e);
  }
});

app.get("/api/packages", async (req, res) => {
  try {
    const scopeRaw = String(req.query.scope ?? "third");
    const scope = z.enum(["third", "system", "all"]).parse(scopeRaw);
    const packages = await adb.packages(serialOf(req), scope);
    res.json({ packages });
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/packages/uninstall", async (req, res) => {
  try {
    const { packageName } = z
      .object({ packageName: z.string(), serial: z.string().optional() })
      .parse(req.body);
    const result = await adb.uninstall(serialOf(req), packageName);
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/packages/launch", async (req, res) => {
  try {
    const { packageName } = z
      .object({ packageName: z.string(), serial: z.string().optional() })
      .parse(req.body);
    const result = await adb.launch(serialOf(req), packageName);
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/packages/force-stop", async (req, res) => {
  try {
    const { packageName } = z
      .object({ packageName: z.string(), serial: z.string().optional() })
      .parse(req.body);
    const result = await adb.forceStop(serialOf(req), packageName);
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/packages/clear", async (req, res) => {
  try {
    const { packageName } = z
      .object({ packageName: z.string(), serial: z.string().optional() })
      .parse(req.body);
    const result = await adb.clearData(serialOf(req), packageName);
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/install", upload.single("apk"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "未上传 APK" });
    const mode = z
      .enum(["normal", "replace", "clean"])
      .catch("replace")
      .parse(req.body?.mode ?? req.query.mode ?? "replace");
    const packageName =
      typeof req.body?.packageName === "string" && req.body.packageName.trim()
        ? req.body.packageName.trim()
        : typeof req.query.packageName === "string"
          ? req.query.packageName
          : undefined;
    const apkPath = `${req.file.path}.apk`;
    fs.renameSync(req.file.path, apkPath);
    try {
      const result = await adb.install(
        serialOf(req),
        apkPath,
        mode,
        packageName,
      );
      res.json(result);
    } finally {
      try {
        fs.unlinkSync(apkPath);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/screenshot", async (req, res) => {
  try {
    const name = `shot-${Date.now()}.png`;
    const local = path.join(shotsDir, name);
    await adb.screenshot(serialOf(req), local);
    res.json({ ok: true, url: `/api/screenshots/${name}` });
  } catch (e) {
    sendErr(res, e);
  }
});

app.get("/api/screenshots/:name", (req, res) => {
  const name = req.params.name;
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    return res.status(400).json({ error: "非法文件名" });
  }
  const file = path.join(shotsDir, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "不存在" });
  res.sendFile(file);
});

app.get("/api/logcat", async (req, res) => {
  try {
    const lines = Number(req.query.lines ?? 200);
    const text = await adb.logcat(serialOf(req), { lines });
    // 不做敏感内容存储；仅返回文本（日志可能含用户数据，仅本机）
    res.type("text/plain").send(text);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/logcat/clear", async (req, res) => {
  try {
    const result = await adb.clearLogcat(serialOf(req));
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/reboot", async (req, res) => {
  try {
    const { mode } = z
      .object({
        mode: z.enum(["system", "bootloader"]).default("system"),
        serial: z.string().optional(),
      })
      .parse(req.body ?? {});
    const result =
      mode === "bootloader"
        ? await adb.rebootBootloader(serialOf(req))
        : await adb.reboot(serialOf(req));
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/input/key", async (req, res) => {
  try {
    const { keycode } = z
      .object({ keycode: z.string(), serial: z.string().optional() })
      .parse(req.body);
    const result = await adb.inputKey(serialOf(req), keycode);
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/input/text", async (req, res) => {
  try {
    const { text } = z
      .object({ text: z.string().min(1).max(200), serial: z.string().optional() })
      .parse(req.body);
    const result = await adb.inputText(serialOf(req), text);
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.get("/api/fs/list", async (req, res) => {
  try {
    const remotePath =
      typeof req.query.path === "string" && req.query.path
        ? req.query.path
        : "/sdcard";
    const entries = await adb.listDir(serialOf(req), remotePath);
    res.json({ path: remotePath, entries });
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/fs/mkdir", async (req, res) => {
  try {
    const { path: remotePath } = z
      .object({ path: z.string().min(1).max(768), serial: z.string().optional() })
      .parse(req.body);
    const result = await adb.mkdir(serialOf(req), remotePath);
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/fs/delete", async (req, res) => {
  try {
    const { path: remotePath, recursive } = z
      .object({
        path: z.string().min(1).max(768),
        recursive: z.boolean().optional(),
        serial: z.string().optional(),
      })
      .parse(req.body);
    const result = await adb.remove(
      serialOf(req),
      remotePath,
      recursive === true,
    );
    res.json(result);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/fs/upload", uploadAny.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "未上传文件" });
    const dir =
      typeof req.body.path === "string" && req.body.path
        ? req.body.path
        : "/sdcard";
    const safeName = path
      .basename(req.file.originalname)
      .replace(/[^\w.\u4e00-\u9fff()\-+\[\]]+/g, "_");
    if (!safeName || safeName === "." || safeName === "..") {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "非法文件名" });
    }
    const remote = joinRemotePath(dir, safeName);
    const result = await adb.push(serialOf(req), req.file.path, remote);
    fs.unlinkSync(req.file.path);
    res.json({ ...result, remote });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    sendErr(res, e);
  }
});

app.get("/api/fs/download", async (req, res) => {
  const local = path.join(
    uploadsDir,
    `dl-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  try {
    const remotePath =
      typeof req.query.path === "string" ? req.query.path : "";
    if (!remotePath) return res.status(400).json({ error: "缺少 path" });
    const result = await adb.pull(serialOf(req), remotePath, local);
    if (!result.ok || !fs.existsSync(local)) {
      return res.status(400).json({
        error: "下载失败",
        detail: result.stderr || result.stdout,
      });
    }
    const filename = path.basename(remotePath);
    res.download(local, filename, (err) => {
      fs.unlink(local, () => undefined);
      if (err && !res.headersSent) sendErr(res, err);
    });
  } catch (e) {
    if (fs.existsSync(local)) fs.unlinkSync(local);
    sendErr(res, e);
  }
});

// 一体打包：托管 appRoot/public（生产包与开发构建共用）
const webCandidates = [
  path.join(appRoot, "public"),
  path.join(appRoot, "apps/web/dist"),
];
const webDist = webCandidates.find((p) => fs.existsSync(path.join(p, "index.html")));

if (webDist) {
  app.use(
    helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "blob:"],
        "media-src": ["'self'", "blob:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"],
      },
    }),
  );
  app.use(express.static(webDist, { index: false }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

// 强制只绑本机，避免局域网误暴露设备控制面
if (HOST !== "127.0.0.1" && HOST !== "localhost") {
  console.error("拒绝启动：HOST 必须为 127.0.0.1 或 localhost");
  process.exit(1);
}

const server = app.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`ADB Studio → ${url}`);
  if (webDist) console.log("前后端一体模式已启用");
  if (MOCK) console.log("Mock 模式：实时投屏为模拟画面");
  console.log("按 Ctrl+C 或关闭窗口以停止");
  if (process.env.OPEN_BROWSER !== "0") {
    import("node:child_process").then(({ exec }) => {
      exec(`start "" "${url}"`);
    });
  }
});

const scrcpyWs = attachScrcpyWebSocket({
  server,
  adb,
  appRoot,
  mock: MOCK,
});

let shuttingDown = false;
function shutdown(reason: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n正在关闭 (${reason})...`);
  void scrcpyWs.closeAll().finally(() => {
    server.close(() => {
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
  process.on(sig, () => shutdown(sig));
}