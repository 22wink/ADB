@echo off
REM 紧急热修：复制到已解压的 ADB-Studio 目录，覆盖原 start.bat 后双击运行
REM 修复：PowerShell Start-Process 可能把 server.mjs 绝对路径传丢，导致
REM       Cannot find module '...\ADB-Studio-win'
setlocal EnableExtensions
cd /d "%~dp0"
title ADB Studio

set "LOG=%~dp0start.log"
echo ===== %date% %time% =====> "%LOG%"
echo cwd=%cd%>> "%LOG%"

set "NODE_EXE=%~dp0runtime\node.exe"
set "SERVER_JS=%~dp0server.mjs"
if not exist "%NODE_EXE%" (
  echo [ERROR] Missing runtime\node.exe
  goto hold
)
if not exist "%SERVER_JS%" (
  echo [ERROR] Missing server.mjs
  goto hold
)
if not exist "%~dp0platform-tools\adb.exe" (
  echo [ERROR] Missing platform-tools\adb.exe
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
  "$port=3789; if (Test-Path '%~dp0.env') { $m=Select-String -Path '%~dp0.env' -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1; if ($m) { $port=[int]$m.Matches[0].Groups[1].Value } }; Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('Killing PID ' + $_.OwningProcess); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host ('Ready. PORT=' + $port)"

echo Starting ADB Studio...
echo Open: http://127.0.0.1:3789
echo Press Ctrl+C or close this window to stop.
echo.
echo cmdline="%NODE_EXE%" "%SERVER_JS%">> "%LOG%"

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
