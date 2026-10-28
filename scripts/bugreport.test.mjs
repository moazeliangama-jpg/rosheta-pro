// اختبارات نظام الإبلاغ التلقائي عن الأخطاء (بدون Electron وبدون شبكة حقيقية)
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BUG = require("../electron/bugreport.cjs");

const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

// ---------------------------------------------------------------------------
// الإعدادات من البيئة
// ---------------------------------------------------------------------------

test("الإعدادات: من غير توكن = الإرسال مقفول مع سبب واضح", () => {
  const cfg = BUG.readConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.reason, "missing-token");
  assert.equal(cfg.repo, BUG.DEFAULT_REPO);
  assert.match(cfg.hint, /ROSHTA_GITHUB_TOKEN|GITHUB_TOKEN/);
});

test("الإعدادات: توكن من البيئة بيفعّل الإرسال", () => {
  const cfg = BUG.readConfig({ ROSHTA_GITHUB_TOKEN: TOKEN });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.tokenVar, "ROSHTA_GITHUB_TOKEN");
  assert.equal(cfg.token, TOKEN);
});

test("الإعدادات: GITHUB_TOKEN بديل مقبول، والتوكن القصير مرفوض", () => {
  assert.equal(BUG.readConfig({ GITHUB_TOKEN: TOKEN }).enabled, true);
  assert.equal(BUG.readConfig({ GITHUB_TOKEN: "short" }).enabled, false);
});

test("الإعدادات: التعطيل بمتغير بيئة بيغلب أي توكن", () => {
  const cfg = BUG.readConfig({ ROSHTA_GITHUB_TOKEN: TOKEN, ROSHTA_NO_BUG_REPORT: "1" });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.reason, "disabled-by-env");
  assert.equal(cfg.token, "");
});

test("الإعدادات: مستودع غير صالح بيرجع للمستودع الافتراضي (منع حقن في الرابط)", () => {
  assert.equal(BUG.readConfig({ ROSHTA_GITHUB_TOKEN: TOKEN, ROSHTA_ISSUE_REPO: "../../etc" }).repo, BUG.DEFAULT_REPO);
  assert.equal(
    BUG.readConfig({ ROSHTA_GITHUB_TOKEN: TOKEN, ROSHTA_ISSUE_REPO: "someone/other-repo" }).repo,
    "someone/other-repo",
  );
  assert.equal(BUG.isValidRepo("owner/repo"), true);
  assert.equal(BUG.isValidRepo("owner"), false);
  assert.equal(BUG.isValidRepo("owner/re po"), false);
});

test("describeConfig مابيسرّبش التوكن", () => {
  const info = BUG.describeConfig(BUG.readConfig({ ROSHTA_GITHUB_TOKEN: TOKEN }));
  assert.equal(JSON.stringify(info).includes(TOKEN), false);
});

// ---------------------------------------------------------------------------
// التنقيح
// ---------------------------------------------------------------------------

test("التنقيح: توكنات GitHub بكل أشكالها", () => {
  const text = `token ${TOKEN} و github_pat_11ABCDEFG0123456789_abcdefghijklmnop`;
  const out = BUG.redact(text);
  assert.equal(out.includes(TOKEN), false);
  assert.equal(/github_pat_/.test(out), false);
  assert.match(out, /<github-token>/);
});

test("التنقيح: هيدر Authorization وبيانات الدخول في الروابط", () => {
  const out = BUG.redact("headers: Authorization: Bearer abcdef1234567890 x\nescaped://admin:secretpass@host/x");
  assert.equal(out.includes("abcdef1234567890"), false);
  assert.equal(out.includes("secretpass"), false);
  assert.match(out, /<token>/);
  assert.match(out, /<pass>/);
});

test("التنقيح: كلمة سر أو توكن مكتوبين في نص الخطأ", () => {
  const out = BUG.redact('login failed password="MyP@ssw0rd" token=abcd1234efgh');
  assert.equal(out.includes("MyP@ssw0rd"), false);
  assert.equal(out.includes("abcd1234efgh"), false);
});

test("التنقيح: مسارات المستخدم + إيميلات", () => {
  const out = BUG.redact("at C:\\Users\\ahmed\\AppData\\main.js:10:5 and /home/moaz/app.js:3 and a@b.co");
  assert.equal(out.includes("ahmed"), false);
  assert.equal(out.includes("moaz"), false);
  assert.equal(out.includes("a@b.co"), false);
  assert.match(out, /<user>/);
  assert.match(out, /<email>/);
});

test("التنقيح: أرقام السواب والتليفونات + صور base64", () => {
  const out = BUG.redact("فشل ساب 123456 وتليفون 01012345678 وصورة data:image/png;base64,AAAA////BBBB");
  assert.equal(out.includes("123456"), false);
  assert.equal(out.includes("01012345678"), false);
  assert.equal(out.includes("AAAA////BBBB"), false);
  assert.match(out, /<num>/);
  assert.match(out, /<blob>/);
});

test("التنقيح: أرقام عربية-هندية (سواب مكتوبة بالعربي) بتتشال كمان", () => {
  const out = BUG.redact("فشل ساب ١٢٣٤٥٦ وتليفون ٠١٠١٢٣٤٥٦٧٨");
  assert.equal(out.includes("١٢٣٤٥٦"), false);
  assert.equal(out.includes("٠١٠١٢٣٤٥٦٧٨"), false);
  assert.match(out, /<num>/);
});

test("التنقيح: نصوص معروفة الحساسية بتتشال حرفيًا", () => {
  const out = BUG.redact("user=moaz_pass_123 happened", ["moaz_pass_123"]);
  assert.equal(out.includes("moaz_pass_123"), false);
  assert.match(out, /<secret>/);
  // النصوص القصيرة جدًا مش بتتشال (عشان ما تبوظش النص كله)
  assert.equal(BUG.redact("abc here", ["abc"]), "abc here");
});

test("التنقيح: نص فاضي/null مابيكسرش", () => {
  assert.equal(BUG.redact(""), "");
  assert.equal(BUG.redact(null), "");
  assert.equal(BUG.redact(undefined), "");
});

test("التنقيح: الضوضاء الزيادة بتتشال (مسافات وأسطر فاضية)", () => {
  assert.equal(BUG.redact("a    b\n\n\n\nc"), "a b\n\nc");
});

// ---------------------------------------------------------------------------
// البصمة والنوع
// ---------------------------------------------------------------------------

test("البصمة: نفس الخطأ = نفس البصمة، ورسالة مختلفة = بصمة مختلفة", () => {
  const a = BUG.fingerprint({ name: "TypeError", message: "x is undefined", stack: "TypeError: x\n    at foo (a.js:1:1)" });
  const b = BUG.fingerprint({ name: "TypeError", message: "x is undefined", stack: "TypeError: x\n    at foo (a.js:1:1)" });
  const c = BUG.fingerprint({ name: "TypeError", message: "y is undefined", stack: "TypeError: y\n    at foo (a.js:1:1)" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{12}$/);
});

test("normalizeError: Error / نص / object / قيم غريبة", () => {
  assert.equal(BUG.normalizeError(new TypeError("boom")).name, "TypeError");
  assert.equal(BUG.normalizeError("نص خطأ").message, "نص خطأ");
  assert.match(BUG.normalizeError({ a: 1 }).message, /"a":1/);
  assert.equal(BUG.normalizeError(undefined).name, "Unknown");
});

test("shortMessage: سطر واحد ومحدود الطول", () => {
  assert.equal(BUG.shortMessage("a\nb   c"), "a b c");
  assert.equal(BUG.shortMessage(""), "(بدون رسالة)");
  assert.equal(BUG.shortMessage("x".repeat(200)).length, 80);
});

// ---------------------------------------------------------------------------
// بناء البلاغ
// ---------------------------------------------------------------------------

const ctx = {
  appVersion: "1.0.0",
  platform: "win32",
  arch: "x64",
  osRelease: "10.0.22631",
  electron: "32.0.0",
  chrome: "128.0.0.0",
  node: "20.0.0",
  source: "main:uncaughtException",
  memoryMb: 8192,
  portable: false,
  logTail: "2026-10-28 [ERROR] فشل ساب 999888: timeout\n2026-10-28 [INFO] ok",
};

test("البلاغ: عنوان فيه النوع والبصمة وبحد أقصى ١١٠ حرف", () => {
  const err = new TypeError(`Cannot read properties of undefined ${"x".repeat(300)}`);
  const issue = BUG.buildIssuePayload({ error: err, context: ctx });
  assert.match(issue.title, /^\[auto\] TypeError: /);
  assert.ok(issue.title.includes(`(rp:${issue.fingerprint})`));
  assert.ok(issue.title.length <= 110, `العنوان طويل: ${issue.title.length}`);
  assert.equal(issue.title.includes("\n"), false);
});

test("البلاغ: الوصف فيه النظام والإصدار والوقت والـstack في بلوك كود", () => {
  const err = new Error("فشل الاتصال");
  err.stack = "Error: فشل الاتصال\n    at load (C:\\Users\\ahmed\\app.js:10:5)";
  const issue = BUG.buildIssuePayload({ error: err, context: ctx }, { now: Date.UTC(2026, 9, 28, 19, 41) });
  assert.match(issue.body, /الإصدار/);
  assert.match(issue.body, /1\.0\.0/);
  assert.match(issue.body, /win32 x64/);
  assert.match(issue.body, /2026-10-28T19:41:00\.000Z/);
  assert.match(issue.body, /```text/);
  assert.match(issue.body, /at load/);
  assert.equal(issue.body.includes("ahmed"), false, "مسار المستخدم لازم يتنقّح");
  assert.match(issue.body, new RegExp(`rp-fingerprint: ${issue.fingerprint}`));
  assert.deepEqual(issue.labels, ["auto-bug"]);
});

test("البلاغ: التوكن وكلمة السر ما بيوصلوش للوصف حتى لو جوه رسالة الخطأ", () => {
  const err = new Error(`request failed with ${TOKEN} and password=hunter2`);
  const issue = BUG.buildIssuePayload({ error: err, context: { ...ctx, logTail: `auth ${TOKEN}` } });
  const all = `${issue.title}\n${issue.body}`;
  assert.equal(all.includes(TOKEN), false);
  assert.equal(all.includes("hunter2"), false);
});

test("البلاغ: stack ضخم بيتقصّر برسالة واضحة", () => {
  const err = new Error("boom");
  err.stack = `Error: boom\n${"    at f (a.js:1:1)\n".repeat(2000)}`;
  const issue = BUG.buildIssuePayload({ error: err, context: ctx });
  assert.ok(issue.body.length <= 20000);
  assert.match(issue.body, /اتقصّر/);
});

test("البلاغ: sub-sections اختيارية (بدون لوج = مفيش قسم لوج)", () => {
  const issue = BUG.buildIssuePayload({ error: new Error("x"), context: { appVersion: "1.0.0" } });
  assert.equal(issue.body.includes("آخر سطور السجل"), false);
  assert.match(issue.body, /Stack trace/);
});

// ---------------------------------------------------------------------------
// منع التكرار والسقف اليومي
// ---------------------------------------------------------------------------

test("منع التكرار: نفس الخطأ مرة واحدة في ٢٤ ساعة", () => {
  const now = 1_700_000_000_000;
  const fp = "abc123abc123";
  assert.equal(BUG.shouldReport(BUG.freshState(), fp, now).ok, true);
  const state = BUG.recordReport(BUG.freshState(), fp, now, "https://github.com/x/y/issues/1");
  const dup = BUG.shouldReport(state, fp, now + 60_000);
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, "duplicate");
  // بعد ٢٤ ساعة بقى مسموح تاني (لو المشكلة رجعت)
  assert.equal(BUG.shouldReport(state, fp, now + BUG.DEDUPE_WINDOW_MS + 1).ok, true);
});

test("السقف اليومي: ٥ بلاغات في اليوم وبعدها بيتوقف", () => {
  const now = 1_700_000_000_000;
  let state = BUG.freshState();
  for (let i = 0; i < BUG.MAX_REPORTS_PER_DAY; i += 1) {
    assert.equal(BUG.shouldReport(state, `fp-${i}`, now + i).ok, true);
    state = BUG.recordReport(state, `fp-${i}`, now + i);
  }
  const blocked = BUG.shouldReport(state, "fp-new", now + 10);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "rate-limit");
  assert.equal(BUG.countRecent(state, now + 10), BUG.MAX_REPORTS_PER_DAY);
  // يوم جديد = السقف بيرجع
  assert.equal(BUG.shouldReport(state, "fp-new", now + BUG.DEDUPE_WINDOW_MS + 1).ok, true);
});

test("الحالة: ملف تالف/قديم ما بيكسرش البرنامج", () => {
  const state = BUG.normalizeState({ history: [{ fp: 1 }, null, { fp: "ok", at: "not-a-number" }, { fp: "good", at: 5 }] });
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].fp, "good");
  assert.deepEqual(BUG.normalizeState(null).history, []);
  assert.equal(BUG.shouldReport({ history: "bad" }, "x", 1).ok, true);
});

// ---------------------------------------------------------------------------
// عميل GitHub (fetch مزيّف)
// ---------------------------------------------------------------------------

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const next = responses.shift() || responses[responses.length - 1] || { status: 500, ok: false, json: {} };
    return {
      ok: next.ok ?? (next.status >= 200 && next.status < 300),
      status: next.status,
      json: async () => next.json ?? {},
      text: async () => next.text ?? JSON.stringify(next.json ?? {}),
    };
  };
  impl.calls = calls;
  return impl;
}

test("GitHub: إنشاء الـIssue بينجح وبيرجع الرابط", async () => {
  const fetchImpl = fakeFetch([{ status: 201, json: { number: 42, html_url: "https://github.com/o/r/issues/42" } }]);
  const res = await BUG.postIssue({
    token: TOKEN,
    repo: "o/r",
    issue: { title: "t", body: "b", labels: ["auto-bug"] },
    fetchImpl,
  });
  assert.equal(res.ok, true);
  assert.equal(res.number, 42);
  assert.equal(res.url, "https://github.com/o/r/issues/42");
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, "https://api.github.com/repos/o/r/issues");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.match(init.headers.Accept, /github\+json/);
  const sent = JSON.parse(init.body);
  assert.equal(JSON.stringify(sent).includes(TOKEN), false, "التوكن مايكونش جوه جسم الطلب");
  assert.deepEqual(sent.labels, ["auto-bug"]);
});

test("GitHub: ليبل مش موجود (422) → إعادة المحاولة من غير ليبل", async () => {
  const fetchImpl = fakeFetch([
    { status: 422, json: { message: "Validation Failed" } },
    { status: 201, json: { number: 7, html_url: "https://github.com/o/r/issues/7" } },
  ]);
  const res = await BUG.postIssue({
    token: TOKEN,
    repo: "o/r",
    issue: { title: "t", body: "b", labels: ["auto-bug"] },
    fetchImpl,
  });
  assert.equal(res.ok, true);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(JSON.parse(fetchImpl.calls[1].init.body).labels, undefined);
});

test("GitHub: فشل الإرسال بيرجع سبب مفهوم من غير ما يرمي استثناء", async () => {
  const fetchImpl = fakeFetch([{ status: 500, text: "server error" }]);
  const res = await BUG.postIssue({ token: TOKEN, repo: "o/r", issue: { title: "t", body: "b" }, fetchImpl });
  assert.equal(res.ok, false);
  assert.match(res.error, /500/);
});

test("GitHub: من غير توكن أو بمستودع غلط = رفض قبل أي شبكة", async () => {
  const fetchImpl = fakeFetch([{ status: 201, json: {} }]);
  assert.equal((await BUG.postIssue({ token: "", repo: "o/r", issue: {}, fetchImpl })).error, "missing-token");
  assert.equal((await BUG.postIssue({ token: TOKEN, repo: "bad repo", issue: {}, fetchImpl })).error, "invalid-repo");
  assert.equal(fetchImpl.calls.length, 0);
});

test("GitHub: البحث عن بلاغ مفتوح بنفس البصمة", async () => {
  const open = fakeFetch([
    {
      status: 200,
      json: {
        total_count: 2,
        items: [
          { number: 3, html_url: "https://github.com/o/r/issues/3", state: "closed" },
          { number: 4, html_url: "https://github.com/o/r/issues/4", state: "open" },
        ],
      },
    },
  ]);
  const found = await BUG.findExistingIssue({ token: TOKEN, repo: "o/r", fp: "abcd1234abcd", fetchImpl: open });
  assert.equal(found.number, 4);
  const closedOnly = fakeFetch([{ status: 200, json: { items: [{ number: 3, state: "closed" }] } }]);
  assert.equal(await BUG.findExistingIssue({ token: TOKEN, repo: "o/r", fp: "x", fetchImpl: closedOnly }), null);
});

test("GitHub: البحث بيرجع null بأمان عند فشل الشبكة", async () => {
  const boom = async () => {
    throw new Error("network down");
  };
  assert.equal(await BUG.findExistingIssue({ token: TOKEN, repo: "o/r", fp: "x", fetchImpl: boom }), null);
});
