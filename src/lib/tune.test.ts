import test from "node:test";
import assert from "node:assert/strict";
import { hardwareCap, initialWorkers, tuneWorkers } from "./tune.ts";

test("سقف النوافذ بيقل على الأجهزة الضعيفة", () => {
  assert.ok(hardwareCap({ ramGb: 4, cores: 4 }) <= 4, "٤ جيجا مش هتشيل ١٢ نافذة");
  assert.ok(hardwareCap({ ramGb: 32, cores: 8 }) >= 8);
  assert.ok(hardwareCap({ ramGb: 128, cores: 32 }) <= 12, "حتى الأجهزة القوية ليها سقف");
});

test("البداية نص السقف في الوضع التلقائي", () => {
  assert.equal(initialWorkers("auto", 8), 4);
  assert.equal(initialWorkers("auto", 3), 2);
});

test("اختيار المستخدم محترم بس في حدود إمكانيات الجهاز", () => {
  assert.equal(initialWorkers("12", 6), 6);
  assert.equal(initialWorkers("5", 10), 5);
});

test("نسبة فشل عالية => تقليل نافذة", () => {
  const r = tuneWorkers({ workers: 6, cap: 8, avgMs: 2000, prevAvgMs: 2000, successes: 6, failures: 4 });
  assert.equal(r.workers, 5);
  assert.equal(r.changed, true);
  assert.match(r.reason, /فشل/);
});

test("سريع ومستقر => زيادة نافذة", () => {
  const r = tuneWorkers({ workers: 3, cap: 8, avgMs: 900, prevAvgMs: 1400, successes: 9, failures: 0 });
  assert.equal(r.workers, 4);
});

test("بطّأ بعد الزيادة => رجوع خطوة", () => {
  const r = tuneWorkers({ workers: 6, cap: 8, avgMs: 3500, prevAvgMs: 2000, successes: 8, failures: 0 });
  assert.equal(r.workers, 5);
});

test("مش بنعدّي السقف ولا بننزل تحت ٢", () => {
  const up = tuneWorkers({ workers: 8, cap: 8, avgMs: 800, prevAvgMs: 1200, successes: 20, failures: 0 });
  assert.equal(up.workers, 8);
  assert.equal(up.changed, false);

  const down = tuneWorkers({ workers: 2, cap: 8, avgMs: 12000, prevAvgMs: 12000, successes: 1, failures: 9 });
  assert.equal(down.workers, 2);
});

test("لسه مفيش قياس => مفيش تغيير", () => {
  const r = tuneWorkers({ workers: 5, cap: 8, avgMs: 0, prevAvgMs: 0, successes: 1, failures: 0 });
  assert.equal(r.changed, false);
  assert.match(r.reason, /مفيش قياس/);
});
