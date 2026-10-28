/**
 * ١٢٢) تجميع أسباب الفشل.
 *
 * قائمة ٣٠٠ فشل مش مفيدة؛ «١٢ مهلة، ٣ ساب غير موجود» هي اللي بتقولك تعمل إيه.
 */
import type { FailedRecord } from "./types";

export interface FailureGroup {
  key: string;
  label: string;
  count: number;
  /** أول ٣ أمثلة (ساب + مرجع) للتوضيح */
  examples: string[];
  step: FailedRecord["step"];
}

/** تصنيف سبب الفشل لنوع مفهوم */
export function failureKind(reason: string): { key: string; label: string } {
  const text = String(reason ?? "");
  if (/غير موجود|مش موجود|لم يرجع استمارات|مفيش استمارات/.test(text)) {
    return { key: "not-found", label: "ساب/استمارة غير موجودة" };
  }
  if (/مهلة|مش بتستجيب|timeout|لم تظهر|خلال المهلة/.test(text)) {
    return { key: "timeout", label: "مهلة / الصفحة مش بتستجيب" };
  }
  if (/صورة|الروشتة|روشتة|نافذة/.test(text)) {
    return { key: "image", label: "صورة الروشتة مش ظاهرة" };
  }
  if (/جلسة|تسجيل الدخول|login/i.test(text)) {
    return { key: "session", label: "انتهاء الجلسة" };
  }
  if (/شبكة|اتصال|ERR_|network/i.test(text)) {
    return { key: "network", label: "مشكلة شبكة" };
  }
  if (/الباير|payer/i.test(text)) {
    return { key: "payer", label: "الباير مش متظبط" };
  }
  if (/إرجاع|Delete/.test(text)) return { key: "delete", label: "الإرجاع فشل" };
  return { key: "other", label: "أسباب أخرى" };
}

export function groupFailures(failed: FailedRecord[]): FailureGroup[] {
  const map = new Map<string, FailureGroup>();
  for (const f of failed) {
    const kind = failureKind(f.reason);
    let group = map.get(kind.key);
    if (!group) {
      group = { key: kind.key, label: kind.label, count: 0, examples: [], step: f.step };
      map.set(kind.key, group);
    }
    group.count += 1;
    if (group.examples.length < 3) {
      group.examples.push(`${f.sab}${f.reference ? ` / ${f.reference}` : ""}`);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** سطر واحد يتحط في الإكسل: «١٢ مهلة · ٣ غير موجود» */
export function failureLine(failed: FailedRecord[]) {
  const groups = groupFailures(failed);
  if (!groups.length) return "";
  return groups.map((g) => `${g.count} ${g.label}`).join(" · ");
}
