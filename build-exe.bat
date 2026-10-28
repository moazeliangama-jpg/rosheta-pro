@echo off
chcp 65001 >nul
title Roshetta Pro - بناء ملف التثبيت
echo ==================================================
echo    روشتة برو — بناء نسخة سطح المكتب (EXE)
echo ==================================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [خطأ] Node.js غير مثبّت على هذا الجهاز.
  echo نزّله من https://nodejs.org ثم أعد تشغيل هذا الملف.
  pause
  exit /b 1
)

echo [1/3] تثبيت الحزم...
call npm install
if errorlevel 1 goto fail

echo.
echo [2/3] بناء واجهة التطبيق...
call npm run build
if errorlevel 1 goto fail

echo.
echo [3/3] تغليف ملف التثبيت EXE (قد يستغرق بضع دقائق أول مرة)...
call npx electron-builder --win nsis portable --config electron-builder.yml
if errorlevel 1 goto fail

echo.
echo ==================================================
echo    تم البناء بنجاح!
echo    ملف التثبيت: release\RoshettaPro-Setup-1.0.0.exe
echo    نسخة محمولة بدون تثبيت: release\RoshettaPro-Portable-1.0.0.exe
echo ==================================================
explorer release
pause
exit /b 0

:fail
echo.
echo [خطأ] حدثت مشكلة أثناء البناء — راجع الرسائل أعلاه.
pause
exit /b 1
