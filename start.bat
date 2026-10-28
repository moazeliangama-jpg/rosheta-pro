@echo off
chcp 65001 >nul
title Roshetta Pro
cd /d "%~dp0"

if not exist node_modules (
  echo [1/3] تثبيت الحزم لاول مرة...
  call npm install
  if errorlevel 1 goto fail
)

echo [2/3] بناء الواجهة...
call npm run build
if errorlevel 1 goto fail

echo [3/3] تشغيل البرنامج...
call npx electron .
exit /b 0

:fail
echo.
echo [خطأ] راجع الرسائل فوق.
pause
exit /b 1
