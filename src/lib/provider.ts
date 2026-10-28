import type { BridgeResult, NdSearchResult } from "./types";

/**
 * الجسر إلى محرك سطح المكتب — مفيش أي محاكاة هنا.
 * كل دالة بتنادي أتمتة حقيقية على نايس دير، ولو الجسر مش موجود
 * بيرمي خطأ صريح بدل ما يرجع بيانات وهمية.
 */

export interface SystemInfo {
  maxWorkers: number;
  maxDeleters: number;
  cores: number;
  totalMb: number;
  freeMb: number;
  workers: number;
  captures: number;
  platform: string;
  electron: string;
}

export interface MaintenanceInfo {
  removed?: number;
  logs: { count: number; bytes: number };
  diagnostics: { count: number; bytes: number };
  backups?: { count: number; bytes: number };
  retention: { logs: number; diagnostics: number };
}

export interface RoshettaBridge {
  platform: string;
  version: string;
  setCredentials: (p: { username?: string; password?: string; maxWorkers?: number }) => Promise<BridgeResult>;
  setWorkers: (n: number) => Promise<BridgeResult<{ maxWorkers: number; captures: number; info?: SystemInfo }>>;
  /** ضبط عدد النوافذ من القياس الحقيقي (بيرفض الزيادة لو الرام قربت تخلص) */
  tune: (workers: number) => Promise<BridgeResult<{ workers: number; captures: number; rejected: boolean; freeMb: number }>>;
  /** حظر نوم الجهاز أثناء الجلسة */
  busy: (active: boolean) => Promise<BridgeResult<{ active: boolean }>>;
  warmup: (workers: number) => Promise<BridgeResult<{ workers: number; ms: number; loggedIn: boolean }>>;
  deletes: () => Promise<
    BridgeResult<{
      pending: number;
      running: number;
      retryable?: number;
      results: Record<string, { state: string; ms?: number; error?: string }>;
    }>
  >;
  /** إعادة محاولة الإرجاعات الفاشلة مرة واحدة */
  retryDeletes: () => Promise<BridgeResult<{ retried: number }>>;
  /** خلاص استمارات الساب — المتصفح اللي شايله يرجع للحوض */
  releaseSab: (p: { sab: string }) => Promise<BridgeResult<{ sab: string; released: number }>>;
  /** إلغاء أي إرجاع لسه ما اتنفذش — الإلغاء معناه مفيش حذف خالص */
  cancelDeletes: (p?: { reason?: string }) => Promise<BridgeResult<{ cancelled: number; running: number }>>;
  /** كتابة سطر في ملف اللوج على القرص (يفضل بعد قفل البرنامج) */
  log: (p: { level: string; msg: string }) => Promise<BridgeResult>;
  /** فحص السلكتورات على الموقع الحقيقي — بيقول أي سلكتور اختفى */
  probe: () => Promise<BridgeResult<{ page: string; results: Array<{ selector: string; label: string; found: boolean }>; missing: string[] }>>;
  /** حفظ لقطة HTML للتشخيص (وضع Debug) */
  dumpHtml: (p: { sab?: string; reason?: string }) => Promise<BridgeResult<{ file: string }>>;
  /** فحص جاهزية الجهاز — البرنامج بيجهّز نفسه بنفسه */
  preflight: () => Promise<BridgeResult<{ checks: Array<{ key: string; label: string; ok: boolean; detail: string }>; ok: boolean; dirs?: Record<string, string> }>>;
  /** ١٢٧) صيانة ملفات اللوج والتشخيص: إحصاء / تنضيف القديم / مسح الكل */
  maintenance: (p: {
    action: "stats" | "prune" | "clear" | "open-logs" | "open-diagnostics" | "open-backups" | "open-bug-reports";
  }) => Promise<BridgeResult<MaintenanceInfo & { dir?: string }>>;
  /** ٦٠) نسخة احتياطية يومية: الملف بيتحفظ في بيانات البرنامج */
  backup: (p: { name: string; json: string }) => Promise<BridgeResult<{ file: string; bytes: number }>>;
  /**
   * الإبلاغ التلقائي عن الأخطاء غير المتوقعة.
   * `enabled: false` بيوقّف الإرسال (البلاغ بيتحفظ محليًا بس).
   */
  reportError: (payload: {
    name?: string;
    message: string;
    stack?: string;
    source?: string;
    screen?: string;
    phase?: string;
    notes?: string;
    enabled?: boolean;
  }) => Promise<
    BridgeResult<{ status: "sent" | "queued" | "existing" | "duplicate" | "rate-limit" | "disabled"; url?: string; number?: number }>
  >;
  /** حالة الإبلاغ: مفعّل/محتاج توكن + عدد البلاغات والطابور */
  bugReport: {
    info: () => Promise<
      BridgeResult<{
        enabled: boolean;
        reason: string;
        repo: string;
        tokenVar: string;
        hint?: string;
        sentToday: number;
        maxPerDay: number;
        pending: number;
        lastSentAt: number;
        lastSentUrl: string;
        dir: string;
      }>
    >;
    flush: () => Promise<BridgeResult<{ sent: number; remaining: number }>>;
  };
  /** ٩٦) تحديث البرنامج: فحص الإصدار، تنزيل المثبّت، وتشغيله */
  updates: {
    check: () => Promise<
      BridgeResult<{
        available: boolean;
        canInstall?: boolean;
        latest?: string;
        current?: string;
        asset?: string;
        url?: string;
        size?: number;
        message: string;
        htmlUrl?: string;
      }>
    >;
    download: (p: { url: string; asset?: string }) => Promise<BridgeResult<{ file: string; bytes: number }>>;
    run: (p: { file: string }) => Promise<BridgeResult<{ file: string }>>;
  };
  /** بيانات دخول نايس دير مشفّرة بمفتاح النظام (مش localStorage) */
  credentials: {
    save: (p: { username: string; password: string }) => Promise<BridgeResult>;
    load: () => Promise<BridgeResult<{ username: string; password: string } | null>>;
  };
  login: (p?: { username?: string; password?: string }) => Promise<
    BridgeResult & { already?: boolean; verified?: boolean; state?: string; trace?: string[]; files?: Record<string, string> | null; ms?: number }
  >;
  /** فتح نافذة نايس دير المرئية (تسجيل يدوي / عدّي التحقق البشري مرة واحدة) */
  openLoginWindow: (p?: { url?: "login" | "search" }) => Promise<BridgeResult<{ url: string; hasCode: boolean }>>;
  /** وضع نوافذ الأتمتة: خلفية مرئية (افتراضي، مش بتاخد التركيز) أو مخفية تمامًا */
  setWindowMode: (p: { background: boolean }) => Promise<BridgeResult<{ background: boolean }>>;
  /** آخر خطوات محاولة الدخول (تشخيص) */
  loginTrace: () => Promise<BridgeResult<{ trace: string[] }>>;
  /** «شوف النوافذ» — تعرض نوافذ الأتمتة فوق الشاشة أو ترجّعها للخلفية */
  watchWindows: (p: { on: boolean }) => Promise<BridgeResult<{ on: boolean; windows: number }>>;
  /** خطوات حقيقية من نوافذ نايس دير أثناء الشغل — بترجّع دالة إلغاء الاشتراك */
  onStep: (cb: (line: { at: number; message: string; ref?: string }) => void) => () => void;
  status: () => Promise<BridgeResult & { loggedIn?: boolean; workers?: number; info?: SystemInfo }>;
  searchSub: (p: { sab: string; payerId: string; payerName: string; timeoutMs?: number }) => Promise<
    BridgeResult<NdSearchResult> & { ms?: number }
  >;
  fetchFormImage: (p: {
    sab: string;
    reference: string;
    source: "pre-approval" | "claim";
    href?: string;
    payerId: string;
    payerName: string;
    preventDelete: boolean;
  }) => Promise<
    BridgeResult<{
      dataUrl: string;
      method: string;
      deleted: boolean;
      deleteState: string;
      /** طول طابور الإرجاع في الخلفية بعد إضافة الاستمارة دي */
      deleteQueue?: number;
      /** الصورة اتجابت من نتائج البحث المفتوحة (بدون بحث جديد) */
      reusedSearch?: boolean;
      timings?: { searchMs?: number; clickMs?: number; captureMs?: number; totalMs?: number };
      notes?: string[];
    }>
  >;
  logoutNiceDeer: () => Promise<BridgeResult>;
  openSearchSite: () => Promise<BridgeResult>;
  wa: {
    status: () => Promise<BridgeResult & { state?: string }>;
    pair: () => Promise<BridgeResult & { state?: string }>;
    logout: () => Promise<BridgeResult>;
    send: (p: { phone: string; text: string }) => Promise<BridgeResult>;
    replies: (p: { phone: string }) => Promise<BridgeResult<{ last: string; all: Array<{ text: string; incoming: boolean }> }>>;
    openChat: (p: { phone: string; text?: string }) => Promise<BridgeResult>;
  };
  closeAll: () => Promise<boolean>;
  /** كتابة ملف تصدير على القرص فعلاً وبرجوع مساره (مش تنزيل مبهم) */
  saveFile: (p: { name: string; base64?: string; text?: string }) => Promise<
    BridgeResult<{ file: string; bytes: number; name: string; dir: string }>
  >;
  openExportFolder: () => Promise<BridgeResult<{ dir: string }>>;
  notify: (p: { title: string; body: string }) => Promise<BridgeResult>;
}

declare global {
  interface Window {
    roshetta?: RoshettaBridge;
  }
}

// الجسر مش موجود في المتصفح ولا في بيئة الاختبار — الفحص لازم ما يرميش
export const bridge = (): RoshettaBridge | null =>
  typeof window === "undefined" ? null : (window.roshetta ?? null);
export const hasDesktopBridge = () => Boolean(bridge());

export function requireBridge(): RoshettaBridge {
  const b = bridge();
  if (!b) throw new Error("أتمتة نايس دير تحتاج نسخة سطح المكتب (الـ EXE) — المتصفح مش قادر يشغّل النوافذ المخفية");
  return b;
}

/** تحويل أخطاء الجسر إلى رسالة عربية واضحة */
export function bridgeError(res: BridgeResult | undefined, fallback: string) {
  if (!res) return fallback;
  return res.error || fallback;
}

export const WORKER_MAX = 10;
