import type { CaseRecord, FormRow, PatientRow } from "./types";

/**
 * صلاحية 6 أيام/الشهر: الاستمارة الشهرية تُصرف مرة واحدة كل (monthlyCooldownDays) يومًا
 * داخل نفس الشهر الميلادي. أي استمارة شهرية تانية قبل انتهاء المدة = «الشهري غير متاح».
 *
 * ملاحظة مهمة: الدالة دي هي المصدر الوحيد للحكم، ومكتوب لها اختبارات في `npm test`
 * (شوف src/lib/eligibility.test.ts) عشان مفيش حالات حدودية تضيع.
 */
export function evaluateMonthly(
  form: Pick<FormRow, "isMonthly" | "date">,
  history: Array<Pick<FormRow, "isMonthly" | "date">>,
  cooldownDays: number,
): { eligible: boolean; reason: string } {
  if (!form.isMonthly) return { eligible: true, reason: "استمارة أدوية — لا تنطبق قاعدة الشهري" };

  const formDate = parseDate(form.date);
  if (!formDate) return { eligible: true, reason: "تاريخ غير واضح — يحتاج قرار يدوي" };

  const sameMonth = history.filter((h) => {
    if (!h.isMonthly) return false;
    const d = parseDate(h.date);
    if (!d) return false;
    if (d.getTime() >= formDate.getTime()) return false;
    return d.getFullYear() === formDate.getFullYear() && d.getMonth() === formDate.getMonth();
  });

  if (!sameMonth.length) return { eligible: true, reason: "أول استمارة شهرية في الشهر" };

  const last = sameMonth
    .map((h) => parseDate(h.date)!)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const diffDays = Math.floor((formDate.getTime() - last.getTime()) / 86400000);
  if (diffDays < cooldownDays) {
    return {
      eligible: false,
      reason: `آخر استمارة شهرية قبل ${diffDays} يوم (المسموح كل ${cooldownDays} أيام)`,
    };
  }
  return { eligible: true, reason: `مر ${diffDays} يوم على آخر استمارة شهرية` };
}

export function parseDate(raw?: string): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // تواريخ إكسل الرقمية
  if (/^\d{5}$/.test(s)) {
    const base = new Date(Date.UTC(1899, 11, 30));
    base.setUTCDate(base.getUTCDate() + Number(s));
    return base;
  }
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** يبني قائمة الاستمارات الخاصة بكل ساب مرتبة بالتاريخ */
export function groupFormsBySab(patients: PatientRow[], forms: FormRow[]): Map<string, FormRow[]> {
  const map = new Map<string, FormRow[]>();
  for (const p of patients) map.set(p.sab, []);
  for (const f of forms) {
    if (!map.has(f.sab)) map.set(f.sab, []);
    map.get(f.sab)!.push(f);
  }
  for (const [, list] of map) {
    list.sort((a, b) => (parseDate(a.date)?.getTime() ?? 0) - (parseDate(b.date)?.getTime() ?? 0));
  }
  return map;
}

export function isMonthlyType(type: string) {
  return /شهر|month/i.test(type || "");
}

export function progressOf(cases: CaseRecord[]) {
  const total = cases.length;
  const ready = cases.filter((c) => c.rx.status === "ready").length;
  const failed = cases.filter((c) => c.rx.status === "failed").length;
  const loading = cases.filter((c) => c.rx.status === "loading" || c.rx.status === "pending").length;
  const decided = cases.filter((c) => c.drugs !== null || (c.isMonthly && c.monthly !== null)).length;
  const available = cases.filter((c) => c.drugs === "available" || c.monthly === "available").length;
  return { total, ready, failed, loading, decided, available };
}
