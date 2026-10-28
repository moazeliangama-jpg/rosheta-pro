/**
 * منطق تجربة الاستخدام — مفصول عن الواجهة عشان يتاختبر.
 *
 * الفكرة الأساسية: المستخدم ميحتاجش يفكر «أنا فين وإيه اللي بعده».
 * البرنامج بيحسب من الحالة **الخطوة الجاية الوحيدة** ويعرضها كزرار كبير،
 * ومعاه شريط تقدّم للمراحل، وقائمة الجاهزية، وتلميحات سياقية.
 */
import { progressSummary } from "./eligibility";

export type Screen = "setup" | "run" | "decision" | "results";

export interface UxCase {
  rx: { status: string };
  valid: boolean;
  hasDrugs: string | null;
}

export interface UxSnapshot {
  hasPatients: boolean;
  patientsCount: number;
  hasPayer: boolean;
  loggedIn: boolean;
  cases: UxCase[];
  sessionState: string;
  /** آخر ساب اكتمل — لو موجود وفيه شغل ناقص، الواجهة تقترح «استكمال» */
  lastSab?: string;
  waState?: string;
  /** رسائل جاهزة للإرسال */
  outreachQueued?: number;
}

export type ActionTone = "setup" | "primary" | "success" | "warn" | "done";

export interface NextAction {
  id:
    | "upload"
    | "payer"
    | "login"
    | "scan"
    | "images"
    | "decide"
    | "retry"
    | "send"
    | "finished";
  label: string;
  hint: string;
  screen: Screen;
  tone: ActionTone;
  /** رقم المرحلة (١..٥) — بيتعرض كـ«الخطوة ٢ من ٥» */
  step: number;
  totalSteps: number;
  /** عدد العناصر اللي الزرار بيعالجها (صور/قرارات/رسائل) */
  count?: number;
  /** مفيش أي حاجة تتعمل — زرار اختياري */
  optional?: boolean;
}

export const TOTAL_STEPS = 5;

/**
 * الخطوة الجاية الوحيدة. الترتيب مقصود: أول شرط ناقص هو اللي بيتعرض،
 * والباقي بيظهر بعده لما يخلص.
 */
export function nextBestAction(snap: UxSnapshot): NextAction {
  const busy = snap.sessionState === "running" || snap.sessionState === "scanning";

  if (!snap.hasPatients) {
    return {
      id: "upload",
      label: "ارفع ملف السابات",
      hint: "ملف Excel فيه الساب والاسم ومكان العمل — أو اسحبه على الشاشة",
      screen: "setup",
      tone: "primary",
      step: 1,
      totalSteps: TOTAL_STEPS,
    };
  }

  if (!snap.hasPayer) {
    return {
      id: "payer",
      label: "اختر الباير",
      hint: "من غيره البحث بيرجع فاضي — اختاره مرة واحدة وبيفضل محفوظ",
      screen: "setup",
      tone: "primary",
      step: 1,
      totalSteps: TOTAL_STEPS,
    };
  }

  if (!snap.loggedIn) {
    return {
      id: "login",
      label: "اختبر الدخول على نايس دير",
      hint: "ثانية واحدة — وبيتأكد إن اليوزر والباسورد والباير سليمين",
      screen: "setup",
      tone: "primary",
      step: 1,
      totalSteps: TOTAL_STEPS,
    };
  }

  if (busy) {
    return {
      id: snap.sessionState === "scanning" ? "scan" : "images",
      label: "الشغل شغال دلوقتي…",
      hint: "تقدر تتابع التقدّم من شاشة التشغيل — البرنامج بيكمّل لوحده",
      screen: "run",
      tone: "primary",
      step: snap.sessionState === "scanning" ? 2 : 3,
      totalSteps: TOTAL_STEPS,
    };
  }

  const stats = progressSummary(snap.cases);

  // مفيش جرد لسه: الحالة الأولى في كل يوم
  if (!snap.cases.length) {
    return {
      id: "scan",
      label: "ابدأ الجرد",
      hint: `${snap.patientsCount} ساب — البرنامج بيقرأ الجدولين ويطبّق مدة الصلاحية`,
      screen: "setup",
      tone: "primary",
      step: 2,
      totalSteps: TOTAL_STEPS,
      count: snap.patientsCount,
    };
  }

  // «محتاجة التقاط» = لسه ما اتجربتش. الفاشلة ليها مسار إعادة محاولة منفصل.
  const needsImages = snap.cases.filter(
    (c) => c.valid && c.rx.status !== "ready" && c.rx.status !== "failed",
  ).length;
  if (needsImages > 0) {
    return {
      id: "images",
      label: `جلب صور الروشتات (${needsImages})`,
      hint: "بيفتح كل استمارة، يلتقط صورتها، ويرجّعها على السيستم",
      screen: "setup",
      tone: "primary",
      step: 3,
      totalSteps: TOTAL_STEPS,
      count: needsImages,
    };
  }

  // فشل صور: الإصلاح قبل القرار عشان المستخدم ما يقفش على روشتة ناقصة
  if (stats.failed > 0) {
    return {
      id: "retry",
      label: `إعادة الصور المتعثرة (${stats.failed})`,
      hint: "محاولة تانية تلقائية — اللي نجح مش بيتلمس",
      screen: "decision",
      tone: "warn",
      step: 3,
      totalSteps: TOTAL_STEPS,
      count: stats.failed,
    };
  }

  const undecided = snap.cases.filter((c) => c.valid && c.hasDrugs === null).length;
  if (undecided > 0) {
    return {
      id: "decide",
      label: `ابدأ القرار (${undecided} متبقّي)`,
      hint: "١ بها دواء · ٢ بدون · مسافة للتالي · Ctrl+Z للتراجع",
      screen: "decision",
      tone: "success",
      step: 4,
      totalSteps: TOTAL_STEPS,
      count: undecided,
    };
  }

  if ((snap.outreachQueued ?? 0) > 0) {
    return {
      id: "send",
      label: `ابعت رسائل واتساب (${snap.outreachQueued})`,
      hint: "الرسائل جاهزة — بتبعت بفاصل آمن وتقدر توقف في أي وقت",
      screen: "results",
      tone: "success",
      step: 5,
      totalSteps: TOTAL_STEPS,
      count: snap.outreachQueued,
    };
  }

  return {
    id: "finished",
    label: "كل حاجة خلصت ✓",
    hint: "تقدر تصدّر التقرير أو تبدأ جرد جديد",
    screen: "results",
    tone: "done",
    step: TOTAL_STEPS,
    totalSteps: TOTAL_STEPS,
    optional: true,
  };
}

export interface Stage {
  key: string;
  label: string;
  step: number;
  status: "done" | "current" | "todo";
}

/** شريط المراحل — ٥ دوائر صغيرة بتقول إحنا فين من غير ما تشغل بال المستخدم */
export function stageProgress(snap: UxSnapshot): Stage[] {
  const stats = progressSummary(snap.cases);
  const next = nextBestAction(snap);
  const doneFlags: Record<string, boolean> = {
    prep: snap.hasPatients && snap.hasPayer && snap.loggedIn,
    scan: snap.cases.length > 0,
    images: snap.cases.length > 0 && snap.cases.every((c) => c.rx.status === "ready" || !c.valid),
    decide: stats.decided > 0 && stats.decided >= stats.valid,
    send: (snap.outreachQueued ?? 0) === 0 && stats.decided > 0,
  };
  const defs: Array<{ key: string; label: string }> = [
    { key: "prep", label: "التجهيز" },
    { key: "scan", label: "الجرد" },
    { key: "images", label: "الصور" },
    { key: "decide", label: "القرار" },
    { key: "send", label: "الإرسال" },
  ];
  const currentStep = next.step;
  return defs.map((d, i) => {
    const step = i + 1;
    const status: Stage["status"] = doneFlags[d.key] ? "done" : step === currentStep ? "current" : "todo";
    return { key: d.key, label: d.label, step, status };
  });
}

export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  /** اختياري: مش بيمنع التشغيل */
  optional?: boolean;
  hint: string;
  screen?: Screen;
}

/** قائمة «إيه الناقص قبل التشغيل» — بتمنع الأخطاء المتوقعة قبل ما تحصل */
export function readinessChecks(snap: UxSnapshot): ReadinessItem[] {
  return [
    {
      key: "patients",
      label: "ملف السابات",
      ok: snap.hasPatients,
      hint: snap.hasPatients ? `${snap.patientsCount} ساب` : "ارفع ملف Excel",
      screen: "setup",
    },
    {
      key: "payer",
      label: "الباير",
      ok: snap.hasPayer,
      hint: snap.hasPayer ? "محدد" : "اختاره من شاشة الإعداد",
      screen: "setup",
    },
    {
      key: "login",
      label: "الدخول على نايس دير",
      ok: snap.loggedIn,
      hint: snap.loggedIn ? "متأكد" : "اضغط «اختبر الدخول»",
      screen: "setup",
    },
    {
      key: "whatsapp",
      label: "واتساب",
      // مجهول ≠ مقفول: لو ما سألناش واتساب لسه، ما نزعّجش المستخدم بتحذير كاذب
      ok: snap.waState === undefined ? true : snap.waState === "ready",
      optional: true,
      hint:
        snap.waState === undefined
          ? "بيتأكد لوحده — مش شرط للجرد"
          : snap.waState === "ready"
            ? "متصل"
            : "مش متصل — لازم للرسائل بس، مش شرط للجرد",
      screen: "setup",
    },
  ];
}

/** هل المستخدم جاهز يبدأ التشغيل؟ (الاختياري مش بيمنع) */
export function canStartRun(snap: UxSnapshot): boolean {
  return readinessChecks(snap)
    .filter((c) => !c.optional)
    .every((c) => c.ok);
}

export interface SmartTip {
  id: string;
  text: string;
  tone: "info" | "warn" | "ok";
}

/**
 * تلميحات سياقية — بتظهر في مكان واحد بس، ولو مفيش حاجة مهمة بترجع فاضي
 * (عشان الواجهة ما تبقاش مليانة كلام).
 */
export function smartTips(snap: UxSnapshot): SmartTip[] {
  const tips: SmartTip[] = [];
  const stats = progressSummary(snap.cases);

  if (snap.cases.length && stats.failed > 0) {
    tips.push({
      id: "failed",
      text: `${stats.failed} صورة متعثرة — زرار واحد يعيدها كلها من غير ما يلمس اللي نجح.`,
      tone: "warn",
    });
  }
  if (snap.lastSab && snap.cases.length) {
    tips.push({
      id: "resume",
      text: `تقدر تكمّل من آخر ساب اتوقف عنده (${snap.lastSab}) بدل ما تبدأ من الأول.`,
      tone: "info",
    });
  }
  if (stats.decided > 0 && stats.decided < stats.valid) {
    tips.push({
      id: "remaining",
      text: `فاضل ${stats.valid - stats.decided} قرار — اختصارات ١ و٢ ومسافة بتخلصهم أسرع بكتير.`,
      tone: "info",
    });
  }
  if (snap.waState && snap.waState !== "ready" && stats.decided > 0) {
    tips.push({
      id: "wa",
      text: "واتساب مش متصل — اربطه من الإعداد قبل ما تبعت الرسائل.",
      tone: "warn",
    });
  }
  return tips.slice(0, 2);
}

export interface CommandLike {
  id: string;
  label: string;
  keywords?: string;
}

/**
 * فلترة أوامر لوحة الأوامر (Ctrl+K):
 * بتدور في الاسم والكلمات المفتاحية، وبتقدّم اللي بيبدأ بالنص المدخل.
 */
export function filterCommands<T extends CommandLike>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    const haystack = `${label} ${(item.keywords || "").toLowerCase()}`;
    if (!terms.every((t) => haystack.includes(t))) continue;
    let score = 0;
    if (label.startsWith(q)) score += 100;
    if (label.includes(q)) score += 50;
    // كل كلمة بتطابق بداية كلمة في الاسم = ترتيب أعلى
    for (const t of terms) if (new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) score += 20;
    scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.item);
}

/** عرض الاختصار بشكل موحّد: ctrl+k → Ctrl K */
export function formatShortcut(combo: string): string {
  return combo
    .split("+")
    .map((part) => {
      const p = part.trim().toLowerCase();
      if (p === "ctrl") return "Ctrl";
      if (p === "shift") return "Shift";
      if (p === "alt") return "Alt";
      if (p === "esc" || p === "escape") return "Esc";
      if (p === "space") return "مسافة";
      if (p === "enter") return "Enter";
      return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(" + ");
}
