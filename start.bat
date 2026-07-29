@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ADB Studio

if exist "%~dp0release\ADB-Studio\start.bat" (
  call "%~dp0release\ADB-Studio\start.bat"
  exit /b %ERRORLEVEL%
)

echo [ERROR] Missing release\ADB-Studio\
echo Run: pnpm release
echo.
pause
exit /b 1