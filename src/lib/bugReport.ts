/**
 * التقاط الأخطاء غير المتوقعة في الواجهة وإرسالها للعملية الرئيسية
 * اللي بتعمل البلاغ على GitHub (التوكن هناك، من متغيرات البيئة).
 *
 * قواعد مهمة:
 *  • مفيش أي إرسال إلا عند خطأ فعلي — مفيش تتبّع استخدام ولا تقارير دورية.
 *  • كل خطأ بيتبعت مرة واحدة في الجلسة (نفس النص + نفس المكان).
 *  • لو المستخدم قافل الإبلاغ من الإعدادات، بنحفظ محليًا بس (main بيعمل كده).
 *  • الدالة دي عمرها ما بترمي استثناء — هي نفسها أداة إنقاذ.
 */
import { bridge } from "./provider";
import { useAppStore } from "./store";

export interface ReportInput {
  error: unknown;
  /** من فين الخطأ: زر، جلسة، شاشة… */
  source: string;
  /** ملاحظات إضافية تظهر في البلاغ */
  notes?: string;
}

let installed = false;
const sentKeys = new Set<string>();
const MAX_PER_SESSION = 5;

/** تفكيك أي قيمة مرفوضة لشكل موحّد */
export function normalizeThrown(input: unknown): { name: string; message: string; stack: string } {
  if (input instanceof Error) {
    return { name: input.name || "Error", message: input.message || "", stack: input.stack || "" };
  }
  if (typeof input === "string") return { name: "Error", message: input, stack: "" };
  try {
    return { name: "Unknown", message: JSON.stringify(input) ?? String(input), stack: "" };
  } catch {
    return { name: "Unknown", message: String(input), stack: "" };
  }
}

/** مفتاح منع التكرار داخل الجلسة */
export function reportKey(name: string, message: string, source: string): string {
  return `${source}::${name}::${message}`.slice(0, 400);
}

function reportingEnabled(): boolean {
  try {
    return useAppStore.getState().settings.errorReporting !== false;
  } catch {
    return true;
  }
}

/**
 * إرسال بلاغ خطأ (بيتبعت تلقائيًا من الـ handlers، أو يدويًا من شاشة الخطأ).
 * بترجع نتيجة الإرسال لو الجسر موجود، وإلا بترجع `null`.
 */
export async function reportError({ error, source, notes }: ReportInput) {
  const b = bridge();
  const norm = normalizeThrown(error);
  const key = reportKey(norm.name, norm.message, source);
  if (sentKeys.has(key) && !notes) return null;
  if (sentKeys.size >= MAX_PER_SESSION) return null;
  sentKeys.add(key);
  if (!b) return null;
  try {
    const state = useAppStore.getState();
    return await b.reportError({
      name: norm.name,
      message: norm.message,
      stack: norm.stack,
      source,
      screen: state.screen,
      phase: state.session.phase || state.session.state,
      notes,
      enabled: reportingEnabled(),
    });
  } catch {
    // لو حتى الإبلاغ فشل، مفيش حاجة تتعمل — ماينفعش يعطّل البرنامج
    return null;
  }
}

/**
 * تركيب مستمعات الأخطاء العامة مرة واحدة عند فتح البرنامج.
 * `window.onerror` بيمسك أخطاء التشغيل، و`unhandledrejection` بيمسك الوعود المرفوضة.
 */
export function installErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    // أخطاء تحميل مورد مش خطأ برمجي — بنتجاهلها
    if (!event.error && !event.message) return;
    const target = event.target as HTMLElement | null;
    if (target && target !== (window as unknown as HTMLElement) && (target as HTMLImageElement).tagName === "IMG") {
      return;
    }
    void reportError({
      error: event.error ?? event.message,
      source: "window.onerror",
      notes: event.filename ? `الملف: ${event.filename}:${event.lineno ?? 0}` : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    void reportError({ error: event.reason, source: "unhandledrejection" });
  });
}

/** للاختبارات ولإعادة الضبط */
export function resetReportingState() {
  sentKeys.clear();
  installed = false;
}
