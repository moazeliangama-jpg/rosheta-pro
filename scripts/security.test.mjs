/**
 * اختبار حراسة الروابط — أهم حاجة هنا إن الدومينات اللي بتشبه الاسم بتترفض.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sec = require("../electron/security.cjs");

test("روابط نايس دير الحقيقية بتتقبل", () => {
  assert.equal(sec.isNiceDeerUrl("https://nicedeer.net/Account/Login"), true);
  assert.equal(sec.isNiceDeerUrl("https://nicedeer.net/Apps/NewPharmacy/Beneficiary/Search?x=1"), true);
  assert.equal(sec.isNiceDeerUrl("https://www.nicedeer.net/x"), true);
  assert.equal(sec.isNiceDeerUrl("http://nicedeer.net/"), true);
});

test("الدومينات اللي بتشبه الاسم بتترفض (الثغرة القديمة)", () => {
  assert.equal(sec.isNiceDeerUrl("https://nicedeer.net.evil.com/login"), false);
  assert.equal(sec.isNiceDeerUrl("https://evilnicedeer.net/"), false);
  assert.equal(sec.isNiceDeerUrl("https://nicedeer.net@evil.com/"), false);
  assert.equal(sec.isNiceDeerUrl("https://nicedeer.co/"), false);
  assert.equal(sec.isNiceDeerUrl("not a url"), false);
  assert.equal(sec.isNiceDeerUrl(undefined), false);
});

test("واتساب ويب بس — مفيش دومين شبهه", () => {
  assert.equal(sec.isWhatsAppUrl("https://web.whatsapp.com/send?phone=2010"), true);
  assert.equal(sec.isWhatsAppUrl("https://web.whatsapp.com.evil.io/"), false);
});

test("النافذة الرئيسية: ملفات محلية وسيرفر التطوير بس", () => {
  assert.equal(sec.isInternalAppUrl("file:///C:/app/dist/index.html"), true);
  assert.equal(sec.isInternalAppUrl("http://localhost:5173/"), false); // بدون devUrl
  assert.equal(sec.isInternalAppUrl("http://localhost:5173/", "http://localhost:5173"), true);
  assert.equal(sec.isInternalAppUrl("https://evil.com/?localhost:5173", "http://localhost:5173"), false);
  assert.equal(sec.isInternalAppUrl("https://evil.com/", "http://localhost:5173"), false);
});

test("الفتح الخارجي: http/https بس ومن غير بيانات دخول", () => {
  assert.equal(sec.isSafeExternalUrl("https://nicedeer.net"), true);
  assert.equal(sec.isSafeExternalUrl("http://example.com/x"), true);
  assert.equal(sec.isSafeExternalUrl("file:///C:/Windows/System32/cmd.exe"), false);
  assert.equal(sec.isSafeExternalUrl("ms-msdt:/id PCWDiagnostic"), false);
  assert.equal(sec.isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(sec.isSafeExternalUrl("https://user:pass@evil.com"), false);
  assert.equal(sec.isSafeExternalUrl("https://localhost"), false); // مفيش نقطة → مش دومين حقيقي
  assert.equal(sec.isSafeExternalUrl(""), false);
});

test("تنظيف الساب والتليفون", () => {
  assert.equal(sec.sanitizeSab(" ١٢٣ ٤٥٦ "), "١٢٣٤٥٦".replace(/[^\d]/g, ""));
  assert.equal(sec.sanitizeSab("123-456"), "123456");
  assert.equal(sec.sanitizeSab("12ab34"), "1234");
  assert.equal(sec.sanitizeSab("x".repeat(100)), "");
  assert.equal(sec.sanitizePhone("+20 100 123 4567"), "201001234567");
});
