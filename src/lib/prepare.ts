/**
 * تجهيز قائمة السابات قبل التشغيل:
 * • تنظيف رقم الساب (مسافات + أرقام عربية)
 * • حذف المكرر
 * • تخطي الساب اللي اتجرد النهاردة (كاش يوم واحد)
 * • تخطي «غير موجود» النهاردة
 * • بدء الأثقل الأول عشان الذيل يقصر
 */
import type { PatientRow } from "./types";
import { normalizeSab } from "./utils";

export interface SabCacheEntry {
  /** اليوم بصيغة yyyy-mm-dd */
  day: string;
  forms: number;
  missing?: boolean;
  /** وقت آخر جرد بالمللي — بيتعرض في الواجهة */
  at?: number;
}

export interface PrepareOptions {
  cache?: Record<string, SabCacheEntry>;
  /** اليوم الحالي yyyy-mm-dd */
  day: string;
  /** تجاهل الكاش وأعد الجرد (جرد جديد يدوي) */
  force?: boolean;
  /** آخر ساب اكتمل — كل اللي قبله بيتخطى (نقطة استكمال) */
  resumeAfter?: string;
}

export interface Prepared {
  list: PatientRow[];
  stats: { total: number; duplicates: number; invalid: number; cached: number; missing: number; resumed: number };
}

/**
 * تنظيف أرقام السابات: مسافات، شرطات، أرقام عربية/فارسية، وحروف مخفية.
 * الساب اللي مش أرقام بيتشال (بيتسبب في بحث فاضي ووقت ضايع).
 */
export function normalizePatients(patients: PatientRow[]): { list: PatientRow[]; invalid: number } {
  let invalid = 0;
  const list: PatientRow[] = [];
  for (const p of patients) {
    const sab = normalizeSab(p.sab);
    if (!/^\d{3,}$/.test(sab)) {
      invalid += 1;
      continue;
    }
    list.push({ ...p, sab, name: String(p.name ?? "").trim(), workplace: String(p.workplace ?? "").trim() });
  }
  return { list, invalid };
}

export function preparePatients(patients: PatientRow[], opts: PrepareOptions): Prepared {
  const cache = opts.cache ?? {};
  const normalized = normalizePatients(patients);
  const seen = new Set<string>();
  const stats: Prepared["stats"] = {
    total: patients.length,
    duplicates: 0,
    invalid: normalized.invalid,
    cached: 0,
    missing: 0,
    resumed: 0,
  };
  const rows: Array<PatientRow & { weight: number }> = [];

  // لو آخر ساب اتحفظ مش موجود في الملف الحالي (ملف اتغير أو ساب اتصلح)،
  // لازم نبدأ من الأول — قبل كده كنا بنتخطى القائمة كلها وبنطلع «مفيش سابات».
  const resume = opts.resumeAfter ? normalizeSab(opts.resumeAfter) : "";
  const resumable = resume && normalized.list.some((p) => p.sab === resume) ? resume : "";
  let skipping = Boolean(resumable);
  for (const p of normalized.list) {
    const sab = p.sab;
    if (seen.has(sab)) {
      stats.duplicates += 1;
      continue;
    }
    seen.add(sab);

    if (skipping) {
      stats.resumed += 1;
      // الساب اللي اكتمل قبل الوقفة بيتخطى هو كمان، وبعده نكمّل عادي
      if (sab === resumable) skipping = false;
      continue;
    }

    const entry = cache[sab];
    const fresh = entry && entry.day === opts.day && !opts.force;
    if (fresh && entry.missing) {
      stats.missing += 1;
      continue;
    }
    if (fresh && entry.forms > 0) {
      stats.cached += 1;
      continue;
    }

    // الوزن من آخر جرد معروف (حتى لو من يوم فات) — الأثقل يبدأ الأول
    rows.push({ ...p, weight: entry ? entry.forms : 1 });
  }

  // الأثقل الأول: بيقصّر الذيل في آخر الجلسة (أطول مهمة تبدأ بدري)
  rows.sort((a, b) => b.weight - a.weight);
  return { list: rows.map(({ weight, ...p }) => p), stats };
}

/** سطر واحد يوضّح للمستخدم إيه اللي اتخطى وليه */
export function prepareNote(stats: Prepared["stats"]) {
  const parts: string[] = [];
  if (stats.duplicates) parts.push(`${stats.duplicates} ساب مكرر اتشال`);
  if (stats.invalid) parts.push(`${stats.invalid} سطر بدون رقم ساب صحيح اتشال`);
  if (stats.cached) parts.push(`${stats.cached} ساب متجرد النهاردة اتخطى`);
  if (stats.missing) parts.push(`${stats.missing} ساب «غير موجود» النهاردة اتخطى`);
  if (stats.resumed) parts.push(`${stats.resumed} ساب مكتمل قبل الوقفة اتخطى`);
  const used = stats.total - stats.duplicates - stats.invalid - stats.cached - stats.missing - stats.resumed;
  return parts.length ? `${parts.join(" · ")} — الشغل على ${used} ساب.` : "";
}
