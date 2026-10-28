/**
 * ١٢٥) تصدير/استيراد الحالة الكاملة.
 *
 * الفكرة: تقدر تنقل شغل يوم كامل — القرارات والصور والسابات — لجهاز تاني
 * (أو تعمل نسخة احتياطية قبل تحديث) في ملف واحد.
 *
 * ملاحظات أمنية:
 * • كلمة سر نايس دير **مش** بتتصدّر أبدًا.
 * • الصور اختيارية لأنها بتكبّر الملف (كل روشتة ١٥٠–٤٠٠ كيلوبايت).
 */
import type { CaseRecord, HourStat, MonthlyCheck, OutreachMessage, PatientRow, Settings } from "./types";

export const BUNDLE_APP = "rosheta-pro";
export const BUNDLE_VERSION = 1;

export interface Bundle {
  app: typeof BUNDLE_APP;
  version: number;
  exportedAt: number;
  settings: Partial<Settings>;
  patients: PatientRow[];
  cases: CaseRecord[];
  monthly: MonthlyCheck[];
  outreach: OutreachMessage[];
  seenForms?: Record<string, string>;
  hourly?: Record<string, HourStat>;
  /** الصور بمفتاح الاستمارة — اختيارية */
  images?: Record<string, string>;
}

export function buildBundle(input: {
  settings: Settings;
  patients: PatientRow[];
  cases: CaseRecord[];
  monthly: MonthlyCheck[];
  outreach: OutreachMessage[];
  seenForms?: Record<string, string>;
  hourly?: Record<string, HourStat>;
  images?: Record<string, string>;
  now?: number;
}): Bundle {
  // كلمة السر والباسورد مش بنصدّرهم — مش محتاجينهم على جهاز تاني
  const { niceDeerPass, ...safeSettings } = input.settings;
  void niceDeerPass;
  return {
    app: BUNDLE_APP,
    version: BUNDLE_VERSION,
    exportedAt: input.now ?? Date.now(),
    settings: safeSettings,
    patients: input.patients,
    cases: input.cases.map((c) => ({ ...c, rx: { ...c.rx, dataUrl: undefined } })),
    monthly: input.monthly,
    outreach: input.outreach,
    seenForms: input.seenForms,
    hourly: input.hourly,
    images: input.images,
  };
}

export function parseBundle(text: string): { ok: boolean; bundle?: Bundle; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "الملف مش JSON صالح — تأكد إنه ملف نسخة روشتة برو" };
  }
  const bundle = data as Partial<Bundle> | null;
  if (!bundle || bundle.app !== BUNDLE_APP) {
    return { ok: false, error: "الملف ده مش نسخة روشتة برو" };
  }
  if (!Array.isArray(bundle.cases)) {
    return { ok: false, error: "الملف ناقص (مفيش استمارات)" };
  }
  if (typeof bundle.version === "number" && bundle.version > BUNDLE_VERSION) {
    return { ok: false, error: "الملف من نسخة أحدث من البرنامج — حدّث البرنامج الأول" };
  }
  return { ok: true, bundle: bundle as Bundle };
}

/** ملخص قبل الاستيراد: إيه اللي هيحصّل بالظبط */
export function bundleSummary(bundle: Bundle) {
  const decided = bundle.cases.filter((c) => c.hasDrugs !== null && c.hasDrugs !== undefined).length;
  const images = bundle.images ? Object.keys(bundle.images).length : 0;
  return {
    cases: bundle.cases.length,
    decided,
    patients: bundle.patients?.length ?? 0,
    monthly: bundle.monthly?.length ?? 0,
    messages: bundle.outreach?.length ?? 0,
    images,
    exportedAt: bundle.exportedAt,
  };
}

/** اسم ملف واضح: روشتة-برو-نسخة-2026-10-28 */
export function bundleFileName(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `روشتة-برو-نسخة-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
