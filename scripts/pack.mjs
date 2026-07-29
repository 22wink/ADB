import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readdirSync,
  createWriteStream,
  readFileSync,
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
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;

/** Windows cmd 参数转义（供 shell:true 单行命令，避免 DEP0190 的 args+shell） */
function quoteCmdArg(arg) {
  const s = String(arg);
  if (!/[ \t"]/g.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  if (process.platform === "win32") {
    // .cmd 必须经 shell；不要传 args 数组（会 DEP0190 / 部分环境 EINVAL）
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

async function ensurePortableNode() {
  mkdirSync(cacheDir, { recursive: true });
  const zipPath = join(cacheDir, NODE_ZIP);
  const extractDir = join(cacheDir, `node-v${NODE_VERSION}-win-x64`);
  const nodeExe = join(extractDir, "node.exe");

  if (!existsSync(nodeExe)) {
    if (!existsSync(zipPath)) {
      await download(NODE_URL, zipPath);
    }
    console.log("解压便携 Node ...");
    rmSync(extractDir, { recursive: true, force: true });
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${cacheDir}' -Force`,
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0 || !existsSync(nodeExe)) {
      throw new Error("解压 Node 失败");
    }
  }

  const runtimeDir = join(outDir, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  cpSync(nodeExe, join(runtimeDir, "node.exe"));
  // Windows Node 官方包通常只需 node.exe；若存在同目录 dll 一并拷贝
  for (const name of readdirSync(extractDir)) {
    if (/\.dll$/i.test(name)) {
      cpSync(join(extractDir, name), join(runtimeDir, name));
    }
  }
  console.log(`已内置 Node ${NODE_VERSION} → runtime/node.exe`);
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

function writeBat(filePath, content) {
  writeFileSync(filePath, content.replace(/\r?\n/g, "\r\n"), "ascii");
}

function writeText(filePath, content) {
  writeFileSync(filePath, content.replace(/\r?\n/g, "\r\n"), "utf8");
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

const ptSrc = join(root, "platform-tools");
const ptDst = join(outDir, "platform-tools");
mkdirSync(ptDst, { recursive: true });
for (const name of [
  "adb.exe",
  "AdbWinApi.dll",
  "AdbWinUsbApi.dll",
  "libwinpthread-1.dll",
  "source.properties",
]) {
  const from = join(ptSrc, name);
  if (!existsSync(from)) {
    console.error(`缺少 platform-tools/${name}`);
    process.exit(1);
  }
  cpSync(from, join(ptDst, name));
}

await ensurePortableNode();

function findUpx() {
  const candidates = [
    join(cacheDir, "upx-5.0.2-win64", "upx.exe"),
    join(cacheDir, "upx-4.2.4-win64", "upx.exe"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const wh = spawnSync("where.exe", ["upx"], {
    encoding: "utf8",
    shell: false,
  });
  if (wh.status === 0 && wh.stdout.trim()) {
    return wh.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

/**
 * 用 UPX 压缩 dest；若 .cache/upx-packed 已有对应源文件哈希的缓存则直接拷贝（跳过慢压缩）。
 * @param {string} sourcePath 未压缩原文件（用于算缓存键）
 * @param {string} destPath 发布目录中的目标 exe
 * @param {string} cachePrefix 缓存文件名前缀
 */
function applyUpxCached(sourcePath, destPath, cachePrefix) {
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

  // 确保 dest 是未压缩副本再压
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

const nodeSrc = join(cacheDir, `node-v${NODE_VERSION}-win-x64`, "node.exe");
applyUpxCached(nodeSrc, join(outDir, "runtime", "node.exe"), `node-${NODE_VERSION}`);
applyUpxCached(
  join(ptSrc, "adb.exe"),
  join(outDir, "platform-tools", "adb.exe"),
  "adb",
);

writeFileSync(
  join(outDir, ".env.example"),
  `HOST=127.0.0.1
PORT=3789
ADB_PATH=./platform-tools/adb.exe
RATE_LIMIT_PER_MIN=120
OPEN_BROWSER=1
`,
);
writeFileSync(
  join(outDir, ".env"),
  `HOST=127.0.0.1
PORT=3789
ADB_PATH=./platform-tools/adb.exe
RATE_LIMIT_PER_MIN=120
OPEN_BROWSER=1
`,
);
writeBat(join(outDir, "start.bat"), START_BAT);
writeBat(join(outDir, "stop.bat"), STOP_BAT);
writeText(join(outDir, "run.ps1"), RUN_PS1);
writeFileSync(
  join(outDir, "README.txt"),
  `ADB Studio 生产包（免安装）
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
`,
);

// 3) 极限压缩：优先 7z，其次 zip（需本机有 7z）
function packArchive(kind) {
  const dest =
    kind === "7z"
      ? join(root, "release", "ADB-Studio-win.7z")
      : join(root, "release", "ADB-Studio-win.zip");
  rmSync(dest, { force: true });
  const args =
    kind === "7z"
      ? ["a", "-t7z", "-mx=9", "-m0=lzma2", "-md=64m", "-ms=on", dest, `${outDir}\\*`]
      : ["a", "-tzip", "-mx=9", dest, `${outDir}\\*`];
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
} else {
  const zipPath = join(root, "release", "ADB-Studio-win.zip");
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
}

console.log("生产目录 →", outDir);
console.log("文件：", readdirSync(outDir).join(", "));
console.log("UPX 缓存目录：", upxCacheDir);
