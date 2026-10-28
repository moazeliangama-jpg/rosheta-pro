// اختبارات تحليل صفحات نايس دير: تصنيف صفحة الدخول + استخراج مصادر صورة الروشتة
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RX = require("../electron/rx-page.cjs");

// ---------------------------------------------------------------------------
// تصنيف صفحة الدخول
// ---------------------------------------------------------------------------

test("الدخول: صفحة الفورم العادية", () => {
  const r = RX.classifyLoginPage({
    url: "https://nicedeer.net/Account/Login",
    title: "Login",
    hasUser: true,
    hasPass: true,
    hasBtn: true,
  });
  assert.equal(r.state, "form");
});

test("الدخول: متسجل بالفعل لأن صفحة البحث ظاهرة", () => {
  const r = RX.classifyLoginPage({ url: "https://nicedeer.net/Apps/NewPharmacy/Beneficiary/Search", hasCode: true });
  assert.equal(r.state, "logged-in");
});

test("الدخول: تحقق Cloudflare بيتكشف من العنوان أو العنوان الظاهر أو الفريم", () => {
  assert.equal(RX.classifyLoginPage({ title: "Just a moment..." }).state, "challenge");
  assert.equal(RX.classifyLoginPage({ title: "Attention Required! | Cloudflare" }).state, "challenge");
  assert.equal(
    RX.classifyLoginPage({ url: "https://nicedeer.net/cdn-cgi/challenge-platform/h/b/orchestrate/captcha" }).state,
    "challenge",
  );
  assert.equal(RX.classifyLoginPage({ hasUser: true, hasPass: true, challenge: true }).state, "challenge");
});

test("الدخول: رسالة رفض من الموقع بتوصل كخطأ واضح", () => {
  const r = RX.classifyLoginPage({
    url: "https://nicedeer.net/Account/Login",
    hasUser: true,
    hasPass: true,
    hasBtn: true,
    errorText: "Invalid username or password",
  });
  assert.equal(r.state, "error");
  assert.match(r.message, /Invalid username or password/);
});

test("الدخول: صفحة غريبة أو بطيئة = unknown مش «فشل»", () => {
  assert.equal(RX.classifyLoginPage({ url: "about:blank", title: "" }).state, "unknown");
  assert.equal(RX.classifyLoginPage({}).state, "unknown");
});

test("الدخول: تنظيف نص الخطأ من الضوضاء", () => {
  assert.equal(RX.pickLoginError("   "), "");
  assert.equal(RX.pickLoginError("a"), "");
  assert.match(RX.pickLoginError("  Invalid   login  attempt  "), /Invalid login attempt/);
  assert.equal(RX.pickLoginError("x".repeat(900)).length, 300);
});

// ---------------------------------------------------------------------------
// استخراج مصادر صورة الروشتة
// ---------------------------------------------------------------------------

const RX_PAGE = `<!doctype html><html><head>
  <meta property="og:image" content="/img/social-logo.png">
  <style>.bg{background-image:url('/img/pattern.png')}</style>
</head><body>
  <img src="/img/logo-small.png" alt="logo">
  <img src="/Apps/NewPharmacy/Beneficiary/PrescriptionImgs?ParKey8=abc&amp;ParKey=def" class="rx">
  <iframe src="/partial/header"></iframe>
  <script src="/js/app.js"></script>
</body></html>`;

test("الصور: رابط الروشتة خارج من الـHTML بترتيب أولوية", () => {
  const urls = RX.extractImageUrls(RX_PAGE, "https://nicedeer.net/Apps/NewPharmacy/Beneficiary/Search");
  assert.ok(urls.length >= 2);
  assert.match(urls[0], /PrescriptionImgs/);
  assert.ok(urls[0].startsWith("https://nicedeer.net/"), "الرابط النسبي لازم يتحوّل لمطلق");
  assert.equal(urls[0].includes("&amp;"), false, "الـHTML entities لازم تتفك");
});

test("الصور: بيتجاهل السكربتات والتتبّع والـsvg الصغير", () => {
  const html = `
    <script src="/js/app.js"></script>
    <link rel="stylesheet" href="/css/site.css">
    <img src="/img/logo.svg">
    <img src="https://www.google-analytics.com/collect?x=1">
    <img src="/content/rx-320644.jpg">`;
  const urls = RX.extractImageUrls(html, "https://nicedeer.net/x");
  assert.equal(urls.some((u) => /app\.js|site\.css|logo\.svg|google-analytics/.test(u)), false);
  assert.ok(urls.some((u) => /rx-320644\.jpg/.test(u)));
});

test("الصور: srcset و data-src و embed PDF", () => {
  const html = `
    <img srcset="/big/rx-2x.jpg 2x, /big/rx-1x.jpg 1x">
    <img data-src="/lazy/rx-lazy.png">
    <embed type="application/pdf" src="/Files/prescription.pdf">`;
  const urls = RX.extractImageUrls(html, "https://nicedeer.net/");
  assert.ok(urls.includes("https://nicedeer.net/big/rx-2x.jpg"));
  assert.ok(urls.includes("https://nicedeer.net/lazy/rx-lazy.png"));
  assert.ok(urls.some((u) => u.endsWith("prescription.pdf")));
  // الـPDF آخر الأولوية
  assert.match(urls.at(-1), /\.pdf$/);
});

test("الصور: data:image كبيرة بتنزل كمصدر مباشر", () => {
  const big = `data:image/jpeg;base64,${"A".repeat(3000)}`;
  const urls = RX.extractImageUrls(`<img src="${big}">`, "https://nicedeer.net/");
  assert.equal(urls.length, 1);
  assert.equal(urls[0], big);
});

test("الصور: HTML فاضي أو بدون صور", () => {
  assert.deepEqual(RX.extractImageUrls("", "https://x/"), []);
  assert.deepEqual(RX.extractImageUrls("<p>مفيش صور</p>", "https://x/"), []);
});

test("أنواع المحتوى: صورة / PDF / تاني", () => {
  assert.equal(RX.isDisplayableImageType("image/jpeg; charset=binary"), true);
  assert.equal(RX.isDisplayableImageType("image/png"), true);
  assert.equal(RX.isDisplayableImageType("image/svg+xml"), false);
  assert.equal(RX.isDisplayableImageType("text/html"), false);
  assert.equal(RX.isPdfType("application/pdf"), true);
  assert.equal(RX.isPdfType("text/html"), false);
});

test("اللقطة الفاضية: بيضاء مضغوطة = فاضية", () => {
  assert.equal(RX.isLikelyBlankShot(3000), true);
  assert.equal(RX.isLikelyBlankShot(45000), false);
  assert.equal(RX.isLikelyBlankShot(0), true);
});

test("صفحة PDF المدمجة بتتكشف", () => {
  assert.equal(RX.looksLikePdfViewer('<embed type="application/pdf" src="/x.pdf">'), true);
  assert.equal(RX.looksLikePdfViewer("<html><body>عادي</body></html>"), false);
});

test("اللقطة الفاضية بالبكسل: صفحة بيضاء أو لون واحد = فاضية", () => {
  const white = Buffer.alloc(1000 * 4, 255);
  assert.equal(RX.isBlankBitmap(white), true);
  assert.equal(RX.isBlankBitmap(Buffer.alloc(0)), true);
  const noise = Buffer.alloc(4000 * 4);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 37) % 255;
  assert.equal(RX.isBlankBitmap(noise), false);
});

test("اللقطة الفاضية بالبكسل: منطقة فيها محتوى بتعدّي", () => {
  const buf = Buffer.alloc(2000 * 4, 250);
  for (let i = 0; i < 500; i += 1) {
    const o = i * 4;
    buf[o] = 10; buf[o + 1] = 10; buf[o + 2] = 10;
  }
  assert.equal(RX.isBlankBitmap(buf), false);
});
