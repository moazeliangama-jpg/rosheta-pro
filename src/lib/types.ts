// أنواع البيانات الأساسية — روشتة برو

export type RxStatus = "pending" | "loading" | "ready" | "failed";

/** صورة الروشتة: دائمًا ليها حالة صريحة، عشان محدش يسيب مكان فاضي بدون تفسير */
export interface RxImage {
  status: RxStatus;
  dataUrl?: string;
  reason?: string;
  attempts: number;
  updatedAt: number;
}

export type Verdict = "available" | "unavailable" | null;

export interface CaseRecord {
  /** مفتاح ثابت لكل استمارة: الساب + رقم الاستمارة (مش رقم النافذة) */
  id: string;
  sab: string;
  patientName: string;
  phone: string;
  workplace: string;
  buyer: string;
  formId: string;
  formType: string;
  formLabel: string;
  formDate: string;
  isMonthly: boolean;
  monthlyEligible: boolean;
  monthlyReason: string;
  deleted: boolean;
  rx: RxImage;
  drugs: Verdict;
  monthly: Verdict;
  createdAt: number;
  updatedAt: number;
}

export interface PatientRow {
  sab: string;
  name: string;
  phone: string;
  workplace: string;
  buyer: string;
}

export interface FormRow {
  formId: string;
  sab: string;
  formType: string;
  formLabel: string;
  date: string;
  isMonthly: boolean;
}

export interface FailedRecord {
  id: string;
  sab: string;
  patientName: string;
  workplace: string;
  step: "بحث" | "صورة" | "إرجاع" | "رسالة";
  form: string;
  reason: string;
  at: number;
}

export interface LogEntry {
  id: string;
  at: number;
  level: "info" | "ok" | "warn" | "error";
  msg: string;
}

export interface SpeedSample {
  at: number;
  done: number;
  failed: number;
  rx: number;
  workers: number;
}

export type SessionState = "idle" | "running" | "paused" | "stopping" | "done";

export interface SessionMeta {
  state: SessionState;
  startedAt: number | null;
  endedAt: number | null;
  subsTotal: number;
  subsDone: number;
  rxTotal: number;
  rxReady: number;
  failures: number;
  workers: number;
  autoWorkers: boolean;
  fastMode: boolean;
  currentBest: number | null;
  decisions: string[];
  lastTuneAt: number;
}

export interface OutreachMessage {
  id: string;
  sab: string;
  name: string;
  phone: string;
  text: string;
  status: "queued" | "sending" | "sent" | "failed";
  at: number;
  reply: "approved" | "rejected" | "pending" | "no-answer";
  replyText?: string;
}

export interface Settings {
  workplace: string;
  buyer: string;
  niceDeerUser: string;
  niceDeerPass: string;
  whatsappSender: string;
  whatsappConnected: boolean;
  receptionNumbers: string;
  sessionTime: string;
  reportTime: string;
  workerChoice: "auto" | "3" | "5" | "8" | "10";
  fastMode: boolean;
  preventDelete: boolean;
  demoMode: boolean;
  messageTemplate: string;
  sendDelaySec: number;
  lastReportDate: string;
  lastAutoSessionDate: string;
  monthlyCooldownDays: number;
}

export interface ProviderSearchResult {
  patient: {
    sab: string;
    name: string;
    phone: string;
    workplace: string;
  };
  forms: Array<{
    formId: string;
    formType: string;
    formLabel: string;
    date: string;
  }>;
}

export interface NiceDeerProvider {
  readonly name: string;
  /** يفتح نافذة مخفية (أو محاكاة) ويبحث عن الساب ويرجع الجدولين */
  searchSub(input: { sab: string; buyer: string; workplace: string; fast: boolean }): Promise<ProviderSearchResult>;
  /** يجلب صورة استمارة. throw عند الفشل عشان المحرك يعيد المحاولة */
  fetchFormImage(input: { sab: string; formId: string; buyer: string; fast: boolean; preventDelete: boolean }): Promise<{ dataUrl: string; deleted: boolean }>;
  /** يرجّع/يغلق النوافذ */
  closeAll?(): Promise<void>;
}
