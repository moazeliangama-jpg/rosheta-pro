/**
 * سرعة السيرفر حسب الساعة.
 *
 * الملاحظة العملية: نايس دير بيبقى أسرع في ساعات معيّنة (بداية اليوم) وأبطأ في ساعات
 * الضغط. بدل ما نفترض، بنقيس: كل خطوة بتتسجل على الساعة اللي حصلت فيها، وبعد
 * أسبوع البيانات بتقولنا أفضل ساعة وأسوأ ساعة — والقرار بيتاخد منها.
 *
 * الحساب كله محلي ومحفوظ مع حالة البرنامج.
 */
import type { HourStat } from "./types";

export type HourlyStats = Record<string, HourStat>;

export interface HourAverage {
  hour: number;
  avg: number;
  count: number;
}

/** تسجيل قياس في ساعته (immutable — بنرجّع كائن جديد) */
export function recordHourly(stats: HourlyStats, hour: number, ms: number): HourlyStats {
  const key = String(((Math.round(hour) % 24) + 24) % 24);
  const prev = stats[key] ?? { count: 0, totalMs: 0 };
  if (!Number.isFinite(ms) || ms < 0) return stats;
  return { ...stats, [key]: { count: prev.count + 1, totalMs: prev.totalMs + Math.round(ms) } };
}

export function hourlyAverages(stats: HourlyStats): HourAverage[] {
  return Object.entries(stats)
    .map(([hour, s]) => ({
      hour: Number(hour),
      avg: s.count ? Math.round(s.totalMs / s.count) : 0,
      count: s.count,
    }))
    .filter((x) => x.count > 0 && x.avg > 0)
    .sort((a, b) => a.hour - b.hour);
}

/** أفضل ساعة = أقل متوسط حقيقي على عدد قياسات كفاية */
export function bestHour(stats: HourlyStats, minSamples = 20): HourAverage | null {
  const rows = hourlyAverages(stats).filter((r) => r.count >= minSamples);
  if (!rows.length) return null;
  return rows.reduce((a, b) => (b.avg < a.avg ? b : a));
}

/**
 * ١١٣) تعديل عدد النوافذ حسب الساعة: لو الساعة الحالية أبطأ بـ٤٠٪ من متوسطها
 * المعتاد (أو أبطأ من أفضل ساعة بضعف)، بنقلّل نافذة — الضغط على السيرفر بيزوّد الاختناق.
 */
export function hourAdjustment(
  stats: HourlyStats,
  hour: number,
  currentAvg: number,
  minSamples = 10,
): { factor: number; reason: string } {
  if (!currentAvg) return { factor: 0, reason: "" };
  const rows = hourlyAverages(stats);
  const same = rows.find((r) => r.hour === ((hour % 24) + 24) % 24);
  const best = bestHour(stats, minSamples);

  if (same && same.count >= minSamples && currentAvg > same.avg * 1.4) {
    return { factor: -1, reason: `الساعة ${hour}:٠٠ أبطأ ٤٠٪ من المعتاد — تقليل نافذة` };
  }
  if (best && currentAvg > best.avg * 2 && best.hour !== hour) {
    return { factor: -1, reason: `أسرع ساعة ${best.hour}:٠٠ بمتوسط ${best.avg} مللي — تقليل نافذة` };
  }
  return { factor: 0, reason: "" };
}

/** ملخص قصير للواجهة: أفضل وأسوأ ساعة */
export function hourlySummary(stats: HourlyStats) {
  const rows = hourlyAverages(stats);
  if (!rows.length) return { best: null, worst: null, hours: 0 };
  const best = rows.reduce((a, b) => (b.avg < a.avg ? b : a));
  const worst = rows.reduce((a, b) => (b.avg > a.avg ? b : a));
  return { best, worst, hours: rows.length };
}
