// اختبارات منطق القرار الجماعي والتراجع (١٠٥/١٠٦)
import test from "node:test";
import assert from "node:assert/strict";
import { applyDecision, applySabDecision, groupCasesBySab, undoDecision } from "./decisions";
import type { CaseRecord } from "./types";

function rec(id: string, sab: string, hasDrugs: CaseRecord["hasDrugs"] = null, valid = true): CaseRecord {
  return {
    id,
    sab,
    patientName: `اسم ${sab}`,
    phone: "01000000000",
    workplace: "جهة",
    payerId: "1",
    payerName: "الجهة",
    source: "claim",
    reference: `R${id}`,
    type: "E_Prescription",
    claimType: "E_Prescription",
    code: `C${id}`,
    href: "/x",
    formDate: "2026-10-01",
    formDateISO: "2026-10-01",
    monthly: false,
    valid,
    validityReason: valid ? "داخل المدة" : "قديمة",
    deleted: false,
    deleteState: "",
    rx: { status: "pending", attempts: 0, updatedAt: 1 },
    hasDrugs,
    createdAt: 1,
    updatedAt: 1,
  };
}

const asMap = (list: CaseRecord[]) => Object.fromEntries(list.map((c) => [c.id, c]));

test("تجميع الاستمارات حسب الساب بيتجاهل غير الصالح", () => {
  const cases = asMap([rec("1", "111"), rec("2", "111", "available"), rec("3", "222", null, false)]);
  const groups = groupCasesBySab(cases);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].total, 2);
  assert.equal(groups[0].withDrugs, 1);
  assert.equal(groups[0].decided, 1);
});

test("الأقل حسمًا بيطلع الأول", () => {
  const cases = asMap([rec("1", "111", "available"), rec("2", "222"), rec("3", "222")]);
  const groups = groupCasesBySab(cases);
  assert.equal(groups[0].sab, "222");
});

test("القرار الجماعي بياخد كل استمارات الساب ويسجّل التراجع", () => {
  const cases = asMap([rec("1", "111"), rec("2", "111", "unavailable"), rec("3", "222")]);
  const res = applySabDecision(cases, "111", "available", 100);
  assert.equal(res.entries.length, 2);
  assert.equal(res.cases["1"].hasDrugs, "available");
  assert.equal(res.cases["2"].hasDrugs, "available");
  assert.equal(res.cases["3"].hasDrugs, null);
  assert.ok(res.entries.every((e) => e.prev !== "available"));
});

test("قرار على استمارة واحدة مش بيلمس غيرها", () => {
  const cases = asMap([rec("1", "111"), rec("2", "111")]);
  const res = applyDecision(cases, "1", "unavailable");
  assert.equal(res.cases["1"].hasDrugs, "unavailable");
  assert.equal(res.cases["2"].hasDrugs, null);
  assert.equal(res.entry?.prev, null);
});

test("نفس القرار مرتين مبيتسجلش في التاريخ", () => {
  const cases = asMap([rec("1", "111", "available")]);
  const res = applyDecision(cases, "1", "available");
  assert.equal(res.entry, null);
  assert.equal(res.cases, cases);
});

test("التراجع بيرجّع القرار القديم", () => {
  const cases = asMap([rec("1", "111")]);
  const res = applyDecision(cases, "1", "available", 50);
  const back = undoDecision(res.cases, res.entry!, 60);
  assert.equal(back["1"].hasDrugs, null);
  assert.equal(back["1"].updatedAt, 60);
});
