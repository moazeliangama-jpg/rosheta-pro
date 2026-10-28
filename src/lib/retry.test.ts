import test from "node:test";
import assert from "node:assert/strict";
import { RetryBudget, backoffDelay, classifyError, errorHint, shouldAbortEarly, shouldRetry } from "./retry.ts";

test("«غير موجود» خطأ دائم — مش بنعيده", () => {
  assert.equal(classifyError("الرقم المرجعي 123 غير موجود في نتائج الساب"), "permanent");
  assert.equal(shouldRetry("الساب غير موجود"), false);
});

test("انتهاء الجلسة بيتعرف ويتعالج بالدخول", () => {
  assert.equal(classifyError("خانة الساب (#SearchCode) غير موجودة — الصفحة لسه بتحمل أو الجلسة انتهت"), "session");
  assert.match(errorHint("الجلسة انتهت"), /هيدخل تلقائي/);
});

test("مشكلة الباير/الدخول = إعداد غلط", () => {
  assert.equal(classifyError("الباير المطلوب غير موجود في القائمة. المتاح: أ / ب"), "config");
  assert.match(errorHint("الباير المطلوب غير موجود"), /راجع الباير/);
});

test("أخطاء الشبكة والتحميل مؤقتة", () => {
  assert.equal(classifyError("نافذة الروشتة اتفتحت لكن مفيش صورة مقروءة فيها"), "transient");
  assert.equal(shouldRetry("ERR_CONNECTION_RESET"), true);
  assert.equal(classifyError(""), "transient");
});

test("backoff أسّي مع عشوائية في الحدود", () => {
  assert.equal(backoffDelay(1, 300, 8000, () => 0.5), 300);
  assert.equal(backoffDelay(2, 300, 8000, () => 0.5), 600);
  assert.equal(backoffDelay(3, 300, 8000, () => 0.5), 1200);
  assert.equal(backoffDelay(9, 300, 8000, () => 0.5), 8000, "السقف");
  const low = backoffDelay(3, 300, 8000, () => 0);
  const high = backoffDelay(3, 300, 8000, () => 0.999);
  assert.ok(low < 1200 && high > 1200, `العشوائية: ${low} / ${high}`);
});

test("ميزانية الإعادات بتوقف بعد الحد", () => {
  const b = new RetryBudget(2);
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
  assert.equal(b.remaining, 0);
});

test("وقف مبكر لو أول ٥ سابات فشلوا", () => {
  assert.equal(shouldAbortEarly(5, 5), true);
  assert.equal(shouldAbortEarly(4, 4), false);
  assert.equal(shouldAbortEarly(5, 200), false, "بعد ما الجلسة مشيت فشل ٥ مش سبب للوقف");
});
