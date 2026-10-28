/**
 * ضبط عدد النوافذ تلقائيًا + سقف حسب إمكانيات الجهاز.
 *
 * المشكلة: رقم ثابت (٨ نوافذ) مش صح لا على جهاز ٤ جيجا ولا على جهاز ٣٢ جيجا.
 * كمان لو السيرفر بطّأ، زيادة النوافذ بتزوّد الاختناق بدل ما تحله.
 */

export const clampWorkers = (n: number) => Math.max(1, Math.min(16, Math.round(n)));

/** سقف واقعي من الرام والأنوية: كل نافذة Chromium بتاكل حوالَي ٣٥٠–٥٠٠ ميجا */
export function hardwareCap({ ramGb, cores }: { ramGb: number; cores: number }) {
  const byRam = Math.floor((ramGb * 1024 - 2048) / 450);
  const byCores = Math.max(2, cores * 2);
  return clampWorkers(Math.min(byRam, byCores, 12));
}

/** البداية: نص السقف — بنكبر بعد ما نشوف الأداء الحقيقي */
export function initialWorkers(choice: string, cap: number) {
  if (choice && choice !== "auto") return clampWorkers(Math.min(Number(choice) || 5, cap));
  return clampWorkers(Math.max(2, Math.min(cap, Math.ceil(cap / 2))));
}

export interface TuneInput {
  workers: number;
  cap: number;
  /** متوسط آخر نافذة قياس (بحث + التقاط) */
  avgMs: number;
  /** متوسط القياس اللي قبله — للمقارنة */
  prevAvgMs: number;
  successes: number;
  failures: number;
}

export interface TuneResult {
  workers: number;
  reason: string;
  changed: boolean;
}

/**
 * قرار واحد كل مرة:
 * • نسبة فشل عالية → قلّل نافذة (السيرفر أو الجهاز مش قادر).
 * • سريع ونسبة الفشل منخفضة → زوّد نافذة واحدة.
 * • بطّأ بعد ما زوّدنا → ارجع خطوة (الزيادة كانت بتضر).
 */
export function tuneWorkers(input: TuneInput): TuneResult {
  const { workers, cap, avgMs, prevAvgMs, successes, failures } = input;
  const attempts = successes + failures;
  if (attempts < 4 || !avgMs) return { workers, reason: "لسه مفيش قياس كفاية", changed: false };

  const failRate = failures / attempts;
  const atCap = workers >= cap;
  const atFloor = workers <= 2;

  if (failRate > 0.15 && !atFloor) {
    return { workers: workers - 1, reason: `نسبة فشل ${Math.round(failRate * 100)}٪ — تقليل نافذة`, changed: true };
  }

  const gotSlower = prevAvgMs > 0 && avgMs > prevAvgMs * 1.25;
  if (gotSlower && !atFloor) {
    return { workers: workers - 1, reason: "المتوسط زاد ٢٥٪ بعد الزيادة — رجوع خطوة", changed: true };
  }

  const gotFaster = prevAvgMs > 0 && avgMs < prevAvgMs * 0.9;
  if (avgMs < 2500 && !atCap && (gotFaster || attempts >= 8)) {
    return { workers: workers + 1, reason: "الخطوة أسرع من ٢.٥ ثانية — زيادة نافذة", changed: true };
  }

  if (avgMs > 7000 && !atFloor) {
    return { workers: workers - 1, reason: "الخطوة أبطأ من ٧ ثواني — تقليل نافذة", changed: true };
  }

  return { workers, reason: "العدد مناسب", changed: false };
}
