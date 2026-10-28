import test from "node:test";
import assert from "node:assert/strict";
import { analyzeInventorySpeed, formatDuration } from "./analyzer.ts";
import type { StepSample } from "./metrics.ts";

const sample = (step: StepSample["step"], ms: number, i = 0): StepSample => ({
  at: 1000 + i,
  sab: "1001",
  step,
  ms,
  ok: true,
});

const steps: StepSample[] = [
  sample("search", 2000, 1),
  sample("search", 2000, 2),
  sample("search", 2000, 3),
  sample("click", 300, 4),
  sample("capture", 3000, 5),
  sample("capture", 3000, 6),
  sample("capture", 3000, 7),
  sample("capture", 3000, 8),
  sample("capture", 3000, 9),
  sample("delete", 1000, 10),
  sample("delete", 1000, 11),
];

const base = {
  steps,
  sabs: 10,
  forms: 20,
  workers: 5,
  cap: 10,
  turbo: true,
  deleteInBackground: true,
};

test("مفيش استمارات → مش جاهز بسبب واضح (مفيش تخمين)", () => {
  const res = analyzeInventorySpeed({ ...base, forms: 0 });
  assert.equal(res.ready, false);
  assert.match(String(res.reason), /استمارات/);
  assert.deepEqual(res.plans, []);
  assert.equal(res.best, null);
});

test("قياس أقل من ٣ صور → مش جاهز وبيقول العدد", () => {
  const res = analyzeInventorySpeed({
    ...base,
    steps: [sample("search", 2000), sample("capture", 3000)],
  });
  assert.equal(res.ready, false);
  assert.match(String(res.reason), /اتجمع 1/);
});

test("المحلّل بيختار أسرع طريقة من المتوسطات الحقيقية", () => {
  const res = analyzeInventorySpeed({ ...base, reuseRate: 0.5 });
  assert.equal(res.ready, true);
  // المتوسطات المستخدمة = نفس القياس المسجّل
  assert.deepEqual(
    { s: res.measuredMs.search, c: res.measuredMs.click, cap: res.measuredMs.capture, d: res.measuredMs.delete },
    { s: 2000, c: 300, cap: 3000, d: 1000 },
  );
  assert.equal(res.perFormMs, 3300);
  // الشغل المرعب = ١٠ سابات × ٢ث بحث + ٢٠ استمارة × ٣.٣ث = ٨٦ ثانية
  // على ١٠ نوافذ = ٨.٦ ثانية
  const best = res.best!;
  assert.equal(best.turbo, true);
  assert.equal(best.deleteInBackground, true);
  assert.equal(best.workers, 10);
  assert.equal(best.projectedMs, 8600);
  assert.equal(res.plans[0].key, best.key);
  // كل الخطط مرتبة من الأسرع للأبطأ
  for (let i = 1; i < res.plans.length; i++) {
    assert.ok(res.plans[i - 1].projectedMs <= res.plans[i].projectedMs);
  }
});

test("الإرجاع في المقدمة بيضيف وقته لكل استمارة (الفرق = عدد الاستمارات × وقت الإرجاع)", () => {
  const res = analyzeInventorySpeed({ ...base, reuseRate: 1 });
  const bg = res.plans.find((p) => p.key === "turbo-bg-10")!;
  const fg = res.plans.find((p) => p.key === "turbo-fg-10")!;
  // ٢٠ استمارة × ١ ثانية = ٢٠ ثانية على ١٠ نوافذ = ٢ ثانية
  assert.equal(fg.projectedMs - bg.projectedMs, 2000);
});

test("إعادة استخدام البحث لما تفشل بتخلي الوضع العادي أبطأ", () => {
  const full = analyzeInventorySpeed({ ...base, reuseRate: 1 });
  const half = analyzeInventorySpeed({ ...base, reuseRate: 0.5 });
  const stagedFull = full.plans.find((p) => p.key === "staged-bg-10")!;
  const stagedHalf = half.plans.find((p) => p.key === "staged-bg-10")!;
  assert.equal(stagedFull.projectedMs, 8600);
  // ٢٠ استمارة × ٢ث × ٠.٥ فشل = ٢٠ ثانية ÷ ١٠ نوافذ = ٢ ثانية
  assert.equal(stagedHalf.projectedMs, 10600);
  assert.ok(half.notes.some((n) => n.includes("50٪")));
});

test("المعايرة من جلسة حقيقية بتقلل التوقع وبتبان في الشرح", () => {
  const res = analyzeInventorySpeed({
    ...base,
    reuseRate: 1,
    measured: { forms: 20, elapsedMs: 100000, workers: 5 },
  });
  assert.equal(res.efficiency.calibrated, true);
  assert.ok(res.efficiency.value < 1);
  assert.match(res.efficiency.note, /آخر جلسة حقيقية/);
  // الكفاءة ١٥٪ (حد أدنى محسوب) → التوقع أبطأ من غير معايرة
  const raw = analyzeInventorySpeed({ ...base, reuseRate: 1 });
  assert.ok(res.best!.projectedMs > raw.best!.projectedMs);
  assert.ok(!res.notes.some((n) => n.includes("مش معايرة")));
});

test("الإعداد الحالي المتأخر بيطلّع فرق التوفير", () => {
  const res = analyzeInventorySpeed({
    ...base,
    workers: 2,
    turbo: false,
    deleteInBackground: false,
    reuseRate: 0.5,
  });
  const current = res.plans.find((p) => p.key === `staged-fg-2`)!;
  assert.ok(current);
  assert.ok(res.savingMs > 0);
  assert.notEqual(res.best!.key, current.key);
});

test("صياغة المدة بالعربي", () => {
  assert.equal(formatDuration(45_000), "1 دقيقة");
  assert.equal(formatDuration(25 * 60_000), "25 دقيقة");
  assert.equal(formatDuration(72 * 60_000), "1 ساعة و12 دقيقة");
  assert.equal(formatDuration(120 * 60_000), "2 ساعة");
});
