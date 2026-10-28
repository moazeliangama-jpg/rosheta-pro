import test from "node:test";
import assert from "node:assert/strict";
import { buildTasks } from "./tasks.ts";
import type { CaseRecord } from "./types.ts";

const make = (sab: string, reference: string): CaseRecord => ({
  id: `${sab}::claim::${reference}`,
  sab,
  patientName: "",
  phone: "",
  workplace: "",
  payerId: "1",
  payerName: "",
  source: "claim",
  reference,
  type: "",
  claimType: "",
  code: "",
  href: "",
  formDate: "",
  formDateISO: "2026-10-20",
  monthly: false,
  valid: true,
  validityReason: "",
  deleted: false,
  deleteState: "skipped",
  rx: { status: "pending", attempts: 0, updatedAt: 0 },
  hasDrugs: null,
  createdAt: 0,
  updatedAt: 0,
});

test("كل استمارات الساب في مهمة واحدة لما السابات أكتر من النوافذ", () => {
  const cases = [make("1", "a"), make("1", "b"), make("2", "c"), make("3", "d")];
  const tasks = buildTasks(cases, 2);
  assert.equal(tasks.length, 3);
  assert.equal(tasks.reduce((n, t) => n + t.items.length, 0), 4);
  const sab1 = tasks.find((t) => t.sab === "1")!;
  assert.equal(sab1.items.length, 2);
});

test("سابات قليلة => تقسيم استمارات الساب على أكتر من نافذة", () => {
  const cases = Array.from({ length: 6 }, (_, i) => make("100", `r${i}`));
  const tasks = buildTasks(cases, 3);
  assert.ok(tasks.length >= 2, "لازم يتقسم على أكتر من مهمة");
  assert.equal(tasks.reduce((n, t) => n + t.items.length, 0), 6);
  // كل مهمة لازم تكون بنفس الساب عشان نستفيد من نتائج البحث المحفوظة
  assert.ok(tasks.every((t) => t.sab === "100"));
});

test("مفيش استمارة تتكرر أو تضيع في التقسيم", () => {
  const cases = [
    ...Array.from({ length: 5 }, (_, i) => make("10", `a${i}`)),
    ...Array.from({ length: 3 }, (_, i) => make("20", `b${i}`)),
    make("30", "c0"),
  ];
  for (const workers of [2, 3, 5, 8, 16]) {
    const tasks = buildTasks(cases, workers);
    const refs = tasks.flatMap((t) => t.items.map((c) => `${c.sab}:${c.reference}`));
    assert.equal(refs.length, cases.length, `عدد مختلف مع ${workers} نوافذ`);
    assert.equal(new Set(refs).size, cases.length, `تكرار مع ${workers} نوافذ`);
  }
});

test("النوافذ مش أكتر من عدد الاستمارات", () => {
  const cases = [make("1", "a"), make("2", "b")];
  const tasks = buildTasks(cases, 16);
  assert.equal(tasks.length, 2);
});
