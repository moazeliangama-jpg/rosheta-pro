import { useAppStore } from "./store";
import { evaluateMonthly, evaluateValidity, isMonthlyForm } from "./eligibility";
import { bridge, bridgeError, requireBridge } from "./provider";
import type { CaseRecord, FailedRecord, MonthlyCheck, NdForm, NdSearchResult, PatientRow } from "./types";
import { clamp, dateKey, sleep, uid } from "./utils";
import { buildTasks, type Task } from "./tasks";
import { bottleneck, speedLine, type StepSample, type StepName } from "./metrics";
import { RetryBudget, backoffDelay, classifyError, errorHint, shouldAbortEarly } from "./retry";
import { initialWorkers, tuneWorkers } from "./tune";
import { prepareNote, preparePatients } from "./prepare";
import { hourAdjustment } from "./hourly";
import { setSaveDelay } from "./store";
import { OFFLINE_MESSAGE, isOnline, waitForOnline } from "./net";

export { buildTasks };
export type { Task };

const MAX_ATTEMPTS = 3;
/** فاصل إعادة المحاولة الأساسي — backoff أسّي مع عشوائية */
const RETRY_BASE_MS = 250;

/** ترتيب ثابت للاستمارات: الأقدم الأول (المدة بتخلص) */
const byDate = (a: CaseRecord, b: CaseRecord) => (a.formDateISO || "").localeCompare(b.formDateISO || "");

/** جلسة واحدة بس في الوقت نفسه (منع تشغيل جلستين متوازيين) */
let activeEngine: SessionEngine | null = null;

export const caseKey = (sab: string, source: string, reference: string) => `${sab}::${source}::${reference}`;
export const deleteKey = (sab: string, reference: string) => `${sab}::${reference}`;

export function toCase(
  patient: PatientRow,
  form: NdForm,
  settings: { payerId: string; payerName: string; validityDays: number },
  today = new Date(),
): CaseRecord {
  const validity = evaluateValidity({
    source: form.source,
    dateISO: form.dateISO,
    date: form.date,
    today,
    validityDays: settings.validityDays,
  });
  return {
    id: caseKey(patient.sab, form.source, form.reference),
    sab: patient.sab,
    patientName: patient.name,
    phone: patient.phone,
    workplace: patient.workplace,
    payerId: settings.payerId,
    payerName: settings.payerName,
    source: form.source,
    reference: form.reference,
    type: form.type,
    claimType: form.claimType,
    code: form.code,
    href: form.href,
    formDate: form.date,
    formDateISO: form.dateISO,
    monthly: isMonthlyForm(form),
    valid: validity.valid,
    validityReason: validity.reason,
    deleted: false,
    deleteState: "skipped",
    rx: { status: "pending", attempts: 0, updatedAt: Date.now() },
    hasDrugs: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** بركة تنفيذ بسيطة بعدد محدد */
async function pool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  if (!items.length) return;
  let cursor = 0;
  const size = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
      }
    }),
  );
}

type Listener = () => void;

/**
 * محرك التشغيل السريع:
 *  1) تسخين كل النوافذ بالتوازي (تحميل صفحة البحث مرة واحدة).
 *  2) جرد: بحث كل ساب في نداء واحد (باير → إغلاق → ساب → Search → ثبات النتائج).
 *  3) صور: نافذة الصورة بتتفتح وتتلقط فورًا، والإرجاع (Delete) بيتم في الخلفية.
 */
export class SessionEngine {
  private cancelled = false;
  private paused = false;
  private startedAt = 0;
  private workers = 5;
  private failures = 0;
  private doneSubs = 0;
  private doneForms = 0;
  private images = 0;
  private readonly onTick: Listener;

  private searchMsTotal = 0;
  private searchCount = 0;
  private captureMsTotal = 0;
  private captureCount = 0;
  private keyToId = new Map<string, string>();
  private pollInFlight = false;
  private lastPoll = 0;

  /** قياس كل خطوة — بيتفرّغ للمخزن كل نبضة بدل تحديث مع كل عملية */
  private steps: StepSample[] = [];
  /** قياس الساعات بيتجمّع هنا وبيتفرّغ في النبضة (بدل تحديث مخزن لكل خطوة) */
  private hourSamples: Array<{ hour: number; ms: number }> = [];
  private budget = new RetryBudget(150);
  private consecutiveFailures = 0;
  private avgRecent: number[] = [];
  private prevAvg = 0;
  private cap = 12;
  private searchTimeoutMs = 18000;
  private lastSab = "";
  private missingCount = 0;
  /** عدّاد إعادة استخدام نتائج البحث (بدل بحث جديد) — بيثبت إن goBack بيشتغل */
  private reusedSearches = 0;
  private freshSearches = 0;
  /** ١١٤) سلسلة أخطاء شبكة/مهلة — لو طالت بنقلّل النوافذ في الجلسة اليدوية */
  private networkHits = 0;

  constructor(onTick: Listener = () => {}) {
    this.onTick = onTick;
  }

  private settings() {
    return useAppStore.getState().settings;
  }

  private log(level: "info" | "ok" | "warn" | "error", msg: string) {
    // رسالة الخطأ بتتحول لنص فيه الحل في سطر (مش نص الخطأ الخام)
    const line = level === "error" ? errorHint(msg) : msg;
    useAppStore.getState().logLine(level, line);
    // ١٢١) نفس السطر بيتكتب في ملف على القرص يفضل بعد قفل البرنامج
    void bridge()?.log({ level, msg: line });
  }

  /** تسجيل خطوة في القياس (بيتجمّع وبيتفرّغ في النبضة) */
  private record(sab: string, step: StepName, ms: number, ok = true, note?: string) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.steps.push({ at: Date.now(), sab, step, ms: Math.round(ms), ok, note });
    this.avgRecent.push(Math.round(ms));
    if (this.avgRecent.length > 40) this.avgRecent.shift();
    // ١١٢) سرعة السيرفر حسب الساعة — بيتجمّع هنا وبيتفرّغ في النبضة
    if (ok && (step === "search" || step === "capture") && ms > 0) {
      this.hourSamples.push({ hour: new Date().getHours(), ms: Math.round(ms) });
    }
    // ١١٤) تتبّع أخطاء الشبكة المتتالية
    if (ok) this.networkHits = 0;
    else if (/مهلة|timeout|ERR_|شبك|اتصال|مش بتستجيب/i.test(note ?? "")) this.networkHits += 1;
  }

  private flushSteps() {
    if (this.steps.length) {
      const batch = this.steps;
      this.steps = [];
      useAppStore.getState().pushSteps(batch);
    }
    // نفس الفكرة للساعات: تحديث واحد لكل نبضة بدل تحديث لكل خطوة
    if (this.hourSamples.length) {
      const hours = this.hourSamples;
      this.hourSamples = [];
      const store = useAppStore.getState();
      for (const h of hours) store.addHourSample(h.hour, h.ms);
    }
  }

  /** نقطة استكمال: آخر ساب اكتمل بيتحفظ فورًا */
  private checkpoint(sab: string) {
    this.lastSab = sab;
    useAppStore.getState().patchSession({ lastSab: sab });
  }

  /** فشل ساب: بيزوّد عدّاد الفشل المتتالي عشان نوقف لو الإعداد غلط */
  private failSab(reason: string, sab: string, name: string, workplace: string) {
    this.consecutiveFailures += 1;
    this.fail(reason, "بحث", sab, name, workplace, "");
    if (shouldAbortEarly(this.consecutiveFailures, this.doneSubs)) {
      this.cancelled = true;
      this.log(
        "error",
        `أول ${this.consecutiveFailures} سابات فشلوا كلهم — وقفت تلقائيًا بدل ما أكرر نفس الخطأ. راجع بيانات الدخول والباير.`,
      );
      // ١٢٦) إشعار بالتوقف بسبب خطأ — مش بس لما الجلسة تخلص بنجاح
      void bridge()?.notify({
        title: "الجلسة اتوقفت بسبب خطأ",
        body: `أول ${this.consecutiveFailures} سابات فشلوا — راجع بيانات الدخول والباير في الإعداد.`,
      });
    }
  }

  private requestedWorkers() {
    const s = this.settings();
    // الوضع التلقائي بيبدأ من نص سقف الجهاز وبعدها بيتظبط من القياس الحقيقي
    return initialWorkers(s.workerChoice, this.cap);
  }

  async syncBridge() {
    const b = bridge();
    if (!b) return;
    const s = this.settings();
    await b.setCredentials({
      username: s.niceDeerUser,
      password: s.niceDeerPass,
      maxWorkers: this.requestedWorkers(),
    });
    // سقف النوافذ من إمكانيات الجهاز الحقيقية (رام وأنوية)
    const res = await b.setWorkers(this.requestedWorkers());
    const info = res?.data?.info;
    if (info?.maxWorkers) this.cap = Math.max(1, info.maxWorkers);
    this.workers = this.requestedWorkers();
  }

  async start(patients: PatientRow[], opts: { fresh: boolean; scan?: boolean; images?: boolean }) {
    const store = useAppStore.getState();
    const b = requireBridge();
    const doScan = opts.scan !== false;
    const doImages = opts.images !== false;
    const s0 = this.settings();

    // منع تشغيل جلستين في نفس الوقت (يدوي + تلقائي مثلًا)
    if (activeEngine && activeEngine !== this) {
      this.log("warn", "فيه جلسة شغالة بالفعل — استنى تخلص أو أوقفها الأول.");
      return;
    }
    activeEngine = this;

    this.cancelled = false;
    this.paused = false;
    this.failures = 0;
    this.doneSubs = 0;
    this.doneForms = 0;
    this.images = 0;
    this.searchMsTotal = 0;
    this.searchCount = 0;
    this.captureMsTotal = 0;
    this.captureCount = 0;
    this.keyToId.clear();
    this.steps = [];
    this.hourSamples = [];
    this.avgRecent = [];
    this.prevAvg = 0;
    this.budget = new RetryBudget(150);
    this.consecutiveFailures = 0;
    this.missingCount = 0;
    this.reusedSearches = 0;
    this.freshSearches = 0;
    this.startedAt = Date.now();

    // أثناء التشغيل بنأجل كتابة الحالة (٣ ثواني) عشان الشغل ما يتعطلش،
    // وبنفحص الحالة المحفوظة من يوم تاني عشان الكاش ما يبقاش قديم.
    setSaveDelay(3000);

    await this.syncBridge();
    this.searchTimeoutMs = s0.turboMode ? 14000 : 18000;

    if (opts.fresh) {
      store.clearFailed();
      store.clearSamples();
      store.clearSteps();
      store.clearOutreach();
      store.clearLog();
    }

    // تجهيز القائمة بيخص الجرد بس (مرحلة الصور بتشتغل على الاستمارات المحفوظة)
    if (doScan) {
      const prepared = preparePatients(patients, {
        cache: useAppStore.getState().sabCache,
        day: dateKey(),
        force: opts.fresh,
        // ٦٦) استكمال: مش بنعيد اللي خلص قبل الوقفة
        resumeAfter: opts.fresh ? undefined : useAppStore.getState().session.lastSab || undefined,
      });
      // بعد ما استخدمنا الكاش في الترتيب والتخطي، بنمسح اللي مش من النهاردة
      store.clearSabCache(dateKey());
      if (!prepared.list.length) {
        this.log("warn", `مفيش سابات محتاجة شغل. ${prepareNote(prepared.stats)}`);
        // قبل كده كنا بنرجع من غير ما نرجّع سرعة الحفظ ولا نرجّع حالة الجلسة،
        // فالحفظ كان يفضل بطيء (٣ ثواني) والجلسة تفضل «شغالة» في الواجهة.
        setSaveDelay(600);
        useAppStore.getState().patchSession({ state: "done", phase: "idle", endedAt: Date.now() });
        activeEngine = null;
        return;
      }
      const note = prepareNote(prepared.stats);
      if (note) this.log("info", note);
      patients = prepared.list;
      this.missingCount = prepared.stats.missing;
      if (this.missingCount) {
        this.log("info", `${this.missingCount} ساب كان «غير موجود» النهاردة — اتخطى لتوفير الوقت.`);
      }
    }

    store.patchSession({
      state: doScan ? "scanning" : "running",
      phase: doScan ? "scan" : "images",
      startedAt: this.startedAt,
      endedAt: null,
      subsTotal: patients.length,
      subsDone: 0,
      formsTotal: Object.values(store.cases).length,
      formsDone: 0,
      images: 0,
      failures: 0,
      workers: this.workers,
      autoWorkers: s0.workerChoice === "auto",
      turbo: s0.turboMode,
      avgSearchMs: 0,
      avgCaptureMs: 0,
      formsPerMin: 0,
      etaMin: null,
      deletePending: 0,
      decisions: [],
      lastTuneAt: Date.now(),
      lastSab: "",
      bottleneck: "",
      autoTuned: 0,
      stuckWindows: 0,
    });

    // الجهاز ما ينامش أثناء الجلسة
    void b.busy(true);

    this.timer = setInterval(() => this.tick(), 1200);

    // تسخين النوافذ بالتوازي — بيفتح صفحة البحث مرة واحدة لكل نافذة
    if (s0.turboMode) {
      const warm = await b.warmup(this.workers);
      if (warm.ok) {
        this.log("ok", `تسخين ${warm.data?.workers ?? this.workers} نوافذ في ${warm.data?.ms ?? 0} مللي ثانية.`);
      } else {
        this.log("warn", `تسخين النوافذ لم يكتمل: ${warm.error ?? "سبب غير معروف"}`);
      }
    }

    this.log(
      "info",
      `بدء التشغيل — ${patients.length} ساب، ${this.workers} نوافذ، ${s0.turboMode ? "وضع مرعب ⚡" : "وضع عادي"}، الباير: ${s0.payerName || "غير محدد"}`,
    );

    // الوضع المرعب: بنشتغل كل ساب لآخره (جرد + صور) على نفس النافذة —
    // بحث واحد لكل ساب بدل ما الجرد كله يخلص وبعدها نعيد البحث لكل استمارة.
    if (doScan && doImages && s0.turboMode) {
      await this.pipelinePhase(patients);
    } else {
      if (doScan) await this.scanPhase(patients);
      if (!this.cancelled && doImages) await this.imagePhase();
    }

    // دورة تانية للفاشلين: مرة واحدة بس آخر الجلسة
    if (!this.cancelled && doImages) await this.retryAllFailed();

    // الإرجاعات الفاشلة بتتعاد مرة واحدة، وبعدها بنستنى الطابور يخلص
    await b.retryDeletes();
    await this.resolveDeletes(120000);

    this.finish();
  }

  private timer?: ReturnType<typeof setInterval>;

  private tick() {
    const store = useAppStore.getState();
    const elapsedMin = Math.max((Date.now() - this.startedAt) / 60000, 0.02);
    const rate = this.doneForms / elapsedMin;
    store.pushSample({
      at: Date.now(),
      done: this.doneForms,
      failed: this.failures,
      forms: this.images,
      workers: this.workers,
    });

    // سطر الاختناق الحقيقي من القياس (مش تخمين)
    const line = speedLine(this.steps.length ? this.steps : store.steps);
    const bn = bottleneck(this.steps.length ? this.steps : store.steps);

    store.patchSession({
      subsDone: this.doneSubs,
      formsDone: this.doneForms,
      images: this.images,
      failures: this.failures,
      avgSearchMs: this.searchCount ? Math.round(this.searchMsTotal / this.searchCount) : 0,
      avgCaptureMs: this.captureCount ? Math.round(this.captureMsTotal / this.captureCount) : 0,
      formsPerMin: Math.round(rate * 10) / 10,
      etaMin: rate > 0 ? Math.max(0, Math.round(((store.session.formsTotal - this.doneForms) / rate) * 10) / 10) : null,
      bottleneck: bn.step === "idle" ? "" : line,
    });

    this.flushSteps();
    void this.autoTune();
    void this.pollDeletes();
    this.onTick();
  }

  /**
   * الضبط التلقائي: كل ١٥ ثانية بنقرر نزوّد نافذة أو نقلّل،
   * على أساس المتوسط الحقيقي ونسبة الفشل — مش رقم ثابت في الإعدادات.
   */
  private async autoTune() {
    const store = useAppStore.getState();
    if (!store.session.autoWorkers) return;
    if (Date.now() - store.session.lastTuneAt < 15000) return;
    if (this.avgRecent.length < 4) return;
    const avg = Math.round(this.avgRecent.reduce((n, v) => n + v, 0) / this.avgRecent.length);
    const decision = tuneWorkers({
      workers: this.workers,
      cap: this.cap,
      avgMs: avg,
      prevAvgMs: this.prevAvg,
      successes: Math.max(1, this.doneForms + this.doneSubs - this.failures),
      failures: this.failures,
    });

    // ١١٣) لو الساعة الحالية أبطأ من المعتاد على السيرفر، نقلّل نافذة قبل أي زيادة
    const hour = hourAdjustment(useAppStore.getState().hourly, new Date().getHours(), avg);
    // ١١٤) النت ضعيف (٣ أخطاء شبكة متتالية) → نقلّل بدل ما نزوّد
    const weakNetwork = this.networkHits >= 3;

    if (weakNetwork && this.workers > 2) {
      this.prevAvg = avg;
      store.patchSession({ lastTuneAt: Date.now() });
      this.workers -= 1;
      await bridge()?.tune(this.workers);
      store.patchSession({ workers: this.workers, autoTuned: store.session.autoTuned + 1 });
      this.log("warn", `النت ضعيف (${this.networkHits} أخطاء متتالية) — تقليل النوافذ لـ ${this.workers}.`);
      return;
    }
    if (hour.factor < 0 && this.workers > 2) {
      this.prevAvg = avg;
      store.patchSession({ lastTuneAt: Date.now() });
      this.workers -= 1;
      await bridge()?.tune(this.workers);
      store.patchSession({ workers: this.workers, autoTuned: store.session.autoTuned + 1 });
      this.log("info", `ضبط بالساعة: ${hour.reason} (${this.workers} نافذة).`);
      return;
    }
    this.prevAvg = avg;
    store.patchSession({ lastTuneAt: Date.now() });
    if (!decision.changed) return;

    this.workers = clamp(decision.workers, 1, this.cap);
    const b = bridge();
    if (b) {
      const res = await b.tune(this.workers);
      const applied = res?.data?.workers;
      if (typeof applied === "number") this.workers = applied;
      if (res?.data?.rejected) {
        this.log("warn", "الذاكرة الحرة قليلة — ضبط النوافذ اتمنع للحفاظ على استقرار الجهاز.");
        return;
      }
    }
    store.patchSession({ workers: this.workers, autoTuned: store.session.autoTuned + 1 });
    this.log("info", `ضبط تلقائي: ${this.workers} نافذة — ${decision.reason}.`);
  }

  // -------------------------------------------------------------------------
  // المرحلة ١: الجرد
  // -------------------------------------------------------------------------

  private async scanPhase(patients: PatientRow[]) {
    await pool(patients, this.workers, async (patient) => {
      while (this.paused && !this.cancelled) await sleep(150);
      if (this.cancelled) return;
      await this.scanOne(patient);
    });
    const count = Object.values(useAppStore.getState().cases).length;
    this.log("ok", `انتهى الجرد — ${count} استمارة من ${patients.length} ساب.`);
  }

  /**
   * ٦٧) قبل أي شغل على الشبكة: لو النت واقف بنستنى رجوعه بدل ما نحرق المحاولات
   * ونعلّم استمارات كأنها فشلت.
   */
  private async ensureOnline(what: string): Promise<void> {
    if (isOnline()) return;
    this.log("warn", `النت واقف قبل ${what} — البرنامج مستني رجوع الاتصال…`);
    const self = this;
    const signal = { get cancelled() { return self.cancelled; } };
    const ok = await waitForOnline({
      timeoutMs: 10 * 60 * 1000,
      signal,
      onWait: (ms) => {
        if (ms > 0 && ms % 60000 === 0) this.log("info", `لسه مستني النت (${Math.round(ms / 60000)} دقيقة).`);
      },
    });
    if (!ok || this.cancelled) throw new Error(OFFLINE_MESSAGE);
    this.log("ok", "النت رجع — بنكمّل من نفس المكان.");
  }

  private async scanOne(patient: PatientRow): Promise<CaseRecord[]> {
    const b = requireBridge();
    const s = this.settings();
    const store = useAppStore.getState();
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !this.cancelled; attempt++) {
      await this.ensureOnline(`بحث الساب ${patient.sab}`);
      const t0 = Date.now();
      try {
        const res = await b.searchSub({
          sab: patient.sab,
          payerId: s.payerId,
          payerName: s.payerName,
          timeoutMs: this.searchTimeoutMs,
        });
        if (!res.ok) throw new Error(bridgeError(res, "فشل البحث في نايس دير"));
        const data = res.data as NdSearchResult;
        const searchMs = res.ms ?? Date.now() - t0;
        this.searchMsTotal += searchMs;
        this.searchCount += 1;
        this.record(patient.sab, "search", searchMs, true, `استمارات: ${data.forms?.length ?? 0}`);

        // البحث بقى أسرع من المتوقع؟ نقلّل المهلة شوية (مهلة تكيّفية)
        const avg = this.searchCount ? this.searchMsTotal / this.searchCount : searchMs;
        this.searchTimeoutMs = clamp(Math.round(avg * 4 + 4000), 8000, 20000);

        const phone = (data.phone || patient.phone || "").trim();
        const effective: PatientRow = { ...patient, phone };

        if (data.empty || !data.forms.length) {
          store.logLine("warn", `الساب ${patient.sab}: ${data.note || "مفيش استمارات"}`);
          store.setSabCache(patient.sab, { day: dateKey(), forms: 0, missing: true, at: Date.now() });
          // ١١٨) لقطة HTML عند «مفيش نتائج مش متأكد منها» — عشان لو الموقع اتغير نعرف فورًا
          if (s.debugMode && !data.note?.includes("لم يرجع")) {
            const dump = await b.dumpHtml({ sab: patient.sab, reason: "search-empty" });
            if (dump?.ok) this.log("warn", `اتحفظت لقطة HTML للتشخيص: ${dump.data?.file ?? ""}`);
          }
          this.consecutiveFailures = 0;
          this.doneSubs += 1;
          this.checkpoint(patient.sab);
          return [];
        }

        const today = dateKey();
        const seen = useAppStore.getState().seenForms;
        const cases = data.forms.map((f) => {
          const c = toCase(effective, f, s);
          // ١١٦) أول يوم ظهرت فيه الاستمارة — أساس جلسة «الجديد فقط»
          c.firstSeen = seen[c.id] ?? today;
          return c;
        });
        // دفعة واحدة بدل تحديث لكل استمارة
        store.upsertCases(cases);
        store.markSeen(cases.map((c) => c.id), today);

        // كاش اليوم: الساب اتجرد — مش هيتكرر في نفس اليوم (والوقت محفوظ للعرض)
        store.setSabCache(patient.sab, { day: today, forms: cases.length, at: Date.now() });

        const monthlyForms = data.forms
          .filter((f) => isMonthlyForm(f))
          .map((f) => ({ dateISO: f.dateISO, date: f.date, reference: f.reference }));
        store.upsertMonthly([
          evaluateMonthly({
            sab: patient.sab,
            patientName: patient.name,
            phone,
            workplace: patient.workplace,
            monthlyForms,
            validityDays: s.validityDays,
          }),
        ]);

        const validCount = cases.filter((c) => c.valid).length;
        store.logLine(
          "ok",
          `الساب ${patient.sab} (${patient.name}): ${cases.length} استمارة — ${validCount} داخل المدة في ${Date.now() - t0} مللي.`,
        );
        this.consecutiveFailures = 0;
        this.doneSubs += 1;
        this.checkpoint(patient.sab);
        return cases;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "خطأ غير معروف";
        const kind = classifyError(lastError);
        this.record(patient.sab, "search", Date.now() - t0, false, lastError.slice(0, 120));

        // «غير موجود»: مفيش فايدة من الإعادة — بنسجّله وبنكمّل
        if (kind === "permanent") {
          store.setSabCache(patient.sab, { day: dateKey(), forms: 0, missing: true });
          break;
        }
        // الجلسة انتهت: ندخل تاني مرة واحدة ونعيد
        if (kind === "session" && attempt === 1) {
          this.log("warn", `الساب ${patient.sab}: انتهت الجلسة — إعادة تسجيل الدخول.`);
          try {
            await b.login();
          } catch {
            /* المحاولة التالية هتوضّح */
          }
          continue;
        }
        // ميزانية الإعادات: ما نضربش السيرفر بمئات المحاولات
        if (!this.budget.take()) break;
        await sleep(backoffDelay(attempt, RETRY_BASE_MS));
      }
    }

    this.failSab(lastError || "فشل بعد ٣ محاولات", patient.sab, patient.name, patient.workplace);
    this.doneSubs += 1;
    this.checkpoint(patient.sab);
    return [];
  }

  /**
   * خط إنتاج: لكل ساب — بحث واحد، وبعدها صور استماراته على نفس النافذة.
   * بيوفر بحث كامل لكل استمارة لأن نتايج الساب بتفضل محفوظة في النافذة.
   */
  private async pipelinePhase(patients: PatientRow[]) {
    this.log("info", `وضع مرعب ⚡: خطة مختلطة — كل ساب بيتجرد وبيتصور على نفس النافذة (${this.workers} نوافذ).`);

    await pool(patients, this.workers, async (patient) => {
      while (this.paused && !this.cancelled) await sleep(150);
      if (this.cancelled) return;

      const cases = await this.scanOne(patient);
      if (!cases.length || this.cancelled) return;

      const queue = cases
        .map((c) => useAppStore.getState().cases[c.id] ?? c)
        .filter((c) => this.needsImage(c))
        .sort(byDate);

      const st = useAppStore.getState();
      st.patchSession({
        phase: queue.length ? "images" : "scan",
        // العدد الإجمالي المعروف لحد دلوقتي — شريط التقدم بيفضل واقعي
        formsTotal: Object.values(st.cases).filter((c) => this.needsImage(c)).length + this.doneForms,
      });

      for (const c of queue) {
        while (this.paused && !this.cancelled) await sleep(150);
        if (this.cancelled) return;
        await this.fetchImage(c);
        this.doneForms += 1;
        this.onTick();
      }
    });

    const total = Object.values(useAppStore.getState().cases).length;
    this.log("ok", `خلصت خطة الوضع المرعب — ${total} استمارة من ${patients.length} ساب.`);
  }

  // -------------------------------------------------------------------------
  // المرحلة ٢: الصور
  // -------------------------------------------------------------------------

  private imageQueue(): CaseRecord[] {
    return Object.values(useAppStore.getState().cases).filter((c) => this.needsImage(c)).sort(byDate);
  }

  /**
   * ١١٥) استمارة أخدت قرار فعلًا ما بتتعادش — حتى لو صورتها اتمسحت.
   * ١١٦) ولو «الجديد فقط» مفعّل، بنجيب الصور للاستمارات اللي ظهرت النهاردة بس.
   */
  private needsImage(c: CaseRecord) {
    const s = this.settings();
    if (!(c.valid || s.includeInvalid)) return false;
    if (c.hasDrugs !== null) return false;
    if (s.onlyNewForms && c.firstSeen !== dateKey()) return false;
    return c.rx.status !== "ready";
  }

  private async imagePhase() {
    const queue = this.imageQueue();
    const store = useAppStore.getState();
    store.patchSession({ state: "running", phase: "images", formsTotal: queue.length, formsDone: 0 });

    if (!queue.length) {
      this.log("warn", "مفيش استمارات داخل المدة محتاجة صور.");
      return;
    }

    const tasks = buildTasks(queue, this.workers);
    this.log(
      "info",
      `بدء التقاط ${queue.length} روشتة موزعة على ${tasks.length} مهمة / ${this.workers} نافذة (أطول مهمة: ${tasks[0]?.items.length ?? 0} استمارة).`,
    );

    await pool(tasks, this.workers, async (task) => {
      for (const c of task.items) {
        while (this.paused && !this.cancelled) await sleep(150);
        if (this.cancelled) return;
        await this.fetchImage(c);
        this.doneForms += 1;
        this.onTick();
      }
    });
  }

  private async fetchImage(c: CaseRecord) {
    const b = requireBridge();
    const s = this.settings();
    const store = useAppStore.getState();
    let lastError = "";

    // ١٥) لو الصورة موجودة فعلًا في التخزين، مفيش داعي نفتح الروشتة تاني
    const current = store.cases[c.id];
    if (current?.rx.status === "ready") return;

    store.setRxStatus(c.id, { status: "loading", attempts: 0, updatedAt: Date.now() });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !this.cancelled; attempt++) {
      await this.ensureOnline(`صورة ${c.reference}`);
      const t0 = Date.now();
      try {
        const res = await b.fetchFormImage({
          sab: c.sab,
          reference: c.reference,
          source: c.source,
          href: c.href,
          payerId: c.payerId,
          payerName: c.payerName,
          preventDelete: s.preventDelete,
        });
        if (!res.ok || !res.data?.dataUrl) throw new Error(bridgeError(res, "لم تُرجع نافذة الروشتة صورة"));

        store.setImage(c.id, res.data.dataUrl, res.data.method);
        store.patchCase(c.id, {
          deleted: Boolean(res.data.deleted),
          deleteState: res.data.deleteState || "unknown",
        });

        if (res.data.reusedSearch) this.reusedSearches += 1;
        else this.freshSearches += 1;

        const timings = res.data.timings || {};
        if (typeof timings.searchMs === "number") {
          this.searchMsTotal += timings.searchMs;
          this.searchCount += 1;
          if (timings.searchMs > 0) this.record(c.sab, "search", timings.searchMs, true, "بحث جوه الروشتة");
        }
        if (typeof timings.clickMs === "number") this.record(c.sab, "click", timings.clickMs, true);
        if (typeof timings.captureMs === "number") {
          this.captureMsTotal += timings.captureMs;
          this.captureCount += 1;
          this.record(c.sab, "capture", timings.captureMs, true, res.data.method);
        }

        // ضغط طابور الإرجاع: لو تراكم بكتير بنستنى شوية بدل ما نكبّر الطابور
        if ((res.data as { deleteQueue?: number }).deleteQueue) {
          await this.waitForDeleteBacklog();
        }

        this.keyToId.set(deleteKey(c.sab, c.reference), c.id);
        this.images += 1;
        this.consecutiveFailures = 0;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "خطأ غير معروف";
        const kind = classifyError(lastError);
        this.record(c.sab, "capture", Date.now() - t0, false, lastError.slice(0, 120));

        if (kind === "permanent") break;
        if (kind === "session" && attempt === 1) {
          try {
            await b.login();
          } catch {
            /* المحاولة الجاية */
          }
          continue;
        }
        if (!this.budget.take()) break;
        await sleep(backoffDelay(attempt, RETRY_BASE_MS));
        store.setRxStatus(c.id, {
          status: "loading",
          attempts: attempt,
          reason: lastError,
          updatedAt: Date.now(),
        });
      }
    }

    store.setRxStatus(c.id, { status: "failed", attempts: MAX_ATTEMPTS, reason: lastError, updatedAt: Date.now() });
    this.fail(lastError || "فشل جلب الصورة بعد ٣ محاولات", "صورة", c.sab, c.patientName, c.workplace, c.reference);

    // ٧٠) في وضع Debug: لقطة HTML وقت الفشل (اختيارية) — بتفرّق بين «الموقع اتغير» و«الصورة بطيئة»
    if (s.debugMode) {
      try {
        const dump = await b.dumpHtml({ sab: c.sab, reason: `capture-${c.reference}` });
        if (dump?.ok) this.log("warn", `اتحفظت لقطة HTML لفشل الصورة ${c.reference}: ${dump.data?.file ?? ""}`);
      } catch {
        /* اللقطة مش شرط */
      }
    }
  }

  /** لو طابور الإرجاع اتخنق، بنهدّي جلب الصور شوية بدل تكديس أكتر */
  private async waitForDeleteBacklog(limit = 60, maxWaitMs = 15000) {
    const b = bridge();
    if (!b) return;
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      const res = await b.deletes();
      const pending = (res.data?.pending || 0) + (res.data?.running || 0);
      useAppStore.getState().patchSession({ deletePending: pending });
      if (pending <= limit) return;
      await sleep(400);
    }
  }

  /** دورة تانية للصور اللي فشلت — بتتنادى آخر الجلسة أو من زرار «أعد كل الفاشل» */
  async retryAllFailed() {
    const s = this.settings();
    const store = useAppStore.getState();
    const failed = Object.values(store.cases).filter(
      (c) => c.rx.status === "failed" && (c.valid || s.includeInvalid),
    );
    if (!failed.length) return;
    this.log("info", `محاولة أخيرة لـ ${failed.length} روشتة متعثرة.`);
    void bridge()?.busy(true);
    for (const c of failed) {
      if (this.cancelled) return;
      store.setRxStatus(c.id, { status: "loading", attempts: 0, updatedAt: Date.now() });
      await this.fetchImage(c);
    }
    void bridge()?.busy(false);
  }

  // -------------------------------------------------------------------------
  // الإرجاع (Delete) في الخلفية
  // -------------------------------------------------------------------------

  private async pollDeletes(force = false) {
    const b = bridge();
    if (!b || this.pollInFlight) return;
    if (!force && Date.now() - this.lastPoll < 2500) return;
    this.pollInFlight = true;
    this.lastPoll = Date.now();
    try {
      const res = await b.deletes();
      if (!res.ok || !res.data) return;
      this.applyDeleteResults(res.data.results || {});
      useAppStore.getState().patchSession({ deletePending: (res.data.pending || 0) + (res.data.running || 0) });
    } catch {
      /* تجاهل */
    } finally {
      this.pollInFlight = false;
    }
  }

  private applyDeleteResults(results: Record<string, { state: string }>) {
    const store = useAppStore.getState();
    let patched = 0;
    for (const [key, value] of Object.entries(results)) {
      const id = this.keyToId.get(key);
      if (!id) continue;
      const current = store.cases[id];
      if (!current) continue;
      const state = value.state;
      if (state === "queued" || state === "running") continue;
      if (current.deleteState === state) continue;
      store.patchCase(id, { deleted: state === "done", deleteState: state });
      patched += 1;
    }
    if (patched) this.log("info", `تحديث حالة الإرجاع لـ ${patched} استمارة.`);
  }

  private async resolveDeletes(timeoutMs = 90000) {
    const b = bridge();
    if (!b || !this.keyToId.size) return;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await this.pollDeletes(true);
      const res = await b.deletes();
      const data = res.data;
      if (!data) break;
      if ((data.pending || 0) === 0 && (data.running || 0) === 0) {
        this.applyDeleteResults(data.results || {});
        break;
      }
      await sleep(350);
    }
  }

  // -------------------------------------------------------------------------
  // تحكم
  // -------------------------------------------------------------------------

  private fail(reason: string, step: FailedRecord["step"], sab: string, name: string, workplace: string, reference: string) {
    if (this.cancelled) return;
    this.failures += 1;
    useAppStore.getState().addFailed({
      id: uid("fail"),
      sab,
      patientName: name,
      workplace,
      step,
      reference,
      reason,
      at: Date.now(),
    });
    this.log("error", `${step} فشل — ساب ${sab}${reference ? ` مرجع ${reference}` : ""}: ${reason}`);
  }

  /** إعادة جلب صورة استمارة واحدة (محرك مستقل عن الجلسة الشغالة) */
  async retryImage(c: CaseRecord) {
    this.cancelled = false;
    await this.syncBridge();
    useAppStore.getState().logLine("info", `إعادة جلب صورة ${c.reference} — ساب ${c.sab}`);
    await this.fetchImage(c);
    await this.pollDeletes(true);
  }

  /** إعادة الجرد لساب واحد */
  async rescanSab(patient: PatientRow) {
    this.cancelled = false;
    await this.syncBridge();
    await this.scanOne(patient);
  }

  pause() {
    this.paused = true;
    useAppStore.getState().patchSession({ state: "paused" });
    this.log("warn", "إيقاف مؤقت — العمليات الجارية هتكمل.");
  }

  resume() {
    this.paused = false;
    useAppStore.getState().patchSession({ state: "running" });
    this.log("info", "استكمال التشغيل.");
  }

  async stop() {
    this.cancelled = true;
    this.paused = false;
    if (this.timer) clearInterval(this.timer);
    const store = useAppStore.getState();
    for (const c of Object.values(store.cases)) {
      if (c.rx.status === "loading" || c.rx.status === "pending") {
        store.setRxStatus(c.id, {
          status: "failed",
          attempts: 0,
          reason: "التشغيل اتوقف قبل جلب الصورة — اضغط إعادة الجلب",
          updatedAt: Date.now(),
        });
      }
    }
    this.log("warn", "تم إيقاف التشغيل.");
    this.finish();
  }

  private finish() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.flushSteps();
    const store = useAppStore.getState();
    const elapsedMin = Math.max((Date.now() - this.startedAt) / 60000, 0.02);
    const samples = [...this.steps, ...store.steps];
    const bn = bottleneck(samples);
    const line = speedLine(samples);

    store.patchSession({
      state: "done",
      endedAt: Date.now(),
      subsDone: this.doneSubs,
      formsDone: this.doneForms,
      images: this.images,
      failures: this.failures,
      formsPerMin: Math.round((this.doneForms / elapsedMin) * 10) / 10,
      avgSearchMs: this.searchCount ? Math.round(this.searchMsTotal / this.searchCount) : 0,
      avgCaptureMs: this.captureCount ? Math.round(this.captureMsTotal / this.captureCount) : 0,
      etaMin: 0,
      lastSab: this.lastSab,
      bottleneck: bn.step === "idle" ? "" : line,
    });

    const mins = Math.max(1, Math.round(elapsedMin));
    this.log(
      "ok",
      `انتهى التشغيل في ${mins} دقيقة — ${this.images} صورة، ${this.failures} متعثر، ${this.doneSubs} ساب. ${line}`,
    );
    // ٣) قياس إعادة البحث بعد goBack: نسبة إعادة الاستخدام = كفاءة الرجوع
    if (this.reusedSearches + this.freshSearches > 0) {
      const pct = Math.round((this.reusedSearches / (this.reusedSearches + this.freshSearches)) * 100);
      this.log(
        "info",
        `إعادة استخدام نتائج البحث: ${this.reusedSearches} من ${this.reusedSearches + this.freshSearches} (${pct}٪) — الباقي احتاج بحث جديد.`,
      );
    }

    // الجهاز يرجع لطبيعته + الحفظ يرجع سريع بعد ما الشغل خلص
    setSaveDelay(600);
    activeEngine = null;
    const b = bridge();
    if (b) {
      void b.busy(false);
      // تصدير تقرير الجلسة تلقائيًا (اختياري من الإعدادات)
      if (this.settings().autoExport) {
        const st = useAppStore.getState();
        void import("./excel").then(async (x) => {
          const report = await x.exportSessionReport({
            cases: Object.values(st.cases),
            failed: st.failed,
            samples: st.samples,
            sessionMs: Date.now() - this.startedAt,
            steps: st.steps,
          });
          if (report.ok) {
            st.logLine("ok", `تقرير التشغيل اتحفظ: ${report.name ?? report.file}`);
          } else {
            st.logLine("error", `تعذر حفظ تقرير التشغيل: ${report.error ?? "سبب غير معروف"}`);
          }
          // ٩١) إكسل المتعثرين بيتولد لوحده لو فيه تعثرات
          if (st.failed.length) {
            const failedFile = await x.exportFailed(st.failed, {
              "مدة التشغيل": `${Math.round((Date.now() - this.startedAt) / 60000)} دقيقة`,
              "عدد الاستمارات": Object.keys(st.cases).length,
              "صور جاهزة": this.images,
              "متعثرة": this.failures,
            });
            if (!failedFile.ok) {
              st.logLine("error", `تعذر حفظ إكسل المتعثرين: ${failedFile.error ?? "سبب غير معروف"}`);
            }
          }
        });
      }
    }

    // إشعار ويندوز: تعرف إن الجلسة خلصت حتى لو بعيد عن الجهاز
    if (b) {
      void b.notify({
        title: `خلصت الجلسة — ${this.images} صورة`,
        body: `${this.doneSubs} ساب · ${this.failures} متعثر · ${mins} دقيقة. ${line}`,
      });
    }

    store.setScreen("decision");
    this.onTick();
  }
}

/** إعادة حساب الصلاحية على تاريخ النهارده */
export function refreshValidity() {
  const store = useAppStore.getState();
  const s = store.settings;
  let changed = 0;
  for (const c of Object.values(store.cases)) {
    const validity = evaluateValidity({
      source: c.source,
      dateISO: c.formDateISO,
      date: c.formDate,
      validityDays: s.validityDays,
    });
    if (validity.valid !== c.valid || validity.reason !== c.validityReason) {
      store.patchCase(c.id, { valid: validity.valid, validityReason: validity.reason });
      changed += 1;
    }
  }
  if (changed) store.logLine("info", `تم تحديث صلاحية ${changed} استمارة حسب تاريخ اليوم.`);
  return changed;
}

export function orderedCases(ids: string[], cases: Record<string, CaseRecord>) {
  const seen = new Set<string>();
  const list: CaseRecord[] = [];
  for (const id of ids) {
    const c = cases[id];
    if (c && !seen.has(id)) {
      seen.add(id);
      list.push(c);
    }
  }
  for (const [id, c] of Object.entries(cases)) {
    if (!seen.has(id)) list.push(c);
  }
  return list.sort((a, b) => {
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    return (b.formDateISO || "").localeCompare(a.formDateISO || "");
  });
}

export function monthlyList(monthly: Record<string, MonthlyCheck>) {
  return Object.values(monthly).sort((a, b) => a.patientName.localeCompare(b.patientName, "ar"));
}

export type { FailedRecord };
