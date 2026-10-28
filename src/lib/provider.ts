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
  /** كتابة سطر في ملف اللوج على القرص (يفضل بعد قفل البرنامج) */
  log: (p: { level: string; msg: string }) => Promise<BridgeResult>;
  /** فحص السلكتورات على الموقع الحقيقي — بيقول أي سلكتور اختفى */
  probe: () => Promise<BridgeResult<{ page: string; results: Array<{ selector: string; label: string; found: boolean }>; missing: string[] }>>;
  /** حفظ لقطة HTML للتشخيص (وضع Debug) */
  dumpHtml: (p: { sab?: string; reason?: string }) => Promise<BridgeResult<{ file: string }>>;
  /** فحص جاهزية الجهاز — البرنامج بيجهّز نفسه بنفسه */
  preflight: () => Promise<BridgeResult<{ checks: Array<{ key: string; label: string; ok: boolean; detail: string }>; ok: boolean; dirs?: Record<string, string> }>>;
  /** ١٢٧) صيانة ملفات اللوج والتشخيص: إحصاء / تنضيف القديم / مسح الكل */
  maintenance: (p: { action: "stats" | "prune" | "clear" | "open-logs" | "open-diagnostics" }) => Promise<
    BridgeResult<MaintenanceInfo & { dir?: string }>
  >;
  login: (p?: { username?: string; password?: string }) => Promise<BridgeResult & { already?: boolean }>;
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
  deleteForm: (p: { sab: string; reference: string; source: string; payerId: string; payerName: string }) => Promise<BridgeResult>;
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
  openExportFolder: () => Promise<BridgeResult<{ dir: string }>>;
  notify: (p: { title: string; body: string }) => Promise<BridgeResult>;
  openExternal: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    roshetta?: RoshettaBridge;
  }
}

export const bridge = (): RoshettaBridge | null => window.roshetta ?? null;
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
