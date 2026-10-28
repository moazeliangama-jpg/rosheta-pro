import test from "node:test";
import assert from "node:assert/strict";
import { bottleneck, slowestSabs, speedLine, stepsToCsv, summarize, type StepSample } from "./metrics.ts";

const s = (step: StepSample["step"], ms: number, sab = "100", ok = true): StepSample => ({
  at: 1_700_000_000_000,
  sab,
  step,
  ms,
  ok,
});

test("ملخص الخطوات: العدد والمتوسط و p95", () => {
  const stats = summarize([s("search", 100), s("search", 200), s("search", 300), s("capture", 900)]);
  const search = stats.find((x) => x.step === "search")!;
  assert.equal(search.count, 3);
  assert.equal(search.avg, 200);
  assert.equal(search.max, 300);
  assert.equal(search.p50, 200);
  const capture = stats.find((x) => x.step === "capture")!;
  assert.equal(capture.avg, 900);
});

test("أخطاء الخطوة بتتحسب", () => {
  const stats = summarize([s("capture", 500, "1", false), s("capture", 700, "1", true)]);
  assert.equal(stats.find((x) => x.step === "capture")!.errors, 1);
});

test("الاختناق: بيختار الخطوة اللي واخدة أكبر وقت", () => {
  const b = bottleneck([s("search", 100), s("capture", 900), s("delete", 50)]);
  assert.equal(b.step, "capture");
  assert.equal(b.label, "التقاط الصورة");
  assert.ok(b.share > 80 && b.share <= 100, `النسبة ${b.share}`);
});

test("من غير قياسات: idle مع رسالة واضحة", () => {
  const b = bottleneck([]);
  assert.equal(b.step, "idle");
  assert.match(speedLine([]), /مفيش قياسات/);
});

test("سطر السرعة بيذكر اسم الخطوة والنسبة", () => {
  assert.match(speedLine([s("search", 400), s("capture", 100)]), /البحث/);
});

test("أبطأ السابات: بيجمع لكل ساب ويرتب تنازلي", () => {
  const rows = slowestSabs(
    [
      s("search", 300, "111"),
      s("capture", 900, "111"),
      s("search", 5000, "222"),
      s("capture", 100, "222"),
    ],
    5,
  );
  assert.equal(rows[0].sab, "222");
  assert.equal(rows[0].searchMs, 5000);
  assert.equal(rows[1].sab, "111");
  assert.equal(rows[1].captureMs, 900);
  assert.equal(rows[1].searchMs, 300);
  assert.equal(rows[1].forms, 1);
});

test("CSV: ترميز عربي + أعمدة كاملة + ترتيب زمني", () => {
  const csv = stepsToCsv([
    { ...s("capture", 500, "222"), at: 2 },
    { ...s("search", 120, "111"), at: 1 },
  ]);
  assert.ok(csv.startsWith("\uFEFF"), "لازم BOM عشان إكسل يقرأ العربي");
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0].split(",")[0], "الوقت");
  assert.equal(lines.length, 3);
  assert.match(lines[1], /111/);
  assert.match(lines[2], /222/);
});

test("CSV: الفاصلة جوه النص ما تتكسرش", () => {
  const csv = stepsToCsv([{ ...s("search", 10), note: "سبب, فيه فاصلة" }]);
  assert.match(csv, /"سبب, فيه فاصلة"/);
});
