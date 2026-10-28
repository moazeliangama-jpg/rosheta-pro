/**
 * اختبارات الثابت الأمني الأهم في الحالة: اللي بيتحفظ في localStorage.
 * كلمة سر نايس دير أو أي صورة base64 بتتحفظ هنا = تسريب/تضخّم مفتاح.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { persistSlice, type AppState } from "./store";

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
