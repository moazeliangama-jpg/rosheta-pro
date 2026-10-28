// أنواع البيانات — روشتة برو (أتمتة نايس دير الحقيقية)

export type FormSource = "pre-approval" | "claim";

/** استمارة كما تُقرأ من جدولي صفحة البحث في نايس دير */
export interface NdForm {
  /** مفتاح ثابت: الساب + المصدر + الرقم المرجعي */
  refId: string;
  source: FormSource;
  /** الرقم المرجعي (ID في جدول Pre-Approvals أو ND Claim ID في جدول Claims) */
  reference: string;
  /** تاريخ الصف كما ظهر (Pre-Approval Date أو Claim Date) */
  date: string;
  /** التاريخ بعد التحويل ISO (yyyy-mm-dd) */
  dateISO: string;
  /** قيمة عمود Type / Claim Type */
  type: string;
  claimType: string;
  /** Claim Code لو موجود */
  code: string;
  /** رابط صفحة الاستمارة (Claims) — بيستخدم في الإرجاع والالتقاط */
  href: string;
  status: string;
  /** هل الصف مسجّل شهري (من عمود النوع) */
  monthly: boolean;
  rowText: string;
}

export interface NdSearchResult {
  sab: string;
  phone: string;
  name: string;
  forms: NdForm[];
  empty: boolean;
  note?: string;
  url?: string;
}

export type RxStatus = "pending" | "loading" | "ready" | "failed";

export interface RxImage {
  status: RxStatus;
  dataUrl?: string;
  reason?: string;
  attempts: number;
  updatedAt: number;
  /** طريقة الالتقاط الحقيقية: canvas / fetch / screenshot / background */
  method?: string;
}

export type Verdict = "available" | "unavailable" | null;

export interface CaseRecord {
  id: string;
  sab: string;
  patientName: string;
  phone: string;
  workplace: string;
  payerId: string;
  payerName: string;

  source: FormSource;
  reference: string;
  type: string;
  claimType: string;
  code: string;
  href: string;
  formDate: string;
  formDateISO: string;
  monthly: boolean;

  /** داخل مدة الصلاحية (6 أيام، أو الشهر الحالي للـ Pre-Approval) */
  valid: boolean;
  validityReason: string;

  deleted: boolean;
  deleteState: string;
  rx: RxImage;

  /** القرار البشري: الاستمارة بها دواء؟ */
  hasDrugs: Verdict;
  /** تدوير الصورة (٠/٩٠/١٨٠/٢٧٠) — بيتحفظ مع الاستمارة */
  rotation?: number;
  /** أول يوم ظهرت فيه الاستمارة — أساس جلسة «الجديد فقط» */
  firstSeen?: string;
  createdAt: number;
  updatedAt: number;
}

/** حالة الشهري لكل ساب — تحتاج تأكيد بشري زي ما الطلب نص */
export interface MonthlyCheck {
  sab: string;
  patientName: string;
  phone: string;
  workplace: string;
  /** آخر استمارة شهرية وتاريخها */
  lastMonthlyDate: string;
  lastMonthlyRef: string;
  daysSince: number | null;
  /** متاح حسب قاعدة 6 أيام */
  computed: "available" | "unavailable" | "unknown";
  reason: string;
  /** تأكيد المستخدم */
  confirmed: "available" | "unavailable" | null;
  updatedAt: number;
}

export interface PatientRow {
  sab: string;
  name: string;
  phone: string;
  workplace: string;
}

export interface FailedRecord {
  id: string;
  sab: string;
  patientName: string;
  workplace: string;
  step: "بحث" | "صورة" | "إرجاع" | "رسالة";
  reference: string;
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
  forms: number;
  workers: number;
}

export type SessionState = "idle" | "scanning" | "running" | "paused" | "done";

/** عيّنة قياس لخطوة واحدة — بتتحفظ مع الجلسة وبتبني تقرير السرعة */
export interface StepSample {
  at: number;
  sab: string;
  step: "search" | "click" | "capture" | "delete" | "scan";
  ms: number;
  ok: boolean;
  note?: string;
}

export interface SessionMeta {
  state: SessionState;
  phase: "idle" | "scan" | "images";
  startedAt: number | null;
  endedAt: number | null;
  subsTotal: number;
  subsDone: number;
  formsTotal: number;
  formsDone: number;
  images: number;
  failures: number;
  workers: number;
  autoWorkers: boolean;
  turbo: boolean;
  avgSearchMs: number;
  avgCaptureMs: number;
  formsPerMin: number;
  etaMin: number | null;
  deletePending: number;
  decisions: string[];
  lastTuneAt: number;
  /** آخر ساب اكتمل — نقطة استكمال لو الجلسة اتقطعت */
  lastSab: string;
  /** سطر الاختناق الحالي: «البحث» / «التقاط الصورة» … */
  bottleneck: string;
  /** عدد مرات الضبط التلقائي للنوافذ */
  autoTuned: number;
  /** وقت الإنقاذ: نافذة متعلقة اتدمّرت */
  stuckWindows: number;
}

export interface OutreachMessage {
  id: string;
  sab: string;
  name: string;
  phone: string;
  kind: "drugs" | "monthly";
  text: string;
  status: "queued" | "sending" | "sent" | "failed";
  error?: string;
  at: number;
  reply: "approved" | "rejected" | "postpone" | "pending";
  replyText?: string;
  replyAt?: number;
}

export interface Payer {
  id: string;
  name: string;
}

export interface Settings {
  workplace: string;
  payerId: string;
  payerName: string;
  niceDeerUser: string;
  niceDeerPass: string;
  receptionNumbers: string;
  sessionTime: string;
  reportTime: string;
  workerChoice: "auto" | "5" | "8" | "12" | "16";
  /** وضع السرعة القصوى: تسخين نوافذ + إرجاع في الخلفية + إعادة استخدام النتائج */
  turboMode: boolean;
  /** 6 أيام افتراضيًا */
  validityDays: number;
  /** منع الضغط على Delete (الإرجاع) — افتراضيًا الضغط بيتم زي طريقة الصرف */
  preventDelete: boolean;
  /** تشغيل الصور للاستمارات خارج المدة (افتراضيًا لا) */
  includeInvalid: boolean;
  messageDrugs: string;
  messageMonthly: string;
  replyPositive: string;
  replyNegative: string;
  replyPostpone: string;
  sendDelaySec: number;
  /** حد يومي للرسائل — حماية من الحظر */
  dailySendLimit: number;
  /** نسبة العشوائية حوالين فاصل الإرسال (±٪) */
  sendJitterPct: number;
  /** تصدير تقرير الجلسة تلقائيًا في آخر الجلسة */
  autoExport: boolean;
  /** جلسة «الجديد فقط»: تجيب صور الاستمارات اللي ما كانتش موجودة قبل كده */
  onlyNewForms: boolean;
  /** وضع التشخيص: يحفظ HTML الصفحة عند فشل قراءة الجدول */
  debugMode: boolean;
  /** وضع الشاشة الصغيرة (لابتوب) — واجهة أضيق وأخف */
  compactMode: boolean;
  /** خلّص جولة التعريف الأولى — ما تتكررش تلقائيًا */
  onboarded: boolean;
  /** شاف شرح «الخطوة الجاية» — بنعرض الشريط دايمًا بعدها بدون تلميح */
  tourSeen: boolean;
  /** تقليل الحركة والانتقالات (لأجهزة بطيئة أو حساسية حركة) */
  reducedMotion: boolean;
  /** دخول تلقائي على نايس دير عند فتح البرنامج بالبيانات المحفوظة */
  autoLogin: boolean;
  lastReportDate: string;
  lastAutoSessionDate: string;
  lastScanAt: number;
}

/** إحصائيات ساعة كاملة — بتتبني على أسبوع وبتقول أفضل وقت للتشغيل */
export interface HourStat {
  count: number;
  totalMs: number;
}

export interface Profile {
  name: string;
  workplace: string;
  payerId: string;
  payerName: string;
  validityDays: number;
  workerChoice: Settings["workerChoice"];
  turboMode: boolean;
  messageDrugs: string;
  messageMonthly: string;
}

export interface BridgeResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}
