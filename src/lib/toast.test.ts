// اختبارات الإشعارات: الحد الأقصى، الترتيب، الإغلاق اليدوي، ومدة الإجراء
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_TOASTS, clearToasts, dismissToast, getToasts, pushToast, toast } from "./toast";

test("الإشعارات: الأحدث فوق والحد الأقصى محترم", () => {
  clearToasts();
  pushToast("ok", "١", { ttl: 0 });
  pushToast("ok", "٢", { ttl: 0 });
  pushToast("ok", "٣", { ttl: 0 });
  pushToast("ok", "٤", { ttl: 0 });
  const list = getToasts();
  assert.equal(list.length, MAX_TOASTS);
  assert.equal(list[0].text, "٤");
  assert.equal(list[2].text, "٢");
  clearToasts();
  assert.equal(getToasts().length, 0);
});

test("الإشعارات: الإغلاق اليدوي بيشيل واحد بس", () => {
  clearToasts();
  const a = pushToast("info", "أ", { ttl: 0 });
  pushToast("info", "ب", { ttl: 0 });
  dismissToast(a);
  const list = getToasts();
  assert.equal(list.length, 1);
  assert.equal(list[0].text, "ب");
  clearToasts();
});

test("الإشعارات: اللي فيه إجراء بيفضل أطول على الشاشة", () => {
  clearToasts();
  pushToast("ok", "بدون إجراء");
  toast.warn("فيه تراجع", { action: { label: "تراجع", run: () => {} } });
  const plain = getToasts().find((t) => t.text === "بدون إجراء");
  const withAction = getToasts().find((t) => t.text === "فيه تراجع");
  assert.ok(plain && withAction);
  assert.ok(withAction.ttl > plain.ttl, "الإشعار اللي فيه زرار لازم يفضل أطول");
  clearToasts();
});

test("الإشعارات: الإجراء بيتنفّذ مرة واحدة بالضغط", () => {
  clearToasts();
  let runs = 0;
  const id = toast.ok("تراجع؟", { action: { label: "تراجع", run: () => (runs += 1) }, ttl: 0 });
  const item = getToasts().find((t) => t.id === id);
  assert.ok(item?.action);
  item.action.run();
  dismissToast(id);
  assert.equal(runs, 1);
  assert.equal(getToasts().length, 0);
});

test("الإشعارات: حالة React ثابتة المرجع بين التغييرات (مفيش حلقة رسم)", () => {
  // نفس قاعدة useSyncExternalStore: المرجع مايتغيّرش إلا لو المحتوى اتغيّر
  clearToasts();
  const empty1 = getToasts();
  const empty2 = getToasts();
  assert.equal(empty1, empty2);
  pushToast("info", "أ", { ttl: 0 });
  const withOne = getToasts();
  assert.notEqual(withOne, empty1);
  assert.equal(getToasts(), withOne);
  clearToasts();
});
