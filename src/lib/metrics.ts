/**
 * قياس كل خطوة — أساس أي قرار سرعة.
 *
 * من غير القياس ده بنبقى بنخمّن: «الشغل بطيء» مش معلومة،
 * لكن «٧٢٪ من الوقت في التقاط الصور» دي معلومة ينفع نبني عليها.
 *
 * كل القياسات محلية (مفيش سحابة، مفيش endpoints) وبتتحفظ مع الحالة.
 */

export type StepName = "search" | "click" | "capture" | "delete" | "scan";

export interface StepSample {
  at: number;
  sab: string;
  step: StepName;
  ms: number;
  ok: boolean;
  /** تفاصيل إضافية اختيارية (طريقة الالتقاط، سبب الفشل…) */
  note?: string;
}

export const STEP_LABEL: Record<StepName, string> = {
  search: "البحث",
  click: "فتح الروشتة",
  capture: "التقاط الصورة",
  delete: "الإرجاع",
  scan: "الجرد",
};

export const STEP_ORDER: StepName[] = ["search", "click", "capture", "delete"];

export interface StepStats {
  step: StepName;
  count: number;
  totalMs: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
  errors: number;
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarize(samples: StepSample[], step?: StepName): StepStats[] {
  const steps = step ? [step] : STEP_ORDER;
  return steps.map((name) => {
    const list = samples.filter((s) => s.step === name);
    const values = list.map((s) => s.ms).sort((a, b) => a - b);
    const total = values.reduce((n, v) => n + v, 0);
    return {
      step: name,
      count: values.length,
      totalMs: total,
      avg: values.length ? Math.round(total / values.length) : 0,
      p50: Math.round(percentile(values, 50)),
      p95: Math.round(percentile(values, 95)),
      max: values.length ? Math.round(values[values.length - 1]) : 0,
      errors: list.filter((s) => !s.ok).length,
    };
  });
}

export interface Bottleneck {
  step: StepName | "idle";
  label: string;
  /** نسبة الوقت من إجمالي الخطوات */
  share: number;
  avg: number;
  totalMs: number;
}

/**
 * «الاختناق دلوقتي: البحث / الصور / الإرجاع» — سطر واحد بيقولك تصلّح فين.
 * بيرجع idle لو مفيش قياسات كفاية.
 */
export function bottleneck(samples: StepSample[], minSamples = 3): Bottleneck {
  const stats = summarize(samples).filter((s) => s.count >= Math.min(minSamples, 1));
  const used = stats.filter((s) => s.count > 0 && s.totalMs > 0);
  if (!used.length) return { step: "idle", label: "لسه مفيش قياس", share: 0, avg: 0, totalMs: 0 };
  const total = used.reduce((n, s) => n + s.totalMs, 0);
  const top = used.reduce((a, b) => (b.totalMs > a.totalMs ? b : a));
  return {
    step: top.step,
    label: STEP_LABEL[top.step],
    share: total ? Math.round((top.totalMs / total) * 1000) / 10 : 0,
    avg: top.avg,
    totalMs: top.totalMs,
  };
}

export interface SabSpeed {
  sab: string;
  totalMs: number;
  searchMs: number;
  captureMs: number;
  deleteMs: number;
  forms: number;
}

/** أبطأ السابات — بتوريك ساب معيّن هو السبب بدل ما تلوم البرنامج كله */
export function slowestSabs(samples: StepSample[], n = 10): SabSpeed[] {
  const map = new Map<string, SabSpeed>();
  for (const s of samples) {
    if (!s.sab) continue;
    let row = map.get(s.sab);
    if (!row) {
      row = { sab: s.sab, totalMs: 0, searchMs: 0, captureMs: 0, deleteMs: 0, forms: 0 };
      map.set(s.sab, row);
    }
    row.totalMs += s.ms;
    if (s.step === "search" || s.step === "scan") row.searchMs += s.ms;
    if (s.step === "capture" || s.step === "click") row.captureMs += s.ms;
    if (s.step === "delete") row.deleteMs += s.ms;
    if (s.step === "capture" && s.ok) row.forms += 1;
  }
  return [...map.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, Math.max(0, n));
}

const csvCell = (v: string | number | boolean | undefined) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV بتوقيت كل خطوة — يفتح في إكسل بالعربي من غير مشاكل ترميز */
export function stepsToCsv(samples: StepSample[]): string {
  const head = ["الوقت", "الساب", "الخطوة", "المللي ثانية", "الثواني", "نجحت", "ملاحظة"];
  const rows = samples
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((s) => [
      new Date(s.at).toISOString(),
      s.sab,
      STEP_LABEL[s.step],
      s.ms,
      (s.ms / 1000).toFixed(2),
      s.ok ? "نعم" : "لا",
      s.note ?? "",
    ]);
  return "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** ملخص نصي قصير لجلسة — بيتحط في تقرير الإكسل ولوحة التشغيل */
export function speedLine(samples: StepSample[]): string {
  const b = bottleneck(samples);
  if (b.step === "idle") return "لسه مفيش قياسات كفاية.";
  return `الاختناق دلوقتي: ${b.label} (${b.share}٪ من الوقت، متوسط ${b.avg} مللي للخطوة).`;
}
