/**
 * تصنيف الأخطاء وإعادة المحاولة.
 *
 * المشكلة الحقيقية: البرنامج كان بيعيد كل خطأ ٣ مرات — حتى «الساب غير موجود»
 * اللي مستحيل يتحسن بالإعادة، فبيضيّع وقت وبيلخبط السيرفر.
 * هنا بنفصل الخطأ المؤقت عن الدائم، وبنعمل backoff أسّي مع عشوائية
 * عشان لو نايس دير بطّأ ما نضربوش بموجة طلبات متزامنة.
 */

export type ErrorKind = "permanent" | "session" | "config" | "transient";

const PERMANENT = [
  /غير موجود/,
  /مش موجود/,
  /مفيش استمارات/,
  /لم يرجع استمارات/,
  /مرفوض/,
  /invalid/i,
  /not\s*found/i,
  /404/,
];

const SESSION = [
  /جلسة/,
  /انتهت/,
  /تسجيل الدخول/,
  /تسجيل دخول/,
  /login/i,
  /sign\s*in/i,
  /#SearchCode/,
  /unauthori[sz]ed/i,
  /401/,
];

const CONFIG = [
  /الباير/,
  /payer/i,
  /اسم المستخدم|كلمة السر|بيانات (ال)?دخول|باسورد|باسوورد|اليوزر|يرجى تسجيل الدخول/,
  /credentials/i,
];

export function classifyError(message: string): ErrorKind {
  const text = String(message ?? "");
  if (!text) return "transient";
  // الإعداد الناقص بيتفحص قبل «الجلسة»: رسالة «تسجيل الدخول لم يكتمل — راجع الباسورد»
  // كانت بتتصنّف «جلسة» فالبرنامج يعيد الدخول بدل ما يقول للمستخدم إن البيانات غلط.
  if (CONFIG.some((r) => r.test(text))) return "config";
  if (SESSION.some((r) => r.test(text))) return "session";
  if (PERMANENT.some((r) => r.test(text))) return "permanent";
  return "transient";
}

/** يستاهل نعيد المحاولة؟ */
export const shouldRetry = (message: string) => classifyError(message) === "transient";

/**
 * فاصل إعادة المحاولة: أسّي + عشوائية (±٢٥٪).
 * attempt يبدأ من ١ (٣٠٠، ٦٠٠، ١٢٠٠…)
 */
export function backoffDelay(attempt: number, base = 300, cap = 8000, random: () => number = Math.random) {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const raw = Math.min(cap, base * 2 ** (safeAttempt - 1));
  const jitter = 0.75 + random() * 0.5;
  return Math.max(50, Math.round(raw * jitter));
}

/** رسالة عربية فيها الحل في سطر واحد — بدل نص الخطأ الخام */
export function errorHint(message: string): string {
  const kind = classifyError(message);
  const raw = String(message ?? "").trim();
  if (kind === "session") return `انتهت جلسة نايس دير — البرنامج هيدخل تلقائيًا. (${raw})`;
  if (kind === "config") return `إعداد ناقص أو غلط: ${raw} — راجع الباير وبيانات الدخول في الإعداد.`;
  if (kind === "permanent") return `${raw} — مش محتاج إعادة محاولة، اتخطّى.`;
  return `${raw} — هيتم إعادة المحاولة تلقائيًا.`;
}

/** ميزانية إعادات لكل الجلسة — عشان ما نضربش السيرفر بمئات المحاولات */
export class RetryBudget {
  private used = 0;
  constructor(private readonly max: number) {}

  get remaining() {
    return Math.max(0, this.max - this.used);
  }

  take(): boolean {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }
}

/**
 * حارس «أول ٥ سابات فشلوا كلهم» — لو الإعداد غلط بنوقف بدل ٥٠٠ فشل.
 * بيرجع true لما لازم نوقف.
 */
export function shouldAbortEarly(consecutiveFailures: number, done: number, threshold = 5) {
  return consecutiveFailures >= threshold && done <= Math.max(threshold, 8);
}
