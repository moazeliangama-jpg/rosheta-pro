// اختبارات منطق الدخول: متى نعتبره نجح/فشل/لسه بنستنى، والرسالة اللي تظهر للمستخدم
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const L = require("../electron/nd-login.cjs");

test("الدخول: التعرّف على صفحة الدخول", () => {
  assert.equal(L.isLoginUrl("https://nicedeer.net/Account/Login"), true);
  assert.equal(L.isLoginUrl("https://nicedeer.net/Account/Login?ReturnUrl=%2FApps"), true);
  assert.equal(L.isLoginUrl("https://nicedeer.net/Apps/NewPharmacy/Beneficiary/Search"), false);
  assert.equal(L.isLoginUrl(""), false);
  assert.equal(L.isLoginUrl(null), false);
});

test("الدخول: صفحة البحث = نجاح مؤكد", () => {
  const r = L.classifyAfterLogin({ state: "logged-in", url: "https://nicedeer.net/Apps/NewPharmacy/Beneficiary/Search" });
  assert.equal(r.done, true);
  assert.equal(r.outcome, "success");
});

test("الدخول: رسالة رفض من الموقع = فشل نهائي مع نص الموقع", () => {
  const r = L.classifyAfterLogin({ state: "error", errorText: "Invalid login attempt", url: "https://nicedeer.net/Account/Login" });
  assert.equal(r.done, true);
  assert.equal(r.outcome, "error");
  assert.match(r.reason, /Invalid login attempt/);
});

test("الدخول: التحقق البشري بيستنى الأول وبعد المهلة بيفشل برسالة مختلفة", () => {
  const probe = { state: "challenge", url: "https://nicedeer.net/Account/Login" };
  const waiting = L.classifyAfterLogin(probe, { elapsedMs: 2000, timeoutMs: 60000 });
  assert.equal(waiting.done, false);
  const ended = L.classifyAfterLogin(probe, { elapsedMs: 61000, timeoutMs: 60000 });
  assert.equal(ended.done, true);
  assert.equal(ended.outcome, "challenge");
});

test("الدخول: الفورم اللي رجع بعد الضغط = بيانات مش مقبولة", () => {
  const probe = { state: "form", url: "https://nicedeer.net/Account/Login", hasUser: true, hasPass: true };
  assert.equal(L.classifyAfterLogin(probe, { elapsedMs: 1000, timeoutMs: 30000 }).done, false);
  const ended = L.classifyAfterLogin(probe, { elapsedMs: 31000, timeoutMs: 30000 });
  assert.equal(ended.done, true);
  assert.equal(ended.outcome, "form");
});

test("الدخول: الخروج من صفحة الدخول = نروح نتأكد من صفحة البحث", () => {
  const r = L.classifyAfterLogin({ state: "unknown", url: "https://nicedeer.net/Apps/Home/Dashboard" }, { elapsedMs: 3000 });
  assert.equal(r.done, true);
  assert.equal(r.outcome, "maybe");
});

test("الدخول: صفحة مجهولة لسه على /Account/Login = نكمل استنى", () => {
  const r = L.classifyAfterLogin({ state: "unknown", url: "https://nicedeer.net/Account/Login" }, { elapsedMs: 3000, timeoutMs: 30000 });
  assert.equal(r.done, false);
});

test("الدخول: مفيش قراءة من الصفحة والمهلة خلصت = timeout", () => {
  assert.equal(L.classifyAfterLogin(null, { elapsedMs: 1000, timeoutMs: 30000 }).done, false);
  const ended = L.classifyAfterLogin(null, { elapsedMs: 30001, timeoutMs: 30000 });
  assert.equal(ended.done, true);
  assert.equal(ended.outcome, "timeout");
});

test("الدخول: وصف القراءة بيقول الخانات والتحقق والرسالة", () => {
  const text = L.describeProbe({
    state: "challenge",
    url: "https://nicedeer.net/Account/Login",
    hasUser: true,
    hasPass: true,
    challenge: true,
    title: "Login",
  });
  assert.match(text, /تحقق بشري ظاهر/);
  assert.match(text, /خانات الدخول/);
  assert.match(text, /\/Account\/Login/);
});

test("الدخول: رسالة الفشل فيها السبب والخطوة الجاية", () => {
  const msg = L.buildLoginFailure({
    outcome: "challenge",
    reason: "تحقق بشري ماحلّش",
    probe: { state: "challenge", url: "https://nicedeer.net/Account/Login" },
  });
  assert.match(msg, /تحقق بشري/);
  assert.match(msg, /الخطوة الجاية/);
});

test("الدخول: رسالة الفشل بتحيل لملفات التشخيص لو محفوظة", () => {
  const msg = L.buildLoginFailure({
    outcome: "timeout",
    files: { html: "C:\\data\\diagnostics\\login-1.html", image: "C:\\data\\diagnostics\\login-1.png" },
  });
  assert.match(msg, /login-1\.html/);
  assert.match(msg, /login-1\.png/);
});

test("الدخول: سجل المحاولة بيتقصّر على آخر سطور", () => {
  const trace = Array.from({ length: 30 }, (_, i) => `خطوة ${i}`);
  const out = L.summarizeTrace(trace, 5);
  assert.equal(out.length, 5);
  assert.equal(out.at(-1), "خطوة 29");
  assert.deepEqual(L.summarizeTrace(null), []);
});

test("الدخول: ضغط Enter كخطة بديلة بعد ٦ ثواني وبمرة واحدة بس", () => {
  assert.equal(L.shouldTryEnterFallback({ outcome: "form", elapsedMs: 1000, alreadyTried: false }), false);
  assert.equal(L.shouldTryEnterFallback({ outcome: "form", elapsedMs: 7000, alreadyTried: false }), true);
  assert.equal(L.shouldTryEnterFallback({ outcome: "form", elapsedMs: 7000, alreadyTried: true }), false);
  assert.equal(L.shouldTryEnterFallback({ outcome: "success", elapsedMs: 7000, alreadyTried: false }), false);
});

test("الدخول: اسم ملف التشخيص آمن", () => {
  const name = L.diagnosticsName("login/attempt:*", new Date(2026, 0, 5, 7, 8, 9));
  assert.equal(name, "login-attempt---20260105-070809");
  assert.equal(/[\\/:*?"<>|]/.test(name), false);
});
