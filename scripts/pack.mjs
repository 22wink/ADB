import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readdirSync,
  createWriteStream,
  readFileSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "release", "ADB-Studio");
const cacheDir = join(root, ".cache");
const upxCacheDir = join(cacheDir, "upx-packed");

/** 内置便携 Node（无需目标机器安装） */
const NODE_VERSION = "22.16.0";

/**
 * 目标平台：RELEASE_OS=win32|darwin（默认当前机）
 * 架构：RELEASE_ARCH=x64|arm64（darwin 默认 arm64；win32 固定 x64）
 */
const RELEASE_OS = process.env.RELEASE_OS || process.platform;
const RELEASE_ARCH =
  process.env.RELEASE_ARCH ||
  (RELEASE_OS === "darwin"
    ? process.platform === "darwin"
      ? process.arch
      : "arm64"
    : "x64");

if (RELEASE_OS !== "win32" && RELEASE_OS !== "darwin") {
  console.error(`暂不支持 RELEASE_OS=${RELEASE_OS}（仅 win32 / darwin）`);
  process.exit(1);
}

const isWinTarget = RELEASE_OS === "win32";
const adbBin = isWinTarget ? "adb.exe" : "adb";
const nodeBin = isWinTarget ? "node.exe" : "node";
const archiveTag = isWinTarget
  ? "win"
  : `mac-${RELEASE_ARCH === "arm64" ? "arm64" : "x64"}`;

/** Windows cmd 参数转义（供 shell:true 单行命令，避免 DEP0190 的 args+shell） */
function quoteCmdArg(arg) {
  const s = String(arg);
  if (!/[ \t"]/g.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  if (process.platform === "win32") {
    const line = [cmd, ...args].map(quoteCmdArg).join(" ");
    const r = spawnSync(line, { cwd: root, stdio: "inherit", shell: true });
    if (r.status !== 0) process.exit(r.status ?? 1);
    return;
  }
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: false });
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function fileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").slice(0, 16);
}

async function download(url, dest) {
  console.log(`下载 ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`下载失败 HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function extractZip(zipPath, out) {
  mkdirSync(out, { recursive: true });
  if (process.platform === "win32") {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${out}' -Force`,
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0) throw new Error(`解压失败: ${zipPath}`);
    return;
  }
  const r = spawnSync("unzip", ["-o", zipPath, "-d", out], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`解压失败: ${zipPath}`);
}

function extractTarGz(archive, out) {
  mkdirSync(out, { recursive: true });
  const r = spawnSync("tar", ["-xzf", archive, "-C", out], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`解压失败: ${archive}`);
}

function chmodIfUnix(filePath) {
  if (process.platform === "win32") return;
  try {
    chmodSync(filePath, 0o755);
  } catch {
    /* ignore */
  }
}

async function ensurePortableNode() {
  mkdirSync(cacheDir, { recursive: true });
  const runtimeDir = join(outDir, "runtime");
  mkdirSync(runtimeDir, { recursive: true });

  if (isWinTarget) {
    const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
    const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;
    const zipPath = join(cacheDir, NODE_ZIP);
    const extractDir = join(cacheDir, `node-v${NODE_VERSION}-win-x64`);
    const nodeExe = join(extractDir, "node.exe");

    if (!existsSync(nodeExe)) {
      if (!existsSync(zipPath)) await download(NODE_URL, zipPath);
      console.log("解压便携 Node (Windows) ...");
      rmSync(extractDir, { recursive: true, force: true });
      extractZip(zipPath, cacheDir);
      if (!existsSync(nodeExe)) throw new Error("解压 Node 失败");
    }

    cpSync(nodeExe, join(runtimeDir, "node.exe"));
    for (const name of readdirSync(extractDir)) {
      if (/\.dll$/i.test(name)) {
        cpSync(join(extractDir, name), join(runtimeDir, name));
      }
    }
    console.log(`已内置 Node ${NODE_VERSION} → runtime/node.exe`);
    return;
  }

  const arch = RELEASE_ARCH === "arm64" ? "arm64" : "x64";
  const folder = `node-v${NODE_VERSION}-darwin-${arch}`;
  const tarName = `${folder}.tar.gz`;
  const tarUrl = `https://nodejs.org/dist/v${NODE_VERSION}/${tarName}`;
  const tarPath = join(cacheDir, tarName);
  const extractRoot = join(cacheDir, folder);
  const nodePath = join(extractRoot, "bin", "node");

  if (!existsSync(nodePath)) {
    if (!existsSync(tarPath)) await download(tarUrl, tarPath);
    console.log(`解压便携 Node (darwin-${arch}) ...`);
    rmSync(extractRoot, { recursive: true, force: true });
    extractTarGz(tarPath, cacheDir);
    if (!existsSync(nodePath)) throw new Error("解压 Node 失败");
  }

  cpSync(nodePath, join(runtimeDir, "node"));
  chmodIfUnix(join(runtimeDir, "node"));
  console.log(`已内置 Node ${NODE_VERSION} → runtime/node`);
}

/**
 * 从 platform-tools/{windows|darwin}/ 拷贝到发布包扁平 platform-tools/
 * 本地缺失时自动下载对应平台包
 */
async function ensurePlatformTools() {
  const ptDst = join(outDir, "platform-tools");
  mkdirSync(ptDst, { recursive: true });

  const osKey = isWinTarget ? "windows" : "darwin";
  let srcDir = join(root, "platform-tools", osKey);
  const needAdb = isWinTarget ? "adb.exe" : "adb";

  if (!existsSync(join(srcDir, needAdb))) {
    console.log(`本地缺少 platform-tools/${osKey}，自动下载...`);
    const zipName = `platform-tools-latest-${osKey === "windows" ? "windows" : "darwin"}.zip`;
    const zipPath = join(cacheDir, zipName);
    const extractTmp = join(cacheDir, `pt-extract-${osKey}`);
    if (!existsSync(zipPath)) {
      await download(
        `https://dl.google.com/android/repository/${zipName}`,
        zipPath,
      );
    }
    rmSync(extractTmp, { recursive: true, force: true });
    extractZip(zipPath, extractTmp);
    const extracted = join(extractTmp, "platform-tools");
    if (!existsSync(join(extracted, needAdb))) {
      console.error(`${osKey} platform-tools 解压失败`);
      process.exit(1);
    }
    mkdirSync(join(root, "platform-tools"), { recursive: true });
    rmSync(srcDir, { recursive: true, force: true });
    cpSync(extracted, srcDir, { recursive: true });
    rmSync(extractTmp, { recursive: true, force: true });
  }

  if (isWinTarget) {
    for (const name of [
      "adb.exe",
      "AdbWinApi.dll",
      "AdbWinUsbApi.dll",
      "libwinpthread-1.dll",
      "source.properties",
    ]) {
      const from = join(srcDir, name);
      if (!existsSync(from)) {
        console.error(`缺少 platform-tools/windows/${name}（运行: pnpm fetch:adb -- windows）`);
        process.exit(1);
      }
      cpSync(from, join(ptDst, name));
    }
    return srcDir;
  }

  for (const name of readdirSync(srcDir)) {
    cpSync(join(srcDir, name), join(ptDst, name), { recursive: true });
  }
  chmodIfUnix(join(ptDst, "adb"));
  return srcDir;
}

const START_BAT = `@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ADB Studio

set "LOG=%~dp0start.log"
echo ===== %date% %time% =====> "%LOG%"
echo cwd=%cd%>> "%LOG%"

set "NODE_EXE=%~dp0runtime\\node.exe"
if not exist "%NODE_EXE%" (
  echo [ERROR] Missing runtime\\node.exe
  echo missing runtime>> "%LOG%"
  goto hold
)
if not exist "%~dp0server.mjs" (
  echo [ERROR] Missing server.mjs
  goto hold
)
if not exist "%~dp0platform-tools\\adb.exe" (
  echo [ERROR] Missing platform-tools\\adb.exe
  goto hold
)
if not exist "%~dp0run.ps1" (
  echo [ERROR] Missing run.ps1
  goto hold
)

echo Using bundled Node:
echo %NODE_EXE%
"%NODE_EXE%" -v >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERROR] Bundled Node failed to run
  type "%LOG%"
  goto hold
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
set "ERR=%ERRORLEVEL%"
echo.
echo [EXIT] code %ERR%
echo exit=%ERR%>> "%LOG%"
if not "%ERR%"=="0" (
  echo Start failed. See start.log
  type "%LOG%"
)

:hold
echo.
pause
endlocal
`;

const RUN_PS1 = `$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $root 'runtime\\node.exe'
$server = Join-Path $root 'server.mjs'
$port = 3789

$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  $m = Select-String -Path $envFile -Pattern '^\\s*PORT\\s*=\\s*(\\d+)' | Select-Object -First 1
  if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
}

function Stop-ListenPort([int]$Port) {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path $node)) {
  Write-Host "[ERROR] Missing runtime\\node.exe"
  exit 1
}
if (-not (Test-Path $server)) {
  Write-Host "[ERROR] Missing server.mjs"
  exit 1
}

Write-Host "Stopping leftover process on port $port (if any)..."
Stop-ListenPort $port
Start-Sleep -Milliseconds 300

Write-Host "Starting ADB Studio..."
Write-Host "Open: http://127.0.0.1:$port"
Write-Host "Press Ctrl+C or close this window to stop."
Write-Host ""

$p = Start-Process -FilePath $node -ArgumentList $server -WorkingDirectory $root -NoNewWindow -PassThru
try {
  Wait-Process -Id $p.Id
  exit $p.ExitCode
} finally {
  if ($null -ne $p -and -not $p.HasExited) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  }
  Stop-ListenPort $port
  Write-Host ""
  Write-Host "Stopped."
}
`;

const STOP_BAT = `@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ADB Studio Stop

echo Stopping ADB Studio on port 3789 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port=3789; if (Test-Path '%~dp0.env') { $m=Select-String -Path '%~dp0.env' -Pattern '^\\s*PORT\\s*=\\s*(\\d+)' | Select-Object -First 1; if ($m) { $port=[int]$m.Matches[0].Groups[1].Value } }; Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('Killing PID ' + $_.OwningProcess); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host 'Done.'"

echo.
pause
endlocal
`;

const START_SH = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'cd "$(dirname "$0")"',
  'ROOT="$(pwd)"',
  'LOG="$ROOT/start.log"',
  'NODE="$ROOT/runtime/node"',
  'SERVER="$ROOT/server.mjs"',
  'ADB="$ROOT/platform-tools/adb"',
  "",
  "{",
  '  echo "===== $(date) ====="',
  '  echo "cwd=$ROOT"',
  '} > "$LOG"',
  "",
  'if [[ ! -x "$NODE" ]]; then',
  '  echo "[ERROR] Missing or not executable: runtime/node"',
  '  echo "missing runtime" >> "$LOG"',
  "  exit 1",
  "fi",
  'if [[ ! -f "$SERVER" ]]; then',
  '  echo "[ERROR] Missing server.mjs"',
  "  exit 1",
  "fi",
  'if [[ ! -x "$ADB" ]]; then',
  '  echo "[ERROR] Missing or not executable: platform-tools/adb"',
  "  exit 1",
  "fi",
  "",
  "PORT=3789",
  'if [[ -f "$ROOT/.env" ]]; then',
  "  p=$(grep -E '^[[:space:]]*PORT[[:space:]]*=' \"$ROOT/.env\" | head -n1 | sed -E 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*//')",
  '  if [[ "$p" =~ ^[0-9]+$ ]]; then PORT="$p"; fi',
  "fi",
  "",
  "if command -v lsof >/dev/null 2>&1; then",
  '  pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)',
  '  if [[ -n "${pids:-}" ]]; then',
  '    echo "Stopping leftover process on port $PORT ..."',
  "    kill $pids 2>/dev/null || true",
  "    sleep 0.3",
  "  fi",
  "fi",
  "",
  'echo "Starting ADB Studio..."',
  'echo "Open: http://127.0.0.1:$PORT"',
  'echo "Press Ctrl+C to stop."',
  '"$NODE" -v >> "$LOG" 2>&1',
  'exec "$NODE" "$SERVER"',
  "",
].join("\n");

const STOP_SH = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'cd "$(dirname "$0")"',
  'ROOT="$(pwd)"',
  "PORT=3789",
  'if [[ -f "$ROOT/.env" ]]; then',
  "  p=$(grep -E '^[[:space:]]*PORT[[:space:]]*=' \"$ROOT/.env\" | head -n1 | sed -E 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*//')",
  '  if [[ "$p" =~ ^[0-9]+$ ]]; then PORT="$p"; fi',
  "fi",
  'echo "Stopping ADB Studio on port $PORT ..."',
  "if command -v lsof >/dev/null 2>&1; then",
  '  pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)',
  '  if [[ -n "${pids:-}" ]]; then',
  "    kill $pids 2>/dev/null || true",
  '    echo "Done."',
  "  else",
  '    echo "No listener on $PORT."',
  "  fi",
  "else",
  '  echo "lsof not found; please kill the node process manually."',
  "fi",
  "",
].join("\n");

function writeBat(filePath, content) {
  writeFileSync(filePath, content.replace(/\r?\n/g, "\r\n"), "ascii");
}

function writeText(filePath, content) {
  writeFileSync(filePath, content.replace(/\r?\n/g, "\r\n"), "utf8");
}

function writeUnix(filePath, content) {
  writeFileSync(filePath, content.replace(/\r\n/g, "\n"), "utf8");
  chmodIfUnix(filePath);
}

// 1) 常规构建
run("pnpm", ["--filter", "@adb-studio/adb-core", "build"]);
run("pnpm", ["--filter", "@adb-studio/web", "build"]);
run("pnpm", ["--filter", "@adb-studio/server", "build"]);

const webDist = join(root, "apps/web/dist");
const serverPublic = join(root, "apps/server/public");
if (!existsSync(join(webDist, "index.html"))) {
  console.error("前端构建产物缺失");
  process.exit(1);
}
rmSync(serverPublic, { recursive: true, force: true });
mkdirSync(serverPublic, { recursive: true });
cpSync(webDist, serverPublic, { recursive: true });

// 2) 组装生产目录
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "apps/server/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: true,
  legalComments: "none",
  outfile: join(outDir, "server.mjs"),
  packages: "bundle",
  banner: {
    js: `import { createRequire as __adbCreateRequire } from 'node:module'; const require = __adbCreateRequire(import.meta.url);`,
  },
  logLevel: "info",
});

cpSync(webDist, join(outDir, "public"), { recursive: true });

const vendorSrc = join(root, "apps/server/vendor/scrcpy");
const vendorDst = join(outDir, "vendor/scrcpy");
if (!existsSync(join(vendorSrc, "scrcpy-server"))) {
  console.error("缺少 apps/server/vendor/scrcpy/scrcpy-server");
  process.exit(1);
}
mkdirSync(vendorDst, { recursive: true });
cpSync(vendorSrc, vendorDst, { recursive: true });

const ptSrc = await ensurePlatformTools();
await ensurePortableNode();

function findUpx() {
  if (!isWinTarget) return null;
  const candidates = [
    join(cacheDir, "upx-5.0.2-win64", "upx.exe"),
    join(cacheDir, "upx-4.2.4-win64", "upx.exe"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  if (process.platform === "win32") {
    const wh = spawnSync("where.exe", ["upx"], {
      encoding: "utf8",
      shell: false,
    });
    if (wh.status === 0 && wh.stdout.trim()) {
      return wh.stdout.trim().split(/\r?\n/)[0];
    }
  }
  return null;
}

/**
 * 用 UPX 压缩 dest；若 .cache/upx-packed 已有对应源文件哈希的缓存则直接拷贝（跳过慢压缩）。
 */
function applyUpxCached(sourcePath, destPath, cachePrefix) {
  if (!isWinTarget) return;
  if (!existsSync(sourcePath)) {
    console.warn(`UPX 跳过：源文件不存在 ${sourcePath}`);
    return;
  }
  mkdirSync(upxCacheDir, { recursive: true });
  const hash = fileSha256(sourcePath);
  const cached = join(upxCacheDir, `${cachePrefix}-${hash}.exe`);

  if (existsSync(cached)) {
    cpSync(cached, destPath);
    console.log(`UPX 缓存命中 → ${cachePrefix}（跳过压缩）`);
    return;
  }

  const upx = findUpx();
  if (!upx) {
    console.log("未检测到 UPX，跳过可执行文件二次压缩（可选）");
    return;
  }

  cpSync(sourcePath, destPath);
  console.log(`UPX 压缩 ${destPath}（首次，完成后写入缓存）`);
  const r = spawnSync(upx, ["--best", "--lzma", destPath], {
    stdio: "inherit",
    shell: false,
  });
  if (r.status !== 0) {
    console.warn("UPX 失败，保留原文件");
    cpSync(sourcePath, destPath);
    return;
  }
  cpSync(destPath, cached);
  console.log(`UPX 已缓存 → ${cached}`);
}

if (isWinTarget) {
  const nodeSrc = join(cacheDir, `node-v${NODE_VERSION}-win-x64`, "node.exe");
  applyUpxCached(nodeSrc, join(outDir, "runtime", "node.exe"), `node-${NODE_VERSION}`);
  applyUpxCached(
    join(ptSrc, "adb.exe"),
    join(outDir, "platform-tools", "adb.exe"),
    "adb",
  );
}

const envBody = `HOST=127.0.0.1
PORT=3789
ADB_PATH=./platform-tools/${adbBin}
RATE_LIMIT_PER_MIN=120
OPEN_BROWSER=1
`;
writeFileSync(join(outDir, ".env.example"), envBody);
writeFileSync(join(outDir, ".env"), envBody);

if (isWinTarget) {
  writeBat(join(outDir, "start.bat"), START_BAT);
  writeBat(join(outDir, "stop.bat"), STOP_BAT);
  writeText(join(outDir, "run.ps1"), RUN_PS1);
} else {
  writeUnix(join(outDir, "start.sh"), START_SH);
  writeUnix(join(outDir, "stop.sh"), STOP_SH);
}

writeFileSync(
  join(outDir, "README.txt"),
  isWinTarget
    ? `ADB Studio 生产包（Windows 免安装）
========================

无需安装 Node.js / 无需配置环境变量。
双击 start.bat 即可运行。

地址：http://127.0.0.1:3789

内置：
- runtime/node.exe（便携 Node）
- platform-tools/adb.exe
- 前后端一体界面

说明：
- 仅监听 127.0.0.1
- 配置见 .env
- 临时文件在 tmp/
`
    : `ADB Studio 生产包（macOS 免安装）
========================

无需安装 Node.js。
在终端执行：
  chmod +x start.sh stop.sh runtime/node platform-tools/adb
  ./start.sh

Apple Silicon 包请用 arm64；Intel Mac 请用 x64 包。
若提示损坏/无法打开，可执行：
  xattr -dr com.apple.quarantine .

地址：http://127.0.0.1:3789

内置：
- runtime/node（便携 Node）
- platform-tools/adb
- 前后端一体界面

说明：
- 仅监听 127.0.0.1
- 配置见 .env
- 临时文件在 tmp/
`,
);

// 3) 压缩归档
function packArchive(kind) {
  const dest =
    kind === "7z"
      ? join(root, "release", `ADB-Studio-${archiveTag}.7z`)
      : join(root, "release", `ADB-Studio-${archiveTag}.zip`);
  rmSync(dest, { force: true });
  const glob = process.platform === "win32" ? `${outDir}\\*` : `${outDir}/*`;
  const args =
    kind === "7z"
      ? ["a", "-t7z", "-mx=9", "-m0=lzma2", "-md=64m", "-ms=on", dest, glob]
      : ["a", "-tzip", "-mx=9", dest, glob];
  let r;
  if (process.platform === "win32") {
    const line = ["7z", ...args].map(quoteCmdArg).join(" ");
    r = spawnSync(line, { stdio: "inherit", shell: true });
  } else {
    r = spawnSync("7z", args, { stdio: "inherit", shell: false });
  }
  if (r.status !== 0) {
    console.warn(`${kind} 打包失败`);
    return;
  }
  console.log(`${kind.toUpperCase()} →`, dest);
}

const has7z =
  process.platform === "win32"
    ? spawnSync("where 7z", { encoding: "utf8", shell: true })
    : spawnSync("which", ["7z"], { encoding: "utf8", shell: false });
if (has7z.status === 0) {
  packArchive("7z");
  packArchive("zip");
} else if (process.platform === "win32") {
  const zipPath = join(root, "release", `ADB-Studio-${archiveTag}.zip`);
  rmSync(zipPath, { force: true });
  const zip = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${outDir}' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: "inherit", shell: false },
  );
  if (zip.status !== 0) console.warn("ZIP 打包失败，目录仍可用：", outDir);
  else console.log("ZIP →", zipPath);
} else {
  const zipPath = join(root, "release", `ADB-Studio-${archiveTag}.zip`);
  rmSync(zipPath, { force: true });
  const zip = spawnSync(
    "zip",
    ["-r", "-9", zipPath, "ADB-Studio"],
    { cwd: join(root, "release"), stdio: "inherit", shell: false },
  );
  if (zip.status !== 0) console.warn("ZIP 打包失败，目录仍可用：", outDir);
  else console.log("ZIP →", zipPath);
}

console.log(`生产目录 → ${outDir}（目标 ${RELEASE_OS}/${RELEASE_ARCH}）`);
console.log("文件：", readdirSync(outDir).join(", "));
if (isWinTarget) console.log("UPX 缓存目录：", upxCacheDir);
