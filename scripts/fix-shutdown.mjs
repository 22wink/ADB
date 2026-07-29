import { writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "release", "ADB-Studio");

spawnSync("pnpm", ["--filter", "@adb-studio/server", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

await esbuild.build({
  entryPoints: [join(root, "apps/server/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: true,
  legalComments: "none",
  outfile: join(out, "server.mjs"),
  packages: "bundle",
  banner: {
    js: `import { createRequire as __adbCreateRequire } from 'node:module'; const require = __adbCreateRequire(import.meta.url);`,
  },
  logLevel: "info",
});

// Pull START_BAT etc by re-importing from pack is heavy; copy from release files we already wrote
// Re-write scripts from pack.mjs by spawning node -e that imports - simpler: read pack and eval no
// Just copy run.ps1/start/stop already on disk if present; regenerate via dynamic import of constants

const packUrl = new URL("./pack.mjs", import.meta.url);
// pack.mjs always runs full build - instead duplicate write here from files in release

function crlfAscii(file, text) {
  writeFileSync(file, text.replace(/\r?\n/g, "\r\n"), "ascii");
}
function crlfUtf8(file, text) {
  writeFileSync(file, text.replace(/\r?\n/g, "\r\n"), "utf8");
}

const startBat = `@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ADB Studio

set "LOG=%~dp0start.log"
echo ===== %date% %time% =====> "%LOG%"

set "NODE_EXE=%~dp0runtime\\node.exe"
if not exist "%NODE_EXE%" (
  echo [ERROR] Missing runtime\\node.exe
  goto hold
)
if not exist "%~dp0server.mjs" (
  echo [ERROR] Missing server.mjs
  goto hold
)
if not exist "%~dp0run.ps1" (
  echo [ERROR] Missing run.ps1
  goto hold
)

echo Using bundled Node:
echo %NODE_EXE%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
set "ERR=%ERRORLEVEL%"
echo.
echo [EXIT] code %ERR%
if not "%ERR%"=="0" echo Start failed. See start.log

:hold
echo.
pause
endlocal
`;

const stopBat = `@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ADB Studio Stop
echo Stopping ADB Studio ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3789 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('Killing PID ' + $_.OwningProcess); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host 'Done.'"
echo.
pause
endlocal
`;

const runPs1 = `$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $root 'runtime\\node.exe'
$server = Join-Path $root 'server.mjs'
$port = 3789

function Stop-ListenPort([int]$Port) {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
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

crlfAscii(join(out, "start.bat"), startBat);
crlfAscii(join(out, "stop.bat"), stopBat);
crlfUtf8(join(out, "run.ps1"), runPs1);
console.log("server + start/stop scripts updated");
