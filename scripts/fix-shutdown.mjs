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
echo cwd=%cd%>> "%LOG%"

set "NODE_EXE=%~dp0runtime\\node.exe"
set "SERVER_JS=%~dp0server.mjs"
if not exist "%NODE_EXE%" (
  echo [ERROR] Missing runtime\\node.exe
  echo missing runtime>> "%LOG%"
  goto hold
)
if not exist "%SERVER_JS%" (
  echo [ERROR] Missing server.mjs
  goto hold
)
if not exist "%~dp0platform-tools\\adb.exe" (
  echo [ERROR] Missing platform-tools\\adb.exe
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

echo Stopping leftover process on port 3789 (if any)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port=3789; if (Test-Path '%~dp0.env') { $m=Select-String -Path '%~dp0.env' -Pattern '^\\s*PORT\\s*=\\s*(\\d+)' | Select-Object -First 1; if ($m) { $port=[int]$m.Matches[0].Groups[1].Value } }; Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('Killing PID ' + $_.OwningProcess); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host ('Ready. PORT=' + $port)"

echo Starting ADB Studio...
echo Open: http://127.0.0.1:3789
echo Press Ctrl+C or close this window to stop.
echo.
echo cmdline="%NODE_EXE%" "%SERVER_JS%">> "%LOG%"

REM 直接用 cmd 启动，避免 PowerShell Start-Process 把绝对路径参数传丢
"%NODE_EXE%" "%SERVER_JS%"
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

const stopBat = `@echo off
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

const runPs1 = `$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root
$node = Join-Path $root 'runtime\\node.exe'
$serverArg = 'server.mjs'
$server = Join-Path $root $serverArg
$port = 3789
$log = Join-Path $root 'start.log'

$envFile = Join-Path $root '.env'
if (Test-Path -LiteralPath $envFile) {
  $m = Select-String -Path $envFile -Pattern '^\\s*PORT\\s*=\\s*(\\d+)' | Select-Object -First 1
  if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
}

function Stop-ListenPort([int]$Port) {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path -LiteralPath $node)) {
  Write-Host "[ERROR] Missing runtime\\node.exe"
  exit 1
}
if (-not (Test-Path -LiteralPath $server)) {
  Write-Host "[ERROR] Missing server.mjs"
  exit 1
}

Add-Content -LiteralPath $log -Value ("cmdline=" + $node + " " + $serverArg + " cwd=" + $root)

Write-Host "Stopping leftover process on port $port (if any)..."
Stop-ListenPort $port
Start-Sleep -Milliseconds 300

Write-Host "Starting ADB Studio..."
Write-Host "Open: http://127.0.0.1:$port"
Write-Host "Press Ctrl+C or close this window to stop."
Write-Host ""

$exitCode = 0
try {
  & $node $serverArg
  $exitCode = $LASTEXITCODE
  if ($null -eq $exitCode) { $exitCode = 0 }
} finally {
  Stop-ListenPort $port
  Write-Host ""
  Write-Host "Stopped."
}
exit $exitCode
`;

crlfAscii(join(out, "start.bat"), startBat);
crlfAscii(join(out, "stop.bat"), stopBat);
crlfUtf8(join(out, "run.ps1"), runPs1);
console.log("server + start/stop scripts updated");
