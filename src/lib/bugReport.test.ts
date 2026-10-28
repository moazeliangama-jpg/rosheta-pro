// اختبارات الالتقاط في الواجهة (الجزء النقي — التنقيح والإرسال بيختبروا في scripts/bugreport.test.mjs)
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeThrown, reportError, reportKey, resetReportingState } from "./bugReport";

test("normalizeThrown: Error ونص وقيم غريبة", () => {
  const err = normalizeThrown(new RangeError("قيمة غلط"));
  assert.equal(err.name, "RangeError");
  assert.equal(err.message, "قيمة غلط");
  assert.equal(normalizeThrown("نص").message, "نص");
  assert.match(normalizeThrown({ code: 42 }).message, /42/);
  // كائن بيرمي عند التحويل لـ JSON
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(typeof normalizeThrown(circular).message, "string");
});

test("reportKey: نفس المكان والخطأ = نفس المفتاح", () => {
  assert.equal(reportKey("Error", "boom", "click"), reportKey("Error", "boom", "click"));
  assert.notEqual(reportKey("Error", "boom", "click"), reportKey("Error", "boom", "session"));
});

test("reportError: من غير جسر سطح المكتب بيرجع null بدل ما يرمي", async () => {
  resetReportingState();
  const res = await reportError({ error: new Error("x"), source: "test" });
  assert.equal(res, null);
});
