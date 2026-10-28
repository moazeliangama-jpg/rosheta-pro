@echo off
setlocal EnableExtensions
title Roshetta Pro
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node
where npm >nul 2>nul
if errorlevel 1 goto no_node

if exist node_modules goto build
echo [1/3] Installing packages (first run only)...
call npm ci --no-audit --no-fund 2>nul || call npm install --no-audit --no-fund
if errorlevel 1 goto fail

:build
echo [2/3] Building the UI...
call npm run build
if errorlevel 1 goto fail

echo [3/3] Starting Roshetta Pro...
call npx electron .
exit /b 0

:no_node
echo.
echo [ERROR] Node.js is not installed.
echo Install the LTS version from https://nodejs.org then run this file again.
echo (To build the standalone EXE instead, use build-exe.bat on a PC with Node.js.)
echo.
pause
exit /b 1

:fail
echo.
echo [ERROR] Something failed - read the messages above.
echo.
pause
exit /b 1
