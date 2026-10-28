/**
 * محلّل سرعة الجرد: بيجاوب على سؤال واحد — **أسرع طريقة نعمل بيها الجرد النهاردة**.
 *
 * كل الأرقام اللي هنا جاية من قياس حقيقي (ملي ثانية لكل خطوة اتسجلت أثناء
 * التشغيل). مفيش رقم ثابت ولا نسبة مخترعة. لما القياس مش كفاية، المحلّل بيقول
 * كده بصراحة بدل ما يطلّع نتيجة على ورق.
 *
 * النموذج (مكتوب صريح عشان أي حد يراجعه):
 *   • الجرد: بحث واحد لكل ساب.
 *   • الصور: لكل استمارة = ضغطة على المرجع + التقاط الصورة.
 *   • الإرجاع: لو في الخلفية بيتوازى مع الصور (مش بيضيف وقت على الترتيب)،
 *     ولو في المقدمة بيضيف وقته لكل استمارة.
 *   • الوضع المرعب (turbo) بيشتغل الساب لآخره على نفس النافذة، فمفيش بحث
 *     جديد لكل استمارة. الوضع العادي بيرجع لصفحة النتائج وبحث جديد بنسبة
 *     فشل في إعادة الاستخدام بتتقاس من الجلسة لو موجودة.
 *   • الزمن الكلي = الشغل ÷ (النوافذ × كفاءة حقيقية مقاسة)، والكفاءة بتتحسب
 *     من جلسة سابقة حقيقية لو موجودة، وإلا بتفترض الأفضل (١) وبتقول إن الرقم
 *     تقديري.
 */
import { summarize, type StepSample } from "./metrics";

export interface MeasuredSession {
  /** استمارات خلصت فعلًا */
  forms: number;
  /** مدة الجلسة الحقيقية */
  elapsedMs: number;
  /** النوافذ اللي كانت شغالة */
  workers: number;
}

export interface AnalyzerInput {
  steps: StepSample[];
  /** عدد السابات اللي هتتراجع */
  sabs: number;
  /** عدد الاستمارات المتوقعة (لو معروف — وإلا بيتقدّر من الاستمارات/الساب) */
  forms: number;
  /** النوافذ الحالية */
  workers: number;
  /** أعلى عدد نوافذ ممكن على الجهاز ده */
  cap: number;
  /** الوضع المرعب شغال؟ */
  turbo: boolean;
  /** الإرجاع في الخلفية شغال؟ */
  deleteInBackground: boolean;
  /** نسبة إعادة استخدام نتائج البحث (٠..١) لو مقاسة */
  reuseRate?: number;
  /** جلسة سابقة حقيقية للمعايرة */
  measured?: MeasuredSession | null;
}

export interface SpeedPlan {
  key: string;
  label: string;
  detail: string;
  workers: number;
  turbo: boolean;
  deleteInBackground: boolean;
  /** الزمن المتوقع بالمللي ثانية */
  projectedMs: number;
  /** هل ده أسرع ترتيب من اللي البرنامج شغال بيه دلوقتي */
  fastest: boolean;
}

export interface AnalyzerResult {
  ready: boolean;
  reason?: string;
  /** المتوسطات الحقيقية المستخدمة (مللي ثانية) */
  measuredMs: { search: number; click: number; capture: number; delete: number; samples: number };
  perSabMs: number;
  perFormMs: number;
  efficiency: { value: number; calibrated: boolean; note: string };
  plans: SpeedPlan[];
  best: SpeedPlan | null;
  /** الوقت اللي بيتوفر لو مشيت على أسرع خطة بدل خطة البرنامج الحالية */
  savingMs: number;
  /** جملة واحدة: أسرع طريقة + الزمن */
  summary: string;
  /** افتراضات وتنبيهات — بتتعرض للمستخدم عشان يعرف الرقم ده مبني على إيه */
  notes: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number) => Math.round(v);

/** أقل عدد قياسات نقدر نبني عليها قرار — أقل من كده «مفيش قياس» */
const MIN_CAPTURE_SAMPLES = 3;

export function analyzeInventorySpeed(input: AnalyzerInput): AnalyzerResult {
  const notes: string[] = [];
  const stats = summarize(input.steps);
  const by = (name: (typeof stats)[number]["step"]) => stats.find((s) => s.step === name);
  const search = Math.max(0, by("search")?.avg ?? 0);
  const click = Math.max(0, by("click")?.avg ?? 0);
  const capture = Math.max(0, by("capture")?.avg ?? 0);
  const del = Math.max(0, by("delete")?.avg ?? 0);
  const captureCount = by("capture")?.count ?? 0;
  const searchCount = by("search")?.count ?? 0;
  const samples = stats.reduce((n, s) => n + s.count, 0);

  const workers = clamp(round(input.workers || 1), 1, 16);
  const cap = clamp(round(input.cap || workers), 1, 16);
  const sabs = Math.max(0, round(input.sabs));
  const forms = Math.max(0, round(input.forms));

  const measuredMs = { search, click, capture, delete: del, samples };
  const empty: AnalyzerResult = {
    ready: false,
    reason: "",
    measuredMs,
    perSabMs: 0,
    perFormMs: 0,
    efficiency: { value: 1, calibrated: false, note: "" },
    plans: [],
    best: null,
    savingMs: 0,
    summary: "",
    notes,
  };

  if (!sabs) return { ...empty, reason: "مفيش سابات مختارة — اختار أماكن العمل أو ارفع الملف الأول." };
  if (!forms) return { ...empty, reason: "مفيش استمارات لسه — اعمل جرد الأول (خطوة ١) وبعدين اطلب تحليل السرعة." };
  if (captureCount < MIN_CAPTURE_SAMPLES || !capture) {
    return {
      ...empty,
      reason: `محتاج ${MIN_CAPTURE_SAMPLES} صور على الأقل عشان أحسب متوسط حقيقي — اتجمع ${captureCount}. شغّل جرد صغير وارجع.`,
    };
  }
  if (!search && !searchCount) {
    notes.push("مفيش قياس بحث مسجّل — حسابي على أساس إن البحث بيتعاد استخدامه بالكامل.");
  }

  // نسبة إعادة استخدام نتائج البحث: مقاسة لو موجودة، وإلا الأفضل (١) مع تنبيه
  const reuse = clamp(input.reuseRate ?? 1, 0, 1);
  if (input.reuseRate === undefined) {
    notes.push("نسبة إعادة استخدام نتائج البحث مش مقاسة — الحساب بيفترض إنها ناجحة دائمًا (أسرع حالة).");
  } else {
    notes.push(`نسبة إعادة استخدام نتائج البحث المقاسة: ${Math.round(reuse * 100)}٪ — الباقي بيحتاج بحث جديد لكل استمارة.`);
  }
  if (!del) notes.push("مفيش قياس للإرجاع (#btn-DeleteClaim) — الإرجاع مش داخل الحساب كوقت.");

  const perSabMs = search + (forms / sabs) * (click + capture);
  const perFormMs = click + capture;

  /** الشغل الكلي لخطة معينة (مللي ثانية متسلسلة قبل التوازي) */
  const workFor = (turbo: boolean, deleteBg: boolean) => {
    const scanWork = sabs * search;
    const imageWork = forms * (click + capture);
    // في الوضع العادي كل استمارة ممكن تحتاج بحث جديد لو النتيجة اتغيّرت
    const reSearchWork = turbo ? 0 : forms * search * (1 - reuse);
    const deleteWork = deleteBg ? 0 : forms * del;
    return scanWork + imageWork + reSearchWork + deleteWork;
  };

  // الكفاءة الحقيقية: إنتاجية الجلسة السابقة ÷ الإنتاجية النظرية بنفس النوافذ
  let efficiencyValue = 1;
  let calibrated = false;
  let efficiencyNote = "مفيش جلسة سابقة معايرة — الأرقام تقديرية (بأفضل كفاءة).";
  const m = input.measured;
  if (m && m.forms > 0 && m.elapsedMs > 0 && m.workers > 0) {
    const throughput = m.forms / m.elapsedMs; // استمارة/مللي ثانية
    const ideal = perFormMs > 0 ? 1 / (perFormMs / m.workers) : 0;
    if (ideal > 0) {
      efficiencyValue = clamp(throughput / ideal, 0.15, 1);
      calibrated = true;
      efficiencyNote = `اتعايرت من آخر جلسة حقيقية: ${m.forms} استمارة في ${Math.round(m.elapsedMs / 1000)} ثانية بـ${m.workers} نوافذ → كفاءة ${Math.round(efficiencyValue * 100)}٪.`;
    }
  }

  const project = (turbo: boolean, deleteBg: boolean, w: number) => {
    const work = workFor(turbo, deleteBg);
    return round(work / Math.max(1, w * efficiencyValue));
  };

  const currentKey = `${input.turbo ? "turbo" : "staged"}-${input.deleteInBackground ? "bg" : "fg"}-${workers}`;

  const candidates: Array<{ key: string; label: string; detail: string; turbo: boolean; bgs: boolean; w: number }> = [
    {
      key: `${input.turbo ? "turbo" : "staged"}-${input.deleteInBackground ? "bg" : "fg"}-${workers}`,
      label: "الإعداد الحالي",
      detail: `${input.turbo ? "جرد+صور لنفس الساب (مرعب)" : "جرد كامل ثم صور"} · الإرجاع ${input.deleteInBackground ? "في الخلفية" : "في المقدمة"} · ${workers} نوافذ`,
      turbo: input.turbo,
      bgs: input.deleteInBackground,
      w: workers,
    },
    {
      key: `turbo-bg-${workers}`,
      label: "مرعب + إرجاع في الخلفية",
      detail: `كل ساب لآخره على نافذته (بحث واحد لكل ساب) · الإرجاع في الخلفية · ${workers} نوافذ`,
      turbo: true,
      bgs: true,
      w: workers,
    },
    {
      key: `turbo-bg-${cap}`,
      label: "مرعب + إرجاع في الخلفية + سقف النوافذ",
      detail: `نفس الترتيب بس بأقصى نوافذ الجهاز (${cap})`,
      turbo: true,
      bgs: true,
      w: cap,
    },
    {
      key: `staged-bg-${cap}`,
      label: "جرد ثم صور + إرجاع في الخلفية + سقف النوافذ",
      detail: "الجرد كله الأول وبعده الصور، بأقصى نوافذ الجهاز",
      turbo: false,
      bgs: true,
      w: cap,
    },
    {
      key: `turbo-fg-${cap}`,
      label: "مرعب + إرجاع في المقدمة",
      detail: "الإرجاع بيستنى كل استمارة — أبطأ بس بيخلي الحذف متأكد قبل اللي بعده",
      turbo: true,
      bgs: false,
      w: cap,
    },
  ];

  const seen = new Set<string>();
  const plans: SpeedPlan[] = [];
  for (const c of candidates) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    plans.push({
      key: c.key,
      label: c.label,
      detail: c.detail,
      workers: c.w,
      turbo: c.turbo,
      deleteInBackground: c.bgs,
      projectedMs: project(c.turbo, c.bgs, c.w),
      fastest: false,
    });
  }

  plans.sort((a, b) => a.projectedMs - b.projectedMs);
  const best = plans[0] ?? null;
  if (best) best.fastest = true;
  const current = plans.find((p) => p.key === currentKey) ?? null;
  const savingMs = current && best ? Math.max(0, current.projectedMs - best.projectedMs) : 0;

  const mins = (ms: number) => Math.max(1, Math.round(ms / 60000));
  const summary = best
    ? `أسرع طريقة للجرد: ${best.label} — حوالي ${mins(best.projectedMs)} دقيقة لـ${forms} استمارة في ${sabs} ساب.`
    : "مفيش خطة قابلة للحساب.";

  if (!calibrated) notes.push("الكفاءة الحقيقية مش معايرة: الرقم بيحسب الشغل على أكمل وجه — الواقع غالبًا أبطأ، والفارق بيقل بعد أول جلسة.");
  notes.push("الأرقام مبنية على متوسطات القياس المسجّل على الجهاز ده، مش على أرقام عامة.");

  return {
    ready: true,
    measuredMs,
    perSabMs: round(perSabMs),
    perFormMs: round(perFormMs),
    efficiency: { value: efficiencyValue, calibrated, note: efficiencyNote },
    plans,
    best,
    savingMs,
    summary,
    notes,
  };
}

/** صياغة الزمن للمستخدم: «٣ دقايق» / «ساعة و١٢ دقيقة» */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 60) return `${totalMin} دقيقة`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} ساعة و${m} دقيقة` : `${h} ساعة`;
}
