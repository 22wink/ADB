import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** 仅允许安全字符的设备序列号（防注入） */
const SERIAL_RE = /^[A-Za-z0-9_.:-]+$/;
/** 包名白名单 */
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
/** 远程路径：禁止 shell 元字符与路径穿越 */
function assertRemotePath(p: string): string {
  const normalized = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (!normalized.startsWith("/")) {
    throw new AdbError("远端路径必须以 / 开头");
  }
  if (normalized.includes("..")) {
    throw new AdbError("禁止路径穿越");
  }
  if (/[\0\r\n;|&$`<>]/.test(normalized)) {
    throw new AdbError("非法远端路径字符");
  }
  if (normalized.length > 768) throw new AdbError("路径过长");
  if (normalized !== "/" && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

/** 文件管理仅限用户可读存储区，降低误删系统文件风险 */
const MANAGE_ROOTS = [
  /^\/sdcard(\/|$)/,
  /^\/storage(\/|$)/,
  /^\/mnt\/sdcard(\/|$)/,
  /^\/data\/local\/tmp(\/|$)/,
];

function assertManageablePath(p: string): string {
  const remote = assertRemotePath(p);
  if (!MANAGE_ROOTS.some((re) => re.test(remote))) {
    throw new AdbError(
      "仅允许管理 /sdcard、/storage、/data/local/tmp 下的文件",
    );
  }
  return remote;
}

export function joinRemotePath(base: string, name: string): string {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    /[\0\r\n;|&$`<>]/.test(name)
  ) {
    throw new AdbError("非法文件名");
  }
  if (name.length > 255) throw new AdbError("文件名过长");
  const b = assertRemotePath(base);
  return b === "/" ? `/${name}` : `${b}/${name}`;
}

export type RemoteEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mtime?: string;
};

/** 应用安装模式 */
export type InstallMode = "normal" | "replace" | "clean";

/**
 * 从 APK 二进制中启发式提取包名（不依赖 aapt）。
 * 优先匹配 package: name='...' / package="..."，否则在字符串池中挑像包名的候选。
 */
export function guessPackageNameFromApk(apkPath: string): string | undefined {
  const buf = fs.readFileSync(apkPath);
  const latin1 = buf.toString("latin1");
  const fromBadging = latin1.match(/package:\s*name='([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)'/);
  if (fromBadging?.[1] && PACKAGE_RE.test(fromBadging[1])) return fromBadging[1];
  const fromAttr = latin1.match(/package="([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)"/);
  if (fromAttr?.[1] && PACKAGE_RE.test(fromAttr[1])) return fromAttr[1];

  const re =
    /([A-Za-z][A-Za-z0-9_]{0,32}(?:\.[A-Za-z][A-Za-z0-9_]{0,32}){2,8})/g;
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  const head = latin1.slice(0, Math.min(latin1.length, 2_000_000));
  while ((m = re.exec(head))) {
    const p = m[1]!;
    if (!PACKAGE_RE.test(p)) continue;
    if (/^(java|javax|android|androidx|kotlin|dalvik|com\.android\.(internal|okhttp))/i.test(p)) {
      continue;
    }
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [p, n] of counts) {
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  return best;
}

/** 应用包信息（列表用，字段按设备能力尽力填充） */
export type PackageInfo = {
  packageName: string;
  /** 应用显示名（若设备 dumpsys 可解析） */
  label?: string;
  versionName?: string;
  versionCode?: string;
  apkPath?: string;
  dataDir?: string;
  installer?: string;
  firstInstallTime?: string;
  lastUpdateTime?: string;
  minSdk?: string;
  targetSdk?: string;
  uid?: string;
  enabled?: boolean;
  system?: boolean;
};

export type PackageScope = "third" | "system" | "all";


function sortEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
}

function parseLsNames(dir: string, stdout: string): RemoteEntry[] {
  const entries: RemoteEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw === "./" || raw === "../") continue;
    let name = raw;
    let isDir = false;
    if (name.endsWith("/")) {
      isDir = true;
      name = name.slice(0, -1);
    } else if (/[*@|=]$/.test(name)) {
      name = name.slice(0, -1);
    }
    if (!name || name === "." || name === "..") continue;
    try {
      entries.push({ name, path: joinRemotePath(dir, name), isDir });
    } catch {
      /* skip */
    }
  }
  return sortEntries(entries);
}

/** 解析 Android/toybox ls -la */
function parseLsLa(dir: string, stdout: string): RemoteEntry[] {
  const entries: RemoteEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const raw = line.trimEnd();
    if (!raw || raw.startsWith("total")) continue;
    const m = raw.match(
      /^([dl\-])[rwxsStT\-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\S+(?:\s+\S+){1,2})\s+(.+)$/,
    );
    if (!m) continue;
    const isDir = m[1] === "d";
    const size = Number(m[2]);
    const mtime = m[3];
    let name = m[4].trim();
    if (name.includes(" -> ")) name = name.split(" -> ")[0]!.trim();
    if (!name || name === "." || name === "..") continue;
    try {
      entries.push({
        name,
        path: joinRemotePath(dir, name),
        isDir,
        size: Number.isFinite(size) ? size : undefined,
        mtime,
      });
    } catch {
      /* skip */
    }
  }
  return sortEntries(entries);
}

export type AdbResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

/** 无线连接/配对失败原因（供前端区分提示） */
export type ConnectFailCode =
  | "refused"
  | "unreachable"
  | "timeout"
  | "auth"
  | "unknown";

export type ConnectFailInfo = {
  code: ConnectFailCode;
  message: string;
};

/** 是否已成功连上（adb 失败时 exit code 仍可能为 0，需看输出） */
export function isAdbConnectedOutput(text: string): boolean {
  return /(?:already\s+)?connected to\s+\S+/i.test(text);
}

/** 是否配对成功 */
export function isAdbPairedOutput(text: string): boolean {
  return /successfully\s+paired/i.test(text);
}

/**
 * 从 adb connect/pair 输出推断失败原因。
 * 注意：ADB 无「未开调试」专用错误码；Connection refused 通常即端口未监听（无线调试未开）。
 */
export function classifyConnectFailure(text: string): ConnectFailInfo {
  const t = text.toLowerCase();

  if (
    /connection refused|actively refused|econnrefused|拒绝连接|连接被拒绝/.test(
      t,
    )
  ) {
    return {
      code: "refused",
      message:
        "连接被拒绝：目标设备可能未开启「无线调试 / 网络 ADB」，或调试端口不正确",
    };
  }

  if (
    /timed?\s*out|timeout|operation timed out|连接超时|等待超时/.test(t)
  ) {
    return {
      code: "timeout",
      message:
        "连接超时：请确认设备与电脑在同一网络，且已开启无线调试",
    };
  }

  if (
    /no route to host|host (is )?unreachable|network is unreachable|name or service not known|could not resolve|无法访问|找不到主机|网络不可达/.test(
      t,
    )
  ) {
    return {
      code: "unreachable",
      message:
        "无法访问该地址：请检查 IP 是否正确、设备是否在线且与电脑同一局域网",
    };
  }

  if (
    /failed to authenticate|unauthorized|not authorized|device unauthorized|需要授权|未授权/.test(
      t,
    )
  ) {
    return {
      code: "auth",
      message:
        "设备未授权本机调试：请在手机上允许调试；Android 11+ 无线调试需先完成配对",
    };
  }

  const brief = text.replace(/\s+/g, " ").trim().slice(0, 180);
  return {
    code: "unknown",
    message: brief
      ? `连接失败：${brief}`
      : "连接失败：请确认设备已开启无线调试且地址正确",
  };
}

/** 小米/部分 OEM user 版禁止 shell 注入输入 */
export function isInjectEventsDenied(text: string): boolean {
  return /INJECT_EVENTS|Injecting input events requires/i.test(text);
}

const INJECT_EVENTS_HINT =
  "设备禁止模拟按键/输入（缺少 INJECT_EVENTS）。小米/红米请打开：设置 → 更多设置 → 开发者选项 →「USB调试（安全设置）」；开启后重连设备再试。";

function assertInputAllowed(r: AdbResult, fallbackMsg: string): void {
  const out = `${r.stdout}\n${r.stderr}`.trim();
  if (isInjectEventsDenied(out)) {
    throw new AdbError(INJECT_EVENTS_HINT, out || undefined, "inject_denied");
  }
  if (!r.ok) {
    throw new AdbError(
      out ? `${fallbackMsg}：${out.slice(0, 180)}` : fallbackMsg,
      out || undefined,
    );
  }
}

export type DeviceInfo = {
  serial: string;
  state: string;
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
};

export class AdbError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AdbError";
  }
}

/**
 * 解析 pm list packages -f -i --show-versioncode 行
 * 例: package:/data/app/.../base.apk=com.foo installer=com.android.vending versionCode:100
 * 例: package:/data/app/com.foo-xxx==/base.apk=com.foo versionCode:1  installer=null
 * 或: package:com.foo
 *
 * 注意：路径里常有 Base64 的 `==`，且行尾有 `installer=`，
 * 不能用 indexOf/lastIndexOf("=") 分割，必须按 `.apk=` 定位。
 */
function parsePmListLine(line: string): PackageInfo | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("package:")) return null;

  let rest = trimmed.slice("package:".length);
  let apkPath: string | undefined;

  const apkEq = rest.search(/\.apk=/i);
  if (apkEq >= 0) {
    apkPath = rest.slice(0, apkEq + 4);
    rest = rest.slice(apkEq + 5);
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  const packageName = tokens[0] ?? "";
  if (!PACKAGE_RE.test(packageName)) return null;

  const info: PackageInfo = { packageName, apkPath };
  for (const t of tokens.slice(1)) {
    if (t.startsWith("installer=")) {
      const v = t.slice("installer=".length);
      if (v && v !== "null") info.installer = v;
    } else if (t.startsWith("versionCode:")) {
      info.versionCode = t.slice("versionCode:".length);
    }
  }
  return info;
}

/** 从 dumpsys package packages 合并详情到已有 map */
function mergeDumpsysPackages(
  map: Map<string, PackageInfo>,
  dump: string,
  scope: PackageScope,
) {
  const blocks = dump.split(/Package \[([^\]]+)\]/g);
  // split 后: [preamble, name1, body1, name2, body2, ...]
  for (let i = 1; i < blocks.length - 1; i += 2) {
    const name = blocks[i]?.trim();
    const body = blocks[i + 1] ?? "";
    if (!name || !PACKAGE_RE.test(name)) continue;

    const isSystem =
      /\bflags=\[([^\]]*)\]/.test(body) &&
      /\bSYSTEM\b/.test(body.match(/\bflags=\[([^\]]*)\]/)?.[1] ?? "");

    if (scope === "third" && !map.has(name)) continue;
    if (scope === "system" && !map.has(name)) continue;

    const cur = map.get(name) ?? { packageName: name };
    const pick = (re: RegExp) => body.match(re)?.[1]?.trim();

    const versionName = pick(/\bversionName=(\S+)/);
    const versionCode = pick(/\bversionCode=(\d+)/);
    const codePath = pick(/\bcodePath=(\S+)/);
    const dataDir = pick(/\bdataDir=(\S+)/);
    const minSdk = pick(/\bminSdk=(\d+)/);
    const targetSdk = pick(/\btargetSdk=(\d+)/);
    const installer = pick(/\binstallerPackageName=(\S+)/);
    const firstInstallTime = pick(/\bfirstInstallTime=(.+)$/m);
    const lastUpdateTime = pick(/\blastUpdateTime=(.+)$/m);
    const uid = pick(/\buserId=(\d+)/) || pick(/\bappId=(\d+)/);
    const label =
      pick(/\bapplicationLabel=(.+)$/m) ||
      pick(/\bappName=(.+)$/m) ||
      pick(/\bApplication Label:\s*(.+)$/m);

    if (versionName) cur.versionName = versionName;
    if (versionCode) cur.versionCode = versionCode;
    if (codePath && !cur.apkPath) cur.apkPath = codePath;
    if (dataDir) cur.dataDir = dataDir;
    if (minSdk) cur.minSdk = minSdk;
    if (targetSdk) cur.targetSdk = targetSdk;
    if (installer && installer !== "null" && !cur.installer) {
      cur.installer = installer;
    }
    if (firstInstallTime) cur.firstInstallTime = firstInstallTime;
    if (lastUpdateTime) cur.lastUpdateTime = lastUpdateTime;
    if (uid) cur.uid = uid;
    if (label) cur.label = label.replace(/^"|"$/g, "");
    cur.system = isSystem || cur.system === true;

    const enabledMatches = [...body.matchAll(/\benabled=(\d+|true|false)/gi)];
    if (enabledMatches.length) {
      const last = enabledMatches[enabledMatches.length - 1]![1]!.toLowerCase();
      if (/^\d+$/.test(last)) {
        const n = Number(last);
        cur.enabled = n === 0 || n === 1;
      } else {
        cur.enabled = last === "true";
      }
    }

    map.set(name, cur);
  }
}

function assertSerial(serial?: string): string | undefined {
  if (serial == null || serial === "") return undefined;
  if (!SERIAL_RE.test(serial)) {
    throw new AdbError("非法设备序列号");
  }
  return serial;
}

function assertPackage(pkg: string): string {
  if (!PACKAGE_RE.test(pkg)) {
    throw new AdbError("非法应用包名");
  }
  return pkg;
}

export class AdbClient {
  constructor(private readonly adbPath: string) {
    if (!fs.existsSync(adbPath)) {
      throw new AdbError(`找不到 adb：${adbPath}`);
    }
  }

  /** 参数数组 spawn，禁止 shell 拼接（防命令注入） */
  async run(args: string[], opts?: { timeoutMs?: number }): Promise<AdbResult> {
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    return new Promise((resolve, reject) => {
      const child = spawn(this.adbPath, args, {
        shell: false,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(new AdbError("ADB 命令超时", args.join(" ")));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new AdbError("无法启动 adb", err.message));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          code,
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
        });
      });
    });
  }

  private withSerial(serial: string | undefined, args: string[]): string[] {
    const s = assertSerial(serial);
    return s ? ["-s", s, ...args] : args;
  }

  async version(): Promise<string> {
    const r = await this.run(["version"]);
    return r.stdout || r.stderr;
  }

  async devices(): Promise<DeviceInfo[]> {
    const r = await this.run(["devices", "-l"]);
    if (!r.ok) throw new AdbError("获取设备列表失败", r.stderr);
    const lines = r.stdout.split(/\r?\n/).slice(1);
    const list: DeviceInfo[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      const serial = parts[0];
      const state = parts[1] ?? "unknown";
      if (!serial || !SERIAL_RE.test(serial)) continue;
      const meta: DeviceInfo = { serial, state };
      for (const p of parts.slice(2)) {
        const [k, v] = p.split(":");
        if (k === "product") meta.product = v;
        if (k === "model") meta.model = v;
        if (k === "device") meta.device = v;
        if (k === "transport_id") meta.transportId = v;
      }
      list.push(meta);
    }
    return list;
  }

  async connect(hostPort: string): Promise<AdbResult> {
    // 仅允许 host:port
    if (!/^[A-Za-z0-9.-]+:\d{2,5}$/.test(hostPort)) {
      throw new AdbError("无线连接地址格式应为 host:port");
    }
    return this.run(["connect", hostPort], { timeoutMs: 15_000 });
  }

  async pair(hostPort: string, code: string): Promise<AdbResult> {
    if (!/^[A-Za-z0-9.-]+:\d{2,5}$/.test(hostPort)) {
      throw new AdbError("配对地址格式应为 host:port");
    }
    if (!/^\d{6}$/.test(code)) {
      throw new AdbError("配对码应为 6 位数字");
    }
    return this.run(["pair", hostPort, code], { timeoutMs: 30_000 });
  }

  async disconnect(hostPort?: string): Promise<AdbResult> {
    if (hostPort) {
      if (!/^[A-Za-z0-9.-]+:\d{2,5}$/.test(hostPort)) {
        throw new AdbError("地址格式非法");
      }
      return this.run(["disconnect", hostPort]);
    }
    return this.run(["disconnect"]);
  }

  /** 发现局域网 mDNS 无线调试服务（Android 11+） */
  async mdnsServices(): Promise<
    { name: string; service: string; address: string }[]
  > {
    const r = await this.run(["mdns", "services"], { timeoutMs: 12_000 });
    const text = r.stdout || r.stderr;
    const list: { name: string; service: string; address: string }[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /list of discovered/i.test(trimmed)) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) continue;
      const address = parts[parts.length - 1]!;
      if (!/^[A-Za-z0-9.-]+:\d{2,5}$/.test(address)) continue;
      const service = parts[parts.length - 2]!;
      const name = parts.slice(0, -2).join(" ");
      list.push({ name, service, address });
    }
    return list;
  }

  async getProp(serial: string | undefined, key: string): Promise<string> {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new AdbError("非法属性名");
    const r = await this.run(this.withSerial(serial, ["shell", "getprop", key]));
    return r.stdout.trim();
  }

  /** 一次拉取全部 getprop，避免逐项往返 */
  async getAllProps(serial?: string): Promise<Record<string, string>> {
    const r = await this.run(this.withSerial(serial, ["shell", "getprop"]), {
      timeoutMs: 30_000,
    });
    if (!r.ok && !r.stdout) {
      throw new AdbError("读取设备属性失败", r.stderr);
    }
    const out: Record<string, string> = {};
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.match(/^\[([^\]]+)\]:\s*\[(.*)\]\s*$/);
      if (!m) continue;
      const key = m[1];
      if (!/^[A-Za-z0-9._-]+$/.test(key)) continue;
      out[key] = m[2];
    }
    return out;
  }

  async deviceExtras(serial?: string): Promise<Record<string, string>> {
    const extras: Record<string, string> = {};
    const size = await this.run(
      this.withSerial(serial, ["shell", "wm", "size"]),
      { timeoutMs: 10_000 },
    );
    const density = await this.run(
      this.withSerial(serial, ["shell", "wm", "density"]),
      { timeoutMs: 10_000 },
    );
    if (size.stdout) {
      const m = size.stdout.match(/(\d+x\d+)/);
      extras["wm.size"] = m?.[1] ?? size.stdout.trim();
    }
    if (density.stdout) {
      const m = density.stdout.match(/(\d+)/);
      extras["wm.density"] = m?.[1] ?? density.stdout.trim();
    }

    const bat = await this.run(
      this.withSerial(serial, ["shell", "dumpsys", "battery"]),
      { timeoutMs: 15_000 },
    );
    if (bat.stdout) {
      const level = bat.stdout.match(/^\s*level:\s*(\d+)/m);
      const status = bat.stdout.match(/^\s*status:\s*(\d+)/m);
      const health = bat.stdout.match(/^\s*health:\s*(\d+)/m);
      const temp = bat.stdout.match(/^\s*temperature:\s*(\d+)/m);
      if (level) extras["battery.level"] = level[1] + "%";
      if (status) extras["battery.status"] = status[1];
      if (health) extras["battery.health"] = health[1];
      if (temp) extras["battery.temperature"] = (Number(temp[1]) / 10).toFixed(1) + "°C";
    }
    return extras;
  }

  async deviceProps(serial?: string): Promise<Record<string, string>> {
    const all = await this.getAllProps(serial);
    const extras = await this.deviceExtras(serial);
    return { ...all, ...extras };
  }

  async packages(
    serial?: string,
    scope: PackageScope = "third",
  ): Promise<PackageInfo[]> {
    const flag =
      scope === "third" ? "-3" : scope === "system" ? "-s" : undefined;
    const listArgs = [
      "shell",
      "pm",
      "list",
      "packages",
      ...(flag ? [flag] : []),
      "-f",
      "-i",
      "--show-versioncode",
    ];

    const listRes = await this.run(this.withSerial(serial, listArgs), {
      timeoutMs: 90_000,
    });
    if (!listRes.ok) throw new AdbError("获取应用列表失败", listRes.stderr);

    const map = new Map<string, PackageInfo>();
    for (const line of listRes.stdout.split(/\r?\n/)) {
      const parsed = parsePmListLine(line);
      if (!parsed) continue;
      map.set(parsed.packageName, {
        ...parsed,
        system: scope === "system" ? true : scope === "third" ? false : undefined,
        enabled: true,
      });
    }

    // 一次 dumpsys 补齐版本名 / 时间 / SDK / 标签等（失败则仍返回基础列表）
    try {
      const dump = await this.run(
        this.withSerial(serial, ["shell", "dumpsys", "package", "packages"]),
        { timeoutMs: 120_000 },
      );
      if (dump.ok && dump.stdout) {
        mergeDumpsysPackages(map, dump.stdout, scope);
      }
    } catch {
      /* 忽略 dumpsys 失败，保留 pm list 结果 */
    }

    return [...map.values()].sort((a, b) => {
      const la = (a.label || a.packageName).toLowerCase();
      const lb = (b.label || b.packageName).toLowerCase();
      return la.localeCompare(lb, "zh");
    });
  }


  async install(
    serial: string | undefined,
    apkPath: string,
    mode: InstallMode = "replace",
    packageName?: string,
  ): Promise<AdbResult> {
    const abs = path.resolve(apkPath);
    if (!abs.toLowerCase().endsWith(".apk") || !fs.existsSync(abs)) {
      throw new AdbError("APK 文件不存在或后缀非法");
    }

    if (mode === "clean") {
      const pkg =
        (packageName && assertPackage(packageName)) ||
        guessPackageNameFromApk(abs);
      if (!pkg) {
        throw new AdbError(
          "清空数据安装需要包名：无法从 APK 解析，请手动填写包名",
        );
      }
      // 先卸载（含用户数据）；未安装时忽略失败
      await this.run(this.withSerial(serial, ["uninstall", pkg]), {
        timeoutMs: 60_000,
      }).catch(() => undefined);
      return this.run(this.withSerial(serial, ["install", abs]), {
        timeoutMs: 180_000,
      });
    }

    if (mode === "normal") {
      return this.run(this.withSerial(serial, ["install", abs]), {
        timeoutMs: 180_000,
      });
    }

    // 覆盖安装（默认）：保留应用数据
    return this.run(this.withSerial(serial, ["install", "-r", abs]), {
      timeoutMs: 180_000,
    });
  }

  async uninstall(serial: string | undefined, pkg: string): Promise<AdbResult> {
    return this.run(this.withSerial(serial, ["uninstall", assertPackage(pkg)]));
  }

  async forceStop(serial: string | undefined, pkg: string): Promise<AdbResult> {
    return this.run(
      this.withSerial(serial, ["shell", "am", "force-stop", assertPackage(pkg)]),
    );
  }

  async clearData(serial: string | undefined, pkg: string): Promise<AdbResult> {
    return this.run(
      this.withSerial(serial, ["shell", "pm", "clear", assertPackage(pkg)]),
    );
  }

  async launch(serial: string | undefined, pkg: string): Promise<AdbResult> {
    return this.run(
      this.withSerial(serial, [
        "shell",
        "monkey",
        "-p",
        assertPackage(pkg),
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ]),
    );
  }

  async screenshot(
    serial: string | undefined,
    localPath: string,
  ): Promise<string> {
    const remote = "/sdcard/adb_studio_shot.png";
    const pullTo = path.resolve(localPath);
    fs.mkdirSync(path.dirname(pullTo), { recursive: true });

    const cap = await this.run(
      this.withSerial(serial, ["shell", "screencap", "-p", remote]),
    );
    if (!cap.ok) throw new AdbError("截图失败", cap.stderr);

    const pull = await this.run(
      this.withSerial(serial, ["pull", remote, pullTo]),
    );
    if (!pull.ok) throw new AdbError("拉取截图失败", pull.stderr);

    await this.run(this.withSerial(serial, ["shell", "rm", remote]));
    return pullTo;
  }

  async push(
    serial: string | undefined,
    localPath: string,
    remotePath: string,
  ): Promise<AdbResult> {
    const abs = path.resolve(localPath);
    if (!fs.existsSync(abs)) throw new AdbError("本地文件不存在");
    return this.run(
      this.withSerial(serial, [
        "push",
        abs,
        assertManageablePath(remotePath),
      ]),
      { timeoutMs: 180_000 },
    );
  }

  async pull(
    serial: string | undefined,
    remotePath: string,
    localPath: string,
  ): Promise<AdbResult> {
    const abs = path.resolve(localPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    return this.run(
      this.withSerial(serial, [
        "pull",
        assertManageablePath(remotePath),
        abs,
      ]),
      { timeoutMs: 180_000 },
    );
  }

  async listDir(
    serial: string | undefined,
    remotePath: string,
  ): Promise<RemoteEntry[]> {
    const dir = assertManageablePath(remotePath);
    const detailed = await this.run(
      this.withSerial(serial, ["shell", "ls", "-la", "--", dir]),
      { timeoutMs: 30_000 },
    );

    const fromDetailed = parseLsLa(dir, detailed.stdout);
    if (fromDetailed.length > 0 || detailed.ok) {
      return fromDetailed;
    }

    const plain = await this.run(
      this.withSerial(serial, ["shell", "ls", "-1p", "--", dir]),
      { timeoutMs: 30_000 },
    );
    if (!plain.ok && !plain.stdout) {
      throw new AdbError(
        "无法列出目录",
        plain.stderr || detailed.stderr || detailed.stdout,
      );
    }
    return parseLsNames(dir, plain.stdout);
  }

  async mkdir(serial: string | undefined, remotePath: string): Promise<AdbResult> {
    return this.run(
      this.withSerial(serial, [
        "shell",
        "mkdir",
        "-p",
        "--",
        assertManageablePath(remotePath),
      ]),
    );
  }

  async remove(
    serial: string | undefined,
    remotePath: string,
    recursive = false,
  ): Promise<AdbResult> {
    const target = assertManageablePath(remotePath);
    const roots = ["/sdcard", "/storage", "/mnt/sdcard", "/data/local/tmp"];
    if (roots.includes(target)) {
      throw new AdbError("禁止删除存储根目录");
    }
    const args = recursive
      ? ["shell", "rm", "-rf", "--", target]
      : ["shell", "rm", "-f", "--", target];
    return this.run(this.withSerial(serial, args));
  }

  async reboot(serial?: string): Promise<AdbResult> {
    return this.run(this.withSerial(serial, ["reboot"]));
  }

  async rebootBootloader(serial?: string): Promise<AdbResult> {
    return this.run(this.withSerial(serial, ["reboot", "bootloader"]));
  }

  async logcat(
    serial: string | undefined,
    opts?: { lines?: number },
  ): Promise<string> {
    const lines = Math.min(Math.max(opts?.lines ?? 200, 20), 2000);
    const r = await this.run(
      this.withSerial(serial, ["logcat", "-d", "-t", String(lines)]),
      { timeoutMs: 30_000 },
    );
    return r.stdout || r.stderr;
  }

  async clearLogcat(serial?: string): Promise<AdbResult> {
    return this.run(this.withSerial(serial, ["logcat", "-c"]));
  }

  /** 白名单 shell：仅允许预定义动作，禁止任意命令 */
  async inputText(serial: string | undefined, text: string): Promise<AdbResult> {
    if (text.length > 200) throw new AdbError("输入文本过长");
    // adb shell input text 对空格用 %s
    const encoded = text.replace(/ /g, "%s").replace(/['"`$\\]/g, "");
    const r = await this.run(
      this.withSerial(serial, ["shell", "input", "text", encoded]),
    );
    assertInputAllowed(r, "文本输入失败");
    return r;
  }

  async inputKey(
    serial: string | undefined,
    keycode: string,
  ): Promise<AdbResult> {
    const allowed = new Set([
      "KEYCODE_HOME",
      "KEYCODE_BACK",
      "KEYCODE_APP_SWITCH",
      "KEYCODE_POWER",
      "KEYCODE_VOLUME_UP",
      "KEYCODE_VOLUME_DOWN",
      "KEYCODE_ENTER",
      "KEYCODE_DEL",
    ]);
    if (!allowed.has(keycode)) throw new AdbError("不支持的按键");

    const r = await this.run(
      this.withSerial(serial, ["shell", "input", "keyevent", keycode]),
    );
    const out = `${r.stdout}\n${r.stderr}`;
    if (r.ok && !isInjectEventsDenied(out)) return r;

    // 小米等 user 版禁止 inject：HOME 可用 Intent 回退
    if (isInjectEventsDenied(out) && keycode === "KEYCODE_HOME") {
      const home = await this.run(
        this.withSerial(serial, [
          "shell",
          "am",
          "start",
          "-a",
          "android.intent.action.MAIN",
          "-c",
          "android.intent.category.HOME",
        ]),
      );
      const homeOut = `${home.stdout}\n${home.stderr}`;
      if (home.ok || /Starting:\s*Intent/i.test(homeOut)) {
        return {
          ok: true,
          code: home.code,
          stdout: home.stdout || "HOME via am start",
          stderr: home.stderr,
        };
      }
    }

    assertInputAllowed(r, "按键发送失败");
    return r;
  }

  /** 当前 adb 可执行路径（供 scrcpy 等长驻会话复用） */
  executablePath(): string {
    return this.adbPath;
  }

  /**
   * 端口转发（仅允许 tcp ↔ localabstract/localreserved，防滥用）。
   * 例：local=`tcp:27183` remote=`localabstract:scrcpy`
   */
  async forward(
    serial: string | undefined,
    local: string,
    remote: string,
  ): Promise<AdbResult> {
    assertForwardEndpoint(local, "local");
    assertForwardEndpoint(remote, "remote");
    return this.run(this.withSerial(serial, ["forward", local, remote]));
  }

  async removeForward(
    serial: string | undefined,
    local: string,
  ): Promise<AdbResult> {
    assertForwardEndpoint(local, "local");
    return this.run(this.withSerial(serial, ["forward", "--remove", local]));
  }

  /**
   * 启动长驻 adb 子进程（不等待退出）。调用方负责 kill。
   * 仅供受控场景（如 scrcpy-server）。
   */
  spawnLongRunning(args: string[]) {
    return spawn(this.adbPath, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  /** 组装带 -s 的参数（供外部受控 spawn） */
  argsWithSerial(serial: string | undefined, args: string[]): string[] {
    return this.withSerial(serial, args);
  }
}

/** forward 端点白名单：tcp:端口 或 localabstract/localreserved:名称 */
function assertForwardEndpoint(value: string, kind: string): string {
  if (value.length > 128) throw new AdbError(`非法 forward ${kind}`);
  if (/^tcp:\d{2,5}$/.test(value)) {
    const port = Number(value.slice(4));
    if (port < 1024 || port > 65535) {
      throw new AdbError(`非法 forward ${kind} 端口`);
    }
    return value;
  }
  if (/^localabstract:[A-Za-z0-9._-]{1,64}$/.test(value)) return value;
  if (/^localreserved:[A-Za-z0-9._-]{1,64}$/.test(value)) return value;
  throw new AdbError(`非法 forward ${kind}`);
}

/** 从 PATH 查找 adb（Windows / macOS / Linux） */
function findAdbOnPath(): string | undefined {
  const cmd = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(cmd, ["adb"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (r.status !== 0 || !r.stdout?.trim()) return undefined;
  const first = r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  return first && fs.existsSync(first) ? first : undefined;
}

/** 仓库内多平台目录：platform-tools/{windows|darwin|linux}/ */
function platformToolsOsDir(): string {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "darwin";
  return "linux";
}

export function resolveAdbPath(configured?: string, cwd = process.cwd()): string {
  const native = process.platform === "win32" ? "adb.exe" : "adb";
  const alt = process.platform === "win32" ? "adb" : "adb.exe";
  const osDir = platformToolsOsDir();
  const candidates = [
    configured,
    path.join(cwd, "platform-tools", osDir, native),
    path.join(cwd, "platform-tools", native),
    path.join(cwd, "platform-tools", alt),
    path.join(cwd, "..", "..", "platform-tools", osDir, native),
    path.join(cwd, "..", "..", "platform-tools", native),
    path.join(cwd, "..", "..", "platform-tools", alt),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const abs = path.resolve(c);
    if (fs.existsSync(abs)) return abs;
  }

  const onPath = findAdbOnPath();
  if (onPath) return onPath;

  throw new AdbError(
    "未找到 adb，请配置 ADB_PATH、运行 pnpm fetch:adb，或安装 platform-tools",
  );
}