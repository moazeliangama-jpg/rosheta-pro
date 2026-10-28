import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMonthly, parseDate } from "./eligibility.ts";

test("الاستمارة الشهرية الأولى في الشهر مسموحة", () => {
  const r = evaluateMonthly({ isMonthly: true, date: "2026-10-02" }, [], 6);
  assert.equal(r.eligible, true);
});

test("شهري بعد 3 أيام من شهري سابق = غير متاح", () => {
  const history = [{ isMonthly: true, date: "2026-10-02" }];
  const r = evaluateMonthly({ isMonthly: true, date: "2026-10-05" }, history, 6);
  assert.equal(r.eligible, false);
  assert.match(r.reason, /3 يوم/);
});

test("شهري بعد 6 أيام بالظبط = متاح", () => {
  const history = [{ isMonthly: true, date: "2026-10-02" }];
  const r = evaluateMonthly({ isMonthly: true, date: "2026-10-08" }, history, 6);
  assert.equal(r.eligible, true);
});

test("شهر جديد يصفّر القاعدة", () => {
  const history = [{ isMonthly: true, date: "2026-09-28" }];
  const r = evaluateMonthly({ isMonthly: true, date: "2026-10-02" }, history, 6);
  assert.equal(r.eligible, true);
});

test("استمارة أدوية لا تتأثر بقاعدة الشهري", () => {
  const history = [{ isMonthly: true, date: "2026-10-01" }];
  const r = evaluateMonthly({ isMonthly: false, date: "2026-10-02" }, history, 6);
  assert.equal(r.eligible, true);
});

test("تواريخ إكسل الرقمية بتتقرأ صح", () => {
  const d = parseDate("45566");
  assert.ok(d instanceof Date);
  assert.equal(d!.getUTCFullYear(), 2024);
});
