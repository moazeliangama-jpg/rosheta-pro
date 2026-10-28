// اختبارات بلاغ الحفظ: «تم» ما تتقالش غير لما الملف يتكتب فعلًا
import test from "node:test";
import assert from "node:assert/strict";
import { clearToasts, getToasts } from "./toast";
import { reportSave } from "./saveFeedback";

test("الحفظ: نجاح حقيقي بيقول اسم الملف وفيه إجراء يفتح المجلد", () => {
  clearToasts();
  const opened = { count: 0 };
  const ok = reportSave(
    { ok: true, file: "C:\\Users\\x\\Downloads\\Roshetta Pro\\a.xlsx", name: "a.xlsx", bytes: 2048, count: 12 },
    "تصدير الموافقين",
    () => {
      opened.count += 1;
    },
  );
  assert.equal(ok, true);
  const [toast] = getToasts();
  assert.equal(toast.tone, "ok");
  assert.match(toast.text, /a\.xlsx/);
  assert.match(toast.text, /12 صف/);
  assert.equal(typeof toast.action?.run, "function");
  toast.action!.run();
  assert.equal(opened.count, 1);
});

test("الحفظ: فشل الكتابة بيطلع خطأ بسبب واضح مش نجاح", () => {
  clearToasts();
  const ok = reportSave({ ok: false, error: "القرص ممتلئ" }, "تصدير الموافقين");
  assert.equal(ok, false);
  const [toast] = getToasts();
  assert.equal(toast.tone, "error");
  assert.match(toast.text, /القرص ممتلئ/);
  assert.equal(toast.action, undefined);
});

test("الحفظ: تنزيل المتصفح بيوصف كـ«غير مؤكد» مش كحفظ على القرص", () => {
  clearToasts();
  reportSave({ ok: true, name: "b.csv", unverified: true }, "تصدير التوقيت");
  const [toast] = getToasts();
  assert.equal(toast.tone, "warn");
  assert.match(toast.text, /مش اتأكدنا/);
});

test("الحفظ: فشل بدون سبب مكتوب لسه بيقول السبب الافتراضي", () => {
  clearToasts();
  reportSave({ ok: false }, "تصدير");
  assert.match(getToasts()[0].text, /سبب غير معروف/);
});
