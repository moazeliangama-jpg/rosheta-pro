import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMonthly, evaluateValidity, parseDateISO } from "./eligibility.ts";

const TODAY = new Date(2026, 9, 28); // 28 أكتوبر 2026

test("استمارة Claim خلال 6 أيام = داخل المدة", () => {
  const r = evaluateValidity({ source: "claim", dateISO: "2026-10-24", today: TODAY, validityDays: 6 });
  assert.equal(r.valid, true);
});

test("استمارة Claim بعد 7 أيام = خارج المدة", () => {
  const r = evaluateValidity({ source: "claim", dateISO: "2026-10-21", today: TODAY, validityDays: 6 });
  assert.equal(r.valid, false);
  assert.match(r.reason, /7 يوم/);
});

test("Pre-Approval داخل نفس الشهر = مقبولة حتى لو أقدم من 6 أيام", () => {
  const r = evaluateValidity({ source: "pre-approval", dateISO: "2026-10-02", today: TODAY });
  assert.equal(r.valid, true);
});

test("Pre-Approval في شهر سابق = مرفوضة", () => {
  const r = evaluateValidity({ source: "pre-approval", dateISO: "2026-09-29", today: TODAY });
  assert.equal(r.valid, false);
  assert.match(r.reason, /خارج الشهر/);
});

test("تاريخ في المستقبل مرفوض", () => {
  const r = evaluateValidity({ source: "claim", dateISO: "2026-11-01", today: TODAY });
  assert.equal(r.valid, false);
});

test("بدون تاريخ الاستمارة مرفوضة برسالة واضحة", () => {
  const r = evaluateValidity({ source: "claim", dateISO: "", today: TODAY });
  assert.equal(r.valid, false);
  assert.match(r.reason, /غير مقروء/);
});

test("قراءة التواريخ الحقيقية من نايس دير", () => {
  assert.equal(parseDateISO("21/Oct/2026")!.getMonth(), 9);
  assert.equal(parseDateISO("21/Oct/2026")!.getDate(), 21);
  assert.equal(parseDateISO("31/05/2026")!.getMonth(), 4);
  assert.equal(parseDateISO("10/21/2026")!.getMonth(), 9);
});

test("شهري: مفيش استمارة شهرية في الشهر = متاح", () => {
  const m = evaluateMonthly({
    sab: "1001",
    patientName: "أحمد",
    phone: "0100",
    workplace: "جهة",
    monthlyForms: [{ dateISO: "2026-09-20", date: "20/Sep/2026", reference: "1" }],
    today: TODAY,
  });
  assert.equal(m.computed, "available");
});

test("شهري: آخر استمارة شهرية قبل يومين = غير متاح", () => {
  const m = evaluateMonthly({
    sab: "1002",
    patientName: "منى",
    phone: "0101",
    workplace: "جهة",
    monthlyForms: [{ dateISO: "2026-10-26", date: "26/Oct/2026", reference: "555" }],
    today: TODAY,
  });
  assert.equal(m.computed, "unavailable");
  assert.equal(m.daysSince, 2);
  assert.equal(m.lastMonthlyRef, "555");
});

test("شهري: آخر استمارة شهرية قبل 6 أيام = متاح", () => {
  const m = evaluateMonthly({
    sab: "1003",
    patientName: "سيد",
    phone: "0102",
    workplace: "جهة",
    monthlyForms: [{ dateISO: "2026-10-22", date: "22/Oct/2026", reference: "777" }],
    today: TODAY,
  });
  assert.equal(m.computed, "available");
});
