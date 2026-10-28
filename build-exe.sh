#!/usr/bin/env bash
# بناء نسخة سطح المكتب من على لينكس/ماك — ملاحظة: بناء ملف Windows يتطلب wine
set -e

echo "==> تثبيت الحزم"
npm install

echo "==> فحص إعدادات التغليف"
npm run check:packaging

echo "==> بناء واجهة التطبيق"
npm run build

if [[ "$1" == "win" ]]; then
  echo "==> تغليف EXE لويندوز (يتطلب wine على لينكس)"
  npx electron-builder --win nsis portable --config electron-builder.yml
else
  echo "==> تغليف لنظام التشغيل الحالي"
  npx electron-builder --config electron-builder.yml
fi

echo "==> تم — الناتج في مجلد release/"
