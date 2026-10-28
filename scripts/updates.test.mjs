// اختبار منطق التحديث (مقارنة الإصدارات + اختيار ملف التثبيت)
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseVersion, isNewer, pickInstallerAsset, describeUpdate, isAllowedUpdateUrl, isInsideDir } = require(
  "../electron/updates.cjs",
);

test("تفكيك الإصدار", () => {
  assert.deepEqual(parseVersion("v1.2.3"), { major: 1, minor: 2, patch: 3, pre: "" });
  assert.deepEqual(parseVersion("1.0.0-beta.1"), { major: 1, minor: 0, patch: 0, pre: "beta.1" });
  assert.equal(parseVersion("abc"), null);
  assert.equal(parseVersion(""), null);
});

test("مقارنة الإصدارات", () => {
  assert.equal(isNewer("1.0.1", "1.0.0"), true);
  assert.equal(isNewer("1.1.0", "1.0.9"), true);
  assert.equal(isNewer("2.0.0", "1.9.9"), true);
  assert.equal(isNewer("1.0.0", "1.0.0"), false);
  assert.equal(isNewer("1.0.0", "1.0.1"), false);
  assert.equal(isNewer("1.0.0", "1.0.0-beta"), true, "النهائي أحدث من البيتا");
  assert.equal(isNewer("1.0.0-beta", "1.0.0"), false);
  assert.equal(isNewer("سيء", "1.0.0"), false);
});

test("اختيار ملف التثبيت من الأصول", () => {
  const assets = [
    { name: "RoshettaPro-Portable-1.1.0.exe", browser_download_url: "https://x/portable.exe", size: 10 },
    { name: "RoshettaPro-Setup-1.1.0.exe", browser_download_url: "https://x/setup.exe", size: 20 },
    { name: "latest.yml", browser_download_url: "https://x/latest.yml" },
  ];
  const picked = pickInstallerAsset(assets);
  assert.equal(picked.name, "RoshettaPro-Setup-1.1.0.exe", "المثبّت مقدم على المحمول");
  assert.equal(pickInstallerAsset([]), null);
  assert.equal(pickInstallerAsset([{ name: "x.zip", browser_download_url: "u" }]), null);
});

test("ملخص التحديث للمستخدم", () => {
  assert.equal(describeUpdate({ current: "1.0.0", latest: null }).available, false);
  assert.equal(describeUpdate({ current: "1.0.0", latest: "1.0.0" }).available, false);
  const withAsset = describeUpdate({
    current: "1.0.0",
    latest: "1.2.0",
    asset: { name: "s.exe", browser_download_url: "u", size: 5 * 1024 * 1024 },
  });
  assert.equal(withAsset.available, true);
  assert.equal(withAsset.canInstall, true);
  assert.match(withAsset.message, /1\.2\.0/);
  const noAsset = describeUpdate({ current: "1.0.0", latest: "1.2.0", asset: null });
  assert.equal(noAsset.canInstall, false);
});

// ---------------------------------------------------------------------------
// حراسة روابط/ملفات التحديث (أمان)
// ---------------------------------------------------------------------------

test("حراسة الرابط: مضيفات GitHub بس و https بس", () => {
  assert.equal(isAllowedUpdateUrl("https://github.com/o/r/releases/download/v1/app.exe"), true);
  assert.equal(isAllowedUpdateUrl("https://objects.githubusercontent.com/x/app.exe"), true);
  assert.equal(isAllowedUpdateUrl("https://release-assets.githubusercontent.com/x"), true);
  // مضيف شبه الاسم / بروتوكول غير آمن / بيانات دخول
  assert.equal(isAllowedUpdateUrl("https://github.com.evil.com/app.exe"), false);
  assert.equal(isAllowedUpdateUrl("http://github.com/app.exe"), false);
  assert.equal(isAllowedUpdateUrl("file:///C:/Windows/System32/calc.exe"), false);
  assert.equal(isAllowedUpdateUrl("https://user:pass@github.com/app.exe"), false);
  assert.equal(isAllowedUpdateUrl(""), false);
  assert.equal(isAllowedUpdateUrl("not a url"), false);
});

test("حراسة الملف: لازم يكون exe جوه مجلد التحديث", () => {
  const dir = "C:\\Users\\m\\AppData\\Local\\Temp\\roshetta-update";
  assert.equal(isInsideDir(`${dir}\\RoshettaPro-Setup-1.2.0.exe`, dir), true);
  // برّه المجلد / امتداد تاني / محاولة خروج بـ ..
  assert.equal(isInsideDir("C:\\Windows\\System32\\calc.exe", dir), false);
  assert.equal(isInsideDir(`${dir}\\..\\..\\evil.exe`, dir), false);
  assert.equal(isInsideDir(`${dir}\\readme.txt`, dir), false);
  assert.equal(isInsideDir(`${dir}-evil\\x.exe`, dir), false);
  assert.equal(isInsideDir("", dir), false);
});
