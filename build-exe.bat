@echo off
setlocal EnableExtensions
title Roshetta Pro - Build Windows EXE
cd /d "%~dp0"

echo ==================================================
echo    Roshetta Pro - building the Windows installer
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node
where npm >nul 2>nul
if errorlevel 1 goto no_node

echo [1/5] Installing packages...
if exist node_modules goto install_update
if exist package-lock.json goto install_ci
goto install_fresh

:install_ci
echo       (first run - this downloads the build tools, a few hundred MB)
call npm ci --no-audit --no-fund
goto install_done

:install_fresh
call npm install --no-audit --no-fund
goto install_done

:install_update
call npm install --no-audit --no-fund

:install_done
if errorlevel 1 goto fail

echo.
echo [2/5] Checking packaging settings and app icon...
call npm run check:packaging
if errorlevel 1 goto fail

echo.
echo [3/5] Type check and build the UI...
call npm run build
if errorlevel 1 goto fail

echo.
echo [4/5] Packing the installer and the portable EXE...
echo       (first time takes a few minutes)
call npx electron-builder --win nsis portable --publish never
if errorlevel 1 goto fail

echo.
echo [5/5] Output files:
if not exist "release" goto no_release
dir /b "release\*.exe"
echo.
echo ==================================================
echo    DONE.
echo    The target PC needs NOTHING installed.
echo    Chromium, Node and every app file are inside the EXE.
echo    User data lives in %%APPDATA%%\Roshetta Pro and is kept
echo    even if the program is uninstalled.
echo ==================================================
echo.
start "" "release"
pause
exit /b 0

:no_node
echo.
echo [ERROR] Node.js is not installed on this build machine.
echo Install the LTS version from https://nodejs.org and run this file again.
echo Reminder: only the BUILD machine needs Node.js. The EXE needs nothing.
echo.
pause
exit /b 1

:no_release
echo.
echo [ERROR] The build finished but the release folder was not created.
goto fail

:fail
echo.
echo [ERROR] The build failed. Read the messages above.
echo Common fixes:
echo   - run "npm install" once with internet access
echo   - close any running Roshetta Pro window and try again
echo   - delete the release folder and retry
echo.
pause
exit /b 1
