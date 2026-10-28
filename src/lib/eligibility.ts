import type { FormSource, MonthlyCheck, NdForm, PatientRow } from "./types";

/**
 * القواعد الحقيقية لصلاحية الاستمارات (من طريقة الصرف المعتمدة):
 *
 * 1) استمارات الجدول الثاني (Claims) لازم تكون خلال آخر 6 أيام من تاريخ اليوم.
 * 2) استمارة Pre-Approval مستثناة من قاعدة الـ 6 أيام، لكن لازم تكون في نفس
 *    الشهر الميلادي اللي إحنا فيه.
 * 3) «الشهري» بيتحدد من عمود النوع (Type / Claim Type) في نفس صف الرقم المرجعي.
 * 4) الشهري متاح لساب لو آخر استمارة شهرية له في الشهر الحالي مرّ عليها 6 أيام
 *    أو أكتر، وإلا يبقى غير متاح لحد ما المدة تخلص.
 */

export function parseDateISO(raw?: string): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const monthNames: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
    august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const named = s.match(/^(\d{1,2})[/\-.]([A-Za-z]+)[/\-.](\d{4})/);
  if (named) {
    const m = monthNames[named[2].toLowerCase()];
    if (m) return new Date(Number(named[3]), m - 1, Number(named[1]));
  }
  const num = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (num) {
    let a = Number(num[1]);
    let b = Number(num[2]);
    let day: number;
    let month: number;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }
    return new Date(Number(num[3]), month - 1, day);
  }
  return null;
}

const atMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const daysBetween = (from: Date, to: Date) =>
  Math.round((atMidnight(to).getTime() - atMidnight(from).getTime()) / 86400000);

export interface ValidityResult {
  valid: boolean;
  reason: string;
  days: number | null;
}

/** هل الاستمارة داخل مدة الصلاحية؟ */
export function evaluateValidity(input: {
  source: FormSource;
  dateISO?: string;
  date?: string;
  today?: Date;
  validityDays?: number;
}): ValidityResult {
  const today = atMidnight(input.today ?? new Date());
  const validityDays = input.validityDays ?? 6;
  const parsed = parseDateISO(input.dateISO || input.date);

  if (!parsed) return { valid: false, reason: "تاريخ الاستمارة غير مقروء في الجدول", days: null };

  const days = daysBetween(parsed, today);
  if (days < 0) return { valid: false, reason: `تاريخ الاستمارة في المستقبل (${input.dateISO || input.date})`, days };

  if (input.source === "pre-approval") {
    const sameMonth = parsed.getFullYear() === today.getFullYear() && parsed.getMonth() === today.getMonth();
    return sameMonth
      ? { valid: true, reason: `Pre-Approval داخل الشهر الحالي (${days} يوم)`, days }
      : { valid: false, reason: `Pre-Approval خارج الشهر الحالي (${days} يوم)`, days };
  }

  return days <= validityDays
    ? { valid: true, reason: `خلال ${validityDays} أيام (${days} يوم)`, days }
    : { valid: false, reason: `مرّ ${days} يوم على الاستمارة — الحد ${validityDays} أيام`, days };
}

export const isMonthlyForm = (f: Pick<NdForm, "monthly" | "type" | "claimType">) =>
  Boolean(f.monthly) || /month|شهر/i.test(`${f.type} ${f.claimType}`);

/** هل الشهري متاح لهذا الساب النهارده؟ */
export function evaluateMonthly(input: {
  sab: string;
  patientName: string;
  phone: string;
  workplace: string;
  monthlyForms: Array<{ dateISO: string; date: string; reference: string }>;
  today?: Date;
  validityDays?: number;
}): MonthlyCheck {
  const today = atMidnight(input.today ?? new Date());
  const validityDays = input.validityDays ?? 6;

  const inMonth = input.monthlyForms
    .map((f) => ({ ...f, parsed: parseDateISO(f.dateISO || f.date) }))
    .filter((f): f is typeof f & { parsed: Date } => Boolean(f.parsed))
    .filter((f) => f.parsed.getFullYear() === today.getFullYear() && f.parsed.getMonth() === today.getMonth())
    .sort((a, b) => b.parsed.getTime() - a.parsed.getTime());

  if (!inMonth.length) {
    return {
      sab: input.sab,
      patientName: input.patientName,
      phone: input.phone,
      workplace: input.workplace,
      lastMonthlyDate: "",
      lastMonthlyRef: "",
      daysSince: null,
      computed: "available",
      reason: "مفيش استمارة شهرية في الشهر الحالي — الشهري متاح",
      confirmed: null,
      updatedAt: Date.now(),
    };
  }

  const last = inMonth[0];
  const days = daysBetween(last.parsed, today);
  const available = days >= validityDays;

  return {
    sab: input.sab,
    patientName: input.patientName,
    phone: input.phone,
    workplace: input.workplace,
    lastMonthlyDate: last.dateISO || last.date,
    lastMonthlyRef: last.reference,
    daysSince: days,
    computed: available ? "available" : "unavailable",
    reason: available
      ? `آخر شهري مرجعي ${last.reference} قبل ${days} يوم — المتاح خلص (المسموح كل ${validityDays} أيام)`
      : `آخر شهري مرجعي ${last.reference} قبل ${days} يوم — لازم ${validityDays - days} يوم كمان`,
    confirmed: null,
    updatedAt: Date.now(),
  };
}

/** اسم مكان العمل زي ما بيتعرض — نفس المفتاح اللي بيتجمّع بيه */
export function workplaceName(patient: { workplace?: string }) {
  return (patient.workplace || "بدون مكان عمل").trim() || "بدون مكان عمل";
}

/**
 * السابات اللي هتتراجع فعلًا: لو المستخدم مختار أماكن عمل، مفيش ساب من برّه
 * الاختيار بيدخل التشغيل. مفيش اختيار = كل الأماكن.
 */
export function filterByWorkplaces<T extends { workplace?: string }>(patients: T[], selected: string[] | undefined): T[] {
  const wanted = new Set((selected || []).map((w) => (w || "").trim()).filter(Boolean));
  if (!wanted.size) return patients;
  return patients.filter((p) => wanted.has(workplaceName(p)));
}

/** الاختيار الفعلي: القايمة الجديدة، ولو فاضية بنرجع للمكان الأساسي القديم */
export function selectedWorkplaces(settings: { workplaces?: string[]; workplace?: string }): string[] {
  const list = (settings.workplaces || []).map((w) => w.trim()).filter(Boolean);
  if (list.length) return list;
  const single = (settings.workplace || "").trim();
  return single ? [single] : [];
}

export function groupByWorkplace(patients: PatientRow[]) {
  const map = new Map<string, PatientRow[]>();
  for (const p of patients) {
    const key = workplaceName(p);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return map;
}

export function progressSummary(cases: { rx: { status: string }; valid: boolean; hasDrugs: string | null }[]) {
  const valid = cases.filter((c) => c.valid);
  return {
    total: cases.length,
    valid: valid.length,
    invalid: cases.length - valid.length,
    ready: cases.filter((c) => c.rx.status === "ready").length,
    failed: cases.filter((c) => c.rx.status === "failed").length,
    loading: cases.filter((c) => c.rx.status === "loading" || c.rx.status === "pending").length,
    withDrugs: cases.filter((c) => c.hasDrugs === "available").length,
    withoutDrugs: cases.filter((c) => c.hasDrugs === "unavailable").length,
    decided: cases.filter((c) => c.hasDrugs !== null).length,
  };
}
