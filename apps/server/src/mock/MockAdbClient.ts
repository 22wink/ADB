import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type {
  AdbResult,
  DeviceInfo,
  InstallMode,
  PackageInfo,
  PackageScope,
  RemoteEntry,
} from "@adb-studio/adb-core";
import { AdbError, joinRemotePath } from "@adb-studio/adb-core";

type FsDir = { type: "dir"; children: Map<string, FsNode> };
type FsFile = { type: "file"; content: Buffer; mtime: string };
type FsNode = FsDir | FsFile;

function ok(stdout = "", stderr = ""): AdbResult {
  return { ok: true, code: 0, stdout, stderr };
}

function fail(stderr: string): AdbResult {
  return { ok: false, code: 1, stdout: "", stderr };
}

function nowStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 最小合法 PNG 1x1 */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function seedFs(): FsDir {
  const dir = (): FsDir => ({ type: "dir", children: new Map() });
  const file = (text: string): FsFile => ({
    type: "file",
    content: Buffer.from(text, "utf8"),
    mtime: nowStamp(),
  });

  const root = dir();
  const sdcard = dir();
  const download = dir();
  const dcim = dir();
  const pictures = dir();
  const movies = dir();
  const music = dir();
  const docs = dir();
  const tmp = dir();
  const camera = dir();

  download.children.set("demo.txt", file("hello from mock Download\n"));
  download.children.set("notes.md", file("# Mock Notes\n"));
  pictures.children.set("photo.png", {
    type: "file",
    content: TINY_PNG,
    mtime: nowStamp(),
  });
  docs.children.set("readme.txt", file("ADB Studio mock filesystem\n"));
  movies.children.set("clip.mp4", file("fake-mp4-bytes"));
  music.children.set("track.mp3", file("fake-mp3-bytes"));
  camera.children.set("IMG_0001.jpg", {
    type: "file",
    content: TINY_PNG,
    mtime: nowStamp(),
  });
  dcim.children.set("Camera", camera);

  sdcard.children.set("Download", download);
  sdcard.children.set("DCIM", dcim);
  sdcard.children.set("Pictures", pictures);
  sdcard.children.set("Movies", movies);
  sdcard.children.set("Music", music);
  sdcard.children.set("Documents", docs);
  sdcard.children.set("mock-root.txt", file("sdcard root file\n"));

  tmp.children.set("cache.bin", file("tmp-cache"));

  const local = dir();
  local.children.set("tmp", tmp);
  const data = dir();
  data.children.set("local", local);

  root.children.set("sdcard", sdcard);
  root.children.set("storage", dir());
  root.children.set("data", data);

  return root;
}

function seedDevices(): DeviceInfo[] {
  return [
    {
      serial: "MOCKUSB001",
      state: "device",
      model: "Pixel_Mock",
      product: "mock_phone",
      device: "mock",
    },
    {
      serial: "192.168.1.88:5555",
      state: "device",
      model: "CRUISE_Mock",
      product: "cruise",
      device: "cruise",
    },
  ];
}

function seedPackages(): Map<string, PackageInfo[]> {
  return new Map<string, PackageInfo[]>([
    [
      "MOCKUSB001",
      [
        {
          packageName: "com.android.chrome",
          label: "Chrome",
          versionName: "120.0.6099.144",
          versionCode: "609914400",
          apkPath: "/data/app/~~chrome/base.apk",
          dataDir: "/data/user/0/com.android.chrome",
          installer: "com.android.vending",
          firstInstallTime: "2024-03-01 10:00:00",
          lastUpdateTime: "2024-12-15 18:22:00",
          minSdk: "24",
          targetSdk: "34",
          uid: "10123",
          enabled: true,
          system: false,
        },
        {
          packageName: "com.mock.demo",
          label: "Mock Demo",
          versionName: "1.0.0",
          versionCode: "1",
          apkPath: "/data/app/~~demo/base.apk",
          dataDir: "/data/user/0/com.mock.demo",
          installer: "com.android.packageinstaller",
          firstInstallTime: "2025-01-10 09:30:00",
          lastUpdateTime: "2025-01-10 09:30:00",
          minSdk: "26",
          targetSdk: "34",
          uid: "10150",
          enabled: true,
          system: false,
        },
        {
          packageName: "com.tencent.mm",
          label: "微信",
          versionName: "8.0.51",
          versionCode: "2580",
          apkPath: "/data/app/~~mm/base.apk",
          dataDir: "/data/user/0/com.tencent.mm",
          installer: "com.xiaomi.market",
          firstInstallTime: "2023-08-20 14:00:00",
          lastUpdateTime: "2025-06-01 20:11:00",
          minSdk: "21",
          targetSdk: "33",
          uid: "10188",
          enabled: true,
          system: false,
        },
        {
          packageName: "com.example.notes",
          label: "速记便签",
          versionName: "2.3.1",
          versionCode: "231",
          apkPath: "/data/app/~~notes/base.apk",
          dataDir: "/data/user/0/com.example.notes",
          installer: "com.android.shell",
          firstInstallTime: "2025-02-02 11:00:00",
          lastUpdateTime: "2025-05-18 16:40:00",
          minSdk: "28",
          targetSdk: "35",
          uid: "10201",
          enabled: true,
          system: false,
        },
      ],
    ],
    [
      "192.168.1.88:5555",
      [
        {
          packageName: "com.mock.wifiapp",
          label: "WiFi Mock",
          versionName: "0.9.2",
          versionCode: "92",
          apkPath: "/data/app/~~wifi/base.apk",
          dataDir: "/data/user/0/com.mock.wifiapp",
          installer: "com.android.vending",
          firstInstallTime: "2025-04-01 08:00:00",
          lastUpdateTime: "2025-04-12 12:00:00",
          minSdk: "29",
          targetSdk: "34",
          uid: "10300",
          enabled: true,
          system: false,
        },
        {
          packageName: "com.android.settings",
          label: "设置",
          versionName: "14",
          versionCode: "34",
          apkPath: "/system/priv-app/Settings/Settings.apk",
          dataDir: "/data/user/0/com.android.settings",
          firstInstallTime: "2009-01-01 00:00:00",
          lastUpdateTime: "2024-10-01 00:00:00",
          minSdk: "34",
          targetSdk: "34",
          uid: "1000",
          enabled: true,
          system: true,
        },
        {
          packageName: "com.example.gallery",
          label: "图库",
          versionName: "3.1.0",
          versionCode: "310",
          apkPath: "/data/app/~~gallery/base.apk",
          dataDir: "/data/user/0/com.example.gallery",
          installer: "com.android.vending",
          firstInstallTime: "2024-11-11 11:11:00",
          lastUpdateTime: "2025-03-03 15:00:00",
          minSdk: "26",
          targetSdk: "34",
          uid: "10310",
          enabled: true,
          system: false,
        },
      ],
    ],
  ]);
}

export class MockAdbClient {
  private devicesList: DeviceInfo[] = seedDevices();
  private packageMap = seedPackages();

  private fs = seedFs();
  private logLines: string[] = [];

  constructor() {
    for (let i = 0; i < 40; i++) {
      this.logLines.push(
        `0${i % 10}-01 12:00:${String(i).padStart(2, "0")}.000  1234  5678 I MockTag: mock log line ${i}`,
      );
    }
    console.log("[MOCK] ADB Mock 已启用（仅开发模式）");
  }

  private ensureSeeded() {
    if (this.devicesList.length > 0) return;
    this.devicesList = seedDevices();
    const pkgs = seedPackages();
    for (const [serial, list] of pkgs) {
      this.packageMap.set(serial, list);
    }
    console.log("[MOCK] 在线设备为空，已重新载入默认 Mock 设备");
  }

  private serialKey(serial?: string): string {
    this.ensureSeeded();
    return serial || this.devicesList[0]?.serial || "MOCKUSB001";
  }

  private ensureDevice(serial?: string) {
    this.ensureSeeded();
    const key = this.serialKey(serial);
    const d = this.devicesList.find((x) => x.serial === key);
    if (!d || d.state !== "device") {
      throw new AdbError("设备未连接或不在线", key);
    }
    return key;
  }

  private resolveNode(remotePath: string): { parent?: FsNode; name: string; node?: FsNode } {
    const normalized = remotePath.replace(/\\/g, "/").replace(/\/+/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0) {
      return { name: "", node: this.fs };
    }
    let cur: FsNode = this.fs;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      if (cur.type !== "dir" || !cur.children.has(p)) {
        throw new AdbError("路径不存在", remotePath);
      }
      cur = cur.children.get(p)!;
    }
    const name = parts[parts.length - 1]!;
    const node = cur.type === "dir" ? cur.children.get(name) : undefined;
    return { parent: cur, name, node };
  }

  async version(): Promise<string> {
    return "Android Debug Bridge version 1.0.41\nMock Build (dev only)";
  }

  async devices(): Promise<DeviceInfo[]> {
    this.ensureSeeded();
    return this.devicesList.map((d) => ({ ...d }));
  }

  async connect(hostPort: string): Promise<AdbResult> {
    if (!/^[A-Za-z0-9.-]+:\d{2,5}$/.test(hostPort)) {
      throw new AdbError("无线连接地址格式应为 host:port");
    }
    const exists = this.devicesList.find((d) => d.serial === hostPort);
    if (!exists) {
      this.devicesList.push({
        serial: hostPort,
        state: "device",
        model: "Mock_WiFi_Device",
        product: "mock_wifi",
        device: "mock",
      });
      this.packageMap.set(hostPort, [
        {
          packageName: "com.mock.lan",
          label: "LAN Mock",
          versionName: "1.0.0",
          versionCode: "1",
          apkPath: "/data/app/~~lan/base.apk",
          dataDir: "/data/user/0/com.mock.lan",
          installer: "com.android.shell",
          firstInstallTime: nowStamp(),
          lastUpdateTime: nowStamp(),
          minSdk: "28",
          targetSdk: "34",
          enabled: true,
          system: false,
        },
        {
          packageName: "com.android.vending",
          label: "Play 商店",
          versionName: "40.0.0",
          versionCode: "40000000",
          apkPath: "/data/app/~~vending/base.apk",
          system: false,
          enabled: true,
        },
      ]);
    } else {
      exists.state = "device";
    }
    return ok(`connected to ${hostPort}`);
  }

  async pair(hostPort: string, code: string): Promise<AdbResult> {
    if (!/^\d{6}$/.test(code)) throw new AdbError("配对码应为 6 位数字");
    return ok(`Successfully paired to ${hostPort}`);
  }

  async disconnect(hostPort?: string): Promise<AdbResult> {
    if (hostPort) {
      this.devicesList = this.devicesList.filter((d) => d.serial !== hostPort);
    } else {
      this.devicesList = this.devicesList.filter((d) => !d.serial.includes(":"));
    }
    // Mock：删光后自动恢复默认设备，避免刷新页面仍空白
    this.ensureSeeded();
    return ok(hostPort ? `disconnected ${hostPort}` : "disconnected everything");
  }

  async mdnsServices(): Promise<
    { name: string; service: string; address: string }[]
  > {
    return [
      {
        name: "adb-tls-connect-mock",
        service: "_adb-tls-connect._tcp",
        address: "192.168.1.88:37123",
      },
      {
        name: "adb-tls-pairing-mock",
        service: "_adb-tls-pairing._tcp",
        address: "192.168.1.88:37124",
      },
    ];
  }

  async getProp(serial: string | undefined, key: string): Promise<string> {
    const props = await this.deviceProps(serial);
    return props[key] ?? "";
  }

  async getAllProps(serial?: string): Promise<Record<string, string>> {
    return this.deviceProps(serial);
  }

  async deviceExtras(_serial?: string): Promise<Record<string, string>> {
    return {
      "wm.size": "1080x2400",
      "wm.density": "420",
      "battery.level": "87%",
      "battery.status": "2",
      "battery.health": "2",
      "battery.temperature": "31.5°C",
    };
  }

  async deviceProps(serial?: string): Promise<Record<string, string>> {
    const key = this.serialKey(serial);
    const d = this.devicesList.find((x) => x.serial === key);
    return {
      "ro.product.model": d?.model?.replace(/_/g, " ") || "Mock Phone",
      "ro.product.brand": "MockBrand",
      "ro.product.manufacturer": "MockCorp",
      "ro.product.name": d?.product || "mock",
      "ro.product.device": d?.device || "mock",
      "ro.product.board": "mockboard",
      "ro.product.cpu.abi": "arm64-v8a",
      "ro.product.cpu.abilist": "arm64-v8a,armeabi-v7a,armeabi",
      "ro.hardware": "mockhw",
      "ro.serialno": key.includes(":") ? "WFMOCK123" : key,
      "ro.boot.serialno": key.includes(":") ? "WFMOCK123" : key,
      "ro.build.version.release": "14",
      "ro.build.version.sdk": "34",
      "ro.build.id": "MOCK1.240101.001",
      "ro.build.display.id": "MockOS-1.0",
      "ro.build.type": "userdebug",
      "ro.build.tags": "test-keys",
      "ro.build.version.security_patch": "2024-12-01",
      "ro.build.version.incremental": "1000001",
      "ro.build.fingerprint": "MockBrand/mock/mock:14/MOCK1/1000001:userdebug/test-keys",
      "ro.build.date": "Mon Jan 1 00:00:00 UTC 2024",
      "ro.build.user": "mockbuilder",
      "ro.build.host": "mock-host",
      "ro.sf.lcd_density": "420",
      "persist.sys.timezone": "Asia/Shanghai",
      "ro.crypto.state": "encrypted",
      "gsm.version.baseband": "MOCK.BASEBAND.1.0",
      "ro.bootloader": "MOCKBL01",
      "ro.debuggable": "1",
      "ro.secure": "1",
      ...(await this.deviceExtras(serial)),
    };
  }

  async packages(
    serial?: string,
    scope: PackageScope = "third",
  ): Promise<PackageInfo[]> {
    const key = this.ensureDevice(serial);
    let list = [...(this.packageMap.get(key) ?? [])];
    if (scope === "third") list = list.filter((p) => !p.system);
    else if (scope === "system") list = list.filter((p) => p.system);
    return list.sort((a, b) =>
      (a.label || a.packageName).localeCompare(
        b.label || b.packageName,
        "zh",
      ),
    );
  }

  async install(
    serial: string | undefined,
    apkPath: string,
    mode: InstallMode = "replace",
    packageName?: string,
  ): Promise<AdbResult> {
    const key = this.ensureDevice(serial);
    const name = path.basename(apkPath).replace(/\.apk$/i, "") || "mockapp";
    const pkg =
      packageName ||
      `com.mock.installed.${name.replace(/\W+/g, "").slice(0, 20) || "app"}`;
    const list = this.packageMap.get(key) ?? [];

    if (mode === "clean") {
      const next = list.filter((p) => p.packageName !== pkg);
      next.push({
        packageName: pkg,
        label: name,
        versionName: "1.0.0",
        versionCode: "1",
        apkPath: `/data/app/~~${name}/base.apk`,
        dataDir: `/data/user/0/${pkg}`,
        installer: "com.android.shell",
        firstInstallTime: nowStamp(),
        lastUpdateTime: nowStamp(),
        minSdk: "26",
        targetSdk: "34",
        enabled: true,
        system: false,
      });
      this.packageMap.set(key, next);
      return ok(`Success\nmode=clean\npackage=${pkg}`);
    }

    const existing = list.find((p) => p.packageName === pkg);
    if (existing) {
      if (mode === "normal") {
        return fail("INSTALL_FAILED_ALREADY_EXISTS");
      }
      existing.lastUpdateTime = nowStamp();
      existing.versionName = "1.0.1";
      this.packageMap.set(key, list);
      return ok(`Success\nmode=replace\npackage=${pkg}`);
    }

    list.push({
      packageName: pkg,
      label: name,
      versionName: "1.0.0",
      versionCode: "1",
      apkPath: `/data/app/~~${name}/base.apk`,
      dataDir: `/data/user/0/${pkg}`,
      installer: "com.android.shell",
      firstInstallTime: nowStamp(),
      lastUpdateTime: nowStamp(),
      minSdk: "26",
      targetSdk: "34",
      enabled: true,
      system: false,
    });
    this.packageMap.set(key, list);
    return ok(`Success\nmode=${mode}\npackage=${pkg}`);
  }

  async uninstall(serial: string | undefined, pkg: string): Promise<AdbResult> {
    const key = this.ensureDevice(serial);
    const list = (this.packageMap.get(key) ?? []).filter(
      (p) => p.packageName !== pkg,
    );
    this.packageMap.set(key, list);
    return ok("Success");
  }

  async forceStop(_serial: string | undefined, pkg: string): Promise<AdbResult> {
    return ok(`Stopped ${pkg}`);
  }

  async clearData(_serial: string | undefined, pkg: string): Promise<AdbResult> {
    return ok(`Success clear ${pkg}`);
  }

  async launch(_serial: string | undefined, pkg: string): Promise<AdbResult> {
    return ok(`Events injected: 1\n## ${pkg}`);
  }

  async screenshot(
    serial: string | undefined,
    localPath: string,
  ): Promise<string> {
    this.ensureDevice(serial);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, TINY_PNG);
    return localPath;
  }

  async push(
    serial: string | undefined,
    localPath: string,
    remotePath: string,
  ): Promise<AdbResult> {
    this.ensureDevice(serial);
    if (!fs.existsSync(localPath)) throw new AdbError("本地文件不存在");
    const content = fs.readFileSync(localPath);
    const { parent, name } = this.resolveNode(remotePath);
    if (!parent || parent.type !== "dir") {
      throw new AdbError("远端目录不存在", remotePath);
    }
    parent.children.set(name, {
      type: "file",
      content,
      mtime: nowStamp(),
    });
    return ok(`${localPath}: 1 file pushed`);
  }

  async pull(
    serial: string | undefined,
    remotePath: string,
    localPath: string,
  ): Promise<AdbResult> {
    this.ensureDevice(serial);
    const { node } = this.resolveNode(remotePath);
    if (!node || node.type !== "file") {
      throw new AdbError("远端文件不存在", remotePath);
    }
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, node.content);
    return ok(`1 file pulled`);
  }

  async listDir(
    serial: string | undefined,
    remotePath: string,
  ): Promise<RemoteEntry[]> {
    this.ensureDevice(serial);
    const pathKey = remotePath === "" ? "/" : remotePath;
    const { node } =
      pathKey === "/"
        ? { node: this.fs as FsNode | undefined }
        : this.resolveNode(pathKey);
    if (!node || node.type !== "dir") {
      throw new AdbError("无法列出目录", remotePath);
    }
    const entries: RemoteEntry[] = [];
    for (const [name, child] of node.children) {
      try {
        const full =
          pathKey === "/" ? `/${name}` : joinRemotePath(pathKey, name);
        entries.push({
          name,
          path: full,
          isDir: child.type === "dir",
          size: child.type === "file" ? child.content.length : undefined,
          mtime: child.type === "file" ? child.mtime : nowStamp(),
        });
      } catch {
        /* skip */
      }
    }
    return entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, "zh");
    });
  }

  async mkdir(serial: string | undefined, remotePath: string): Promise<AdbResult> {
    this.ensureDevice(serial);
    const { parent, name, node } = this.resolveNode(remotePath);
    if (!parent || parent.type !== "dir") {
      throw new AdbError("父目录不存在", remotePath);
    }
    if (node) return ok("");
    parent.children.set(name, { type: "dir", children: new Map() });
    return ok("");
  }

  async remove(
    serial: string | undefined,
    remotePath: string,
    _recursive = false,
  ): Promise<AdbResult> {
    this.ensureDevice(serial);
    const { parent, name, node } = this.resolveNode(remotePath);
    if (!parent || parent.type !== "dir" || !node) {
      throw new AdbError("目标不存在", remotePath);
    }
    parent.children.delete(name);
    return ok("");
  }

  async reboot(_serial?: string): Promise<AdbResult> {
    return ok("mock reboot");
  }

  async rebootBootloader(_serial?: string): Promise<AdbResult> {
    return ok("mock reboot bootloader");
  }

  async logcat(
    _serial: string | undefined,
    opts?: { lines?: number },
  ): Promise<string> {
    const n = opts?.lines ?? 200;
    return this.logLines.slice(-n).join("\n");
  }

  async clearLogcat(_serial?: string): Promise<AdbResult> {
    this.logLines = [];
    return ok("");
  }

  async inputKey(_serial: string | undefined, keycode: string): Promise<AdbResult> {
    return ok(`keyevent ${keycode}`);
  }

  async inputText(_serial: string | undefined, text: string): Promise<AdbResult> {
    return ok(`input text ${text}`);
  }

  executablePath(): string {
    return "mock-adb";
  }

  async forward(
    _serial: string | undefined,
    _local: string,
    _remote: string,
  ): Promise<AdbResult> {
    return ok("mock forward");
  }

  async removeForward(
    _serial: string | undefined,
    _local: string,
  ): Promise<AdbResult> {
    return ok("mock remove forward");
  }

  spawnLongRunning(_args: string[]) {
    const fake = new EventEmitter() as ChildProcess;
    Object.assign(fake, {
      killed: false,
      stdout: null,
      stderr: null,
      kill: () => {
        (fake as { killed: boolean }).killed = true;
        fake.emit("close", 0);
        return true;
      },
    });
    return fake;
  }

  argsWithSerial(serial: string | undefined, args: string[]): string[] {
    return serial ? ["-s", serial, ...args] : args;
  }
}

export const MOCK_LAN = {
  subnets: ["192.168.1.0/24"],
  hosts: [
    {
      address: "192.168.1.88:5555",
      host: "192.168.1.88",
      port: 5555,
      source: ["port-scan", "mdns"],
      name: "mock-phone-wifi",
      service: "_adb._tcp",
    },
    {
      address: "192.168.1.88:37123",
      host: "192.168.1.88",
      port: 37123,
      source: ["mdns"],
      name: "adb-tls-connect-mock",
      service: "_adb-tls-connect._tcp",
    },
    {
      address: "192.168.1.42:5555",
      host: "192.168.1.42",
      port: 5555,
      source: ["port-scan"],
    },
  ],
};
