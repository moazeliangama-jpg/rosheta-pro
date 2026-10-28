/**
 * اختبارات الثابت الأمني الأهم في الحالة: اللي بيتحفظ في localStorage.
 * كلمة سر نايس دير أو أي صورة base64 بتتحفظ هنا = تسريب/تضخّم مفتاح.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getSaveState, markSaveState, persistSlice, subscribeSave, type AppState } from "./store";

const base = {
  settings: {
    workplace: "صيدلية أ",
    payerId: "12",
    payerName: "باير",
    niceDeerUser: "moaz",
    niceDeerPass: "SuperSecret#1",
    sessionTime: "08:30",
    reportTime: "20:00",
    errorReporting: true,
  },
  patients: [{ sab: "123456", name: "أحمد", phone: "01000000000", workplace: "صيدلية أ" }],
  cases: {
    a: {
      id: "a",
      sab: "123456",
      hasDrugs: "available",
      rx: { status: "ready", dataUrl: "data:image/png;base64,AAAA", method: "screenshot" },
    },
  },
  caseOrder: ["a"],
  monthly: {},
  failed: [],
  // السجل في المتجر مرتب من الأحدث للأقدم (logLine بيعمل prepend)
  log: Array.from({ length: 900 }, (_, i) => ({ at: i, level: "info", msg: `line ${899 - i}` })),
  session: { state: "idle", lastSab: "123456" },
  samples: Array.from({ length: 400 }, (_, i) => ({ at: i })),
  steps: Array.from({ length: 3000 }, (_, i) => ({ at: i })),
  sabCache: {},
  seenForms: {},
  hourly: {},
  history: Array.from({ length: 90 }, (_, i) => ({ id: `h${i}` })),
  profiles: {},
  outreach: [],
  screen: "decision",
  lastDecisionId: "a",
} as unknown as AppState;

test("الحفظ: كلمة سر نايس دير ما بتتحفظش أبدًا", () => {
  const slice = persistSlice(base);
  assert.equal(slice.settings.niceDeerPass, "");
  const json = JSON.stringify(slice);
  assert.equal(json.includes("SuperSecret#1"), false, "كلمة السر اتسربت للحفظ المحلي");
  // اسم المستخدم بيتحفظ عادي (مش سر) عشان المستخدم مايعيدش كتابته
  assert.equal(slice.settings.niceDeerUser, "moaz");
});

test("الحفظ: صور الروشتات (base64) بتتشال من الحالة المحفوظة", () => {
  const slice = persistSlice(base);
  assert.equal(slice.cases.a.rx.dataUrl, undefined);
  assert.equal(JSON.stringify(slice).includes("data:image/png"), false);
  // باقي حالة الصورة بتفضل (الحالة نفسها مهمة للعرض)
  assert.equal(slice.cases.a.rx.status, "ready");
  assert.equal(slice.cases.a.hasDrugs, "available");
});

test("الحفظ: السجلات والقياسات بتتقصّر بحدود ثابتة", () => {
  const slice = persistSlice(base);
  assert.equal(slice.log.length, 250);
  assert.equal(slice.samples.length, 150);
  assert.equal(slice.steps.length, 1200);
  assert.equal(slice.history.length, 30);
  // الأحدث هو اللي بيفضل (السجل مرتب من الأحدث للأقدم)
  assert.equal(slice.log[0]?.msg, "line 899");
});

test("الحفظ: الحالة الأصلية مش بتتعدّل (دالة نقية)", () => {
  const before = JSON.stringify(base.cases.a.rx.dataUrl);
  persistSlice(base);
  assert.equal(JSON.stringify(base.cases.a.rx.dataUrl), before);
  assert.equal(base.settings.niceDeerPass, "SuperSecret#1");
});

// ---------------------------------------------------------------------------
// مؤشر الحفظ — الثابت اللي كان بيعمل React error #185 (Maximum update depth)
// ---------------------------------------------------------------------------

test("مؤشر الحفظ: نفس المرجع بين النداءات (مفيش إعادة رسم لا نهائية)", () => {
  // useSyncExternalStore بيقارن بـ Object.is — أي كائن جديد كل نداء = حلقة لا نهائية
  const a = getSaveState();
  const b = getSaveState();
  const c = getSaveState();
  assert.equal(a, b);
  assert.equal(b, c);
});

test("مؤشر الحفظ: المرجع بيتغيّر بس لما القيمة تتغيّر فعلًا", () => {
  const before = getSaveState();
  markSaveState(before.dirty, before.savedAt); // نفس القيم → مفيش تغيير
  assert.equal(getSaveState(), before);

  markSaveState(true);
  const dirty = getSaveState();
  assert.notEqual(dirty, before);
  assert.equal(dirty.dirty, true);

  markSaveState(false, 1_700_000_000_000);
  const saved = getSaveState();
  assert.equal(saved.dirty, false);
  assert.equal(saved.savedAt, 1_700_000_000_000);
});

test("مؤشر الحفظ: المشتركين بيتنادى عليهم عند التغيير بس", () => {
  let calls = 0;
  const off = subscribeSave(() => (calls += 1));
  try {
    const now = getSaveState();
    markSaveState(now.dirty, now.savedAt); // مفيش تغيير
    assert.equal(calls, 0);
    markSaveState(!now.dirty, now.savedAt + 5);
    assert.equal(calls, 1);
  } finally {
    off();
  }
  const after = getSaveState();
  markSaveState(!after.dirty, after.savedAt + 5);
  assert.equal(calls, 1, "بعد إلغاء الاشتراك مايتناداش");
});
