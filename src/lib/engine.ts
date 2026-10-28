import { useAppStore } from "./store";
import { evaluateMonthly, evaluateValidity, isMonthlyForm } from "./eligibility";
import { bridge, bridgeError, requireBridge } from "./provider";
import type { CaseRecord, FailedRecord, MonthlyCheck, NdForm, NdSearchResult, PatientRow } from "./types";
import { clamp, sleep, uid } from "./utils";

const MAX_ATTEMPTS = 3;

export const caseKey = (sab: string, source: string, reference: string) => `${sab}::${source}::${reference}`;

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

async function pool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

type Listener = () => void;

/**
 * محرك التشغيل الحقيقي:
 *  المرحلة 1 «جرد»: بحث كل ساب في نايس دير وقراءة الجدولين + التليفون،
 *                  وتطبيق قاعدة الصلاحية (6 أيام / Pre-Approval في الشهر).
 *  المرحلة 2 «صور»: الضغط على كل رقم مرجعي، التقاط صورة الروشتة، الإرجاع (Delete).
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
  private recentFailures: number[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private finished = false;
  private readonly onTick: Listener;

  constructor(onTick: Listener = () => {}) {
    this.onTick = onTick;
  }

  private settings() {
    return useAppStore.getState().settings;
  }

  private log(level: "info" | "ok" | "warn" | "error", msg: string) {
    useAppStore.getState().logLine(level, msg);
  }

  private requestedWorkers() {
    const s = this.settings();
    if (s.workerChoice === "auto") return 5;
    return clamp(Number(s.workerChoice), 1, 10);
  }

  /** يضبط بركة نوافذ نايس دير قبل البدء */
  async syncBridge() {
    const b = bridge();
    if (!b) return;
    const s = this.settings();
    await b.setCredentials({ username: s.niceDeerUser, password: s.niceDeerPass, maxWorkers: this.requestedWorkers() });
  }

  async start(patients: PatientRow[], opts: { fresh: boolean; scan?: boolean; images?: boolean }) {
    const doScan = opts.scan !== false;
    const doImages = opts.images !== false;
    const store = useAppStore.getState();
    const b = requireBridge();
    this.cancelled = false;
    this.paused = false;
    this.finished = false;
    this.failures = 0;
    this.doneSubs = 0;
    this.doneForms = 0;
    this.images = 0;
    this.recentFailures = [];
    this.startedAt = Date.now();
    this.workers = this.requestedWorkers();

    await this.syncBridge();

    if (opts.fresh) {
      store.clearFailed();
      store.clearSamples();
      store.clearOutreach();
      store.clearLog();
    }

    store.patchSession({
      state: doScan ? "scanning" : "running",
      phase: doScan ? "scan" : "images",
      startedAt: this.startedAt,
      endedAt: null,
      subsTotal: patients.length,
      subsDone: 0,
      formsTotal: 0,
      formsDone: 0,
      images: 0,
      failures: 0,
      workers: this.workers,
      autoWorkers: this.settings().workerChoice === "auto",
      decisions: [],
      lastTuneAt: Date.now(),
    });

    this.log("info", `بدء الجرد الحقيقي على نايس دير — ${patients.length} ساب، ${this.workers} نوافذ متوازية، الباير: ${this.settings().payerName || "غير محدد"}`);

    this.timer = setInterval(() => {
      useAppStore.getState().pushSample({
        at: Date.now(),
        done: this.doneForms,
        failed: this.failures,
        forms: this.images,
        workers: this.workers,
      });
      this.onTick();
    }, 1500);

    // ---------- المرحلة 1: الجرد ----------
    if (!doScan) {
      this.log("info", "تخطي الجرد — التشغيل على البيانات المحفوظة.");
    } else {
    await pool(patients, this.workers, async (patient) => {
      if (this.cancelled) return;
      while (this.paused && !this.cancelled) await sleep(300);
      if (this.cancelled) return;
      await this.scanOne(patient);
    });

    const cases = Object.values(useAppStore.getState().cases);
    this.log("ok", `انتهى الجرد — ${cases.length} استمارة من ${patients.length} ساب.`);
    }

    if (this.cancelled || !doImages) {
      this.finish();
      return;
    }

    // ---------- المرحلة 2: صور الروشتات ----------
    const queue = this.imageQueue();
    useAppStore.getState().patchSession({
      state: "running",
      phase: "images",
      formsTotal: queue.length,
      formsDone: 0,
    });

    if (!queue.length) {
      this.log("warn", "مفيش استمارات داخل مدة الصلاحية محتاجة صور.");
      this.finish();
      return;
    }

    this.log("info", `بدء جلب صور ${queue.length} روشتة…`);

    // كل ساب بيتعالج في نافذة واحدة؛ الاستمارات بتتاخد بالترتيب
    const bySab = new Map<string, CaseRecord[]>();
    for (const c of queue) {
      if (!bySab.has(c.sab)) bySab.set(c.sab, []);
      bySab.get(c.sab)!.push(c);
    }
    const groups = [...bySab.values()];

    await pool(groups, this.workers, async (group) => {
      for (const c of group) {
        if (this.cancelled) return;
        while (this.paused && !this.cancelled) await sleep(300);
        if (this.cancelled) return;
        await this.fetchImage(c);
        this.doneForms += 1;
        this.onTick();
        void b.setWorkers(this.workers);
      }
    });

    this.finish();
  }

  /** بحث ساب واحد وبناء حالاته */
  private async scanOne(patient: PatientRow) {
    const b = requireBridge();
    const s = this.settings();
    const store = useAppStore.getState();
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !this.cancelled; attempt++) {
      try {
        const res = await b.searchSub({ sab: patient.sab, payerId: s.payerId, payerName: s.payerName });
        if (!res.ok) throw new Error(bridgeError(res, "فشل البحث في نايس دير"));
        const data = res.data as NdSearchResult;
        const phone = (data.phone || patient.phone || "").trim();
        const effective: PatientRow = { ...patient, phone };

        if (data.empty || !data.forms.length) {
          store.logLine("warn", `الساب ${patient.sab}: ${data.note || "مفيش استمارات"}`);
          this.doneSubs += 1;
          return;
        }

        const cases = data.forms.map((f) => toCase(effective, f, s));
        for (const c of cases) store.upsertCase(c);

        const monthlyForms = data.forms
          .filter((f) => isMonthlyForm(f))
          .map((f) => ({ dateISO: f.dateISO, date: f.date, reference: f.reference }));
        const check = evaluateMonthly({
          sab: patient.sab,
          patientName: patient.name,
          phone,
          workplace: patient.workplace,
          monthlyForms,
          validityDays: s.validityDays,
        });
        store.upsertMonthly([check]);

        const validCount = cases.filter((c) => c.valid).length;
        store.logLine(
          "ok",
          `الساب ${patient.sab} (${patient.name}): ${data.forms.length} استمارة — ${validCount} داخل المدة، الشهري ${check.computed === "available" ? "متاح" : "غير متاح"}.`,
        );
        this.doneSubs += 1;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "خطأ غير معروف";
        await sleep(600 * attempt);
      }
    }

    this.failures += 1;
    this.recentFailures.push(Date.now());
    store.addFailed({
      id: uid("fail"),
      sab: patient.sab,
      patientName: patient.name,
      workplace: patient.workplace,
      step: "بحث",
      reference: "",
      reason: lastError || "فشل بعد ٣ محاولات",
      at: Date.now(),
    });
    store.logLine("error", `فشل جرد الساب ${patient.sab}: ${lastError}`);
  }

  private imageQueue(): CaseRecord[] {
    const s = this.settings();
    const cases = Object.values(useAppStore.getState().cases);
    return cases
      .filter((c) => (c.valid || s.includeInvalid) && c.rx.status !== "ready")
      .sort((a, b) => (a.formDateISO || "").localeCompare(b.formDateISO || ""));
  }

  private async fetchImage(c: CaseRecord) {
    const b = requireBridge();
    const s = this.settings();
    const store = useAppStore.getState();
    let lastError = "";

    store.setRxStatus(c.id, { status: "loading", attempts: 0, updatedAt: Date.now() });
    this.onTick();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !this.cancelled; attempt++) {
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
        this.images += 1;
        this.onTick();
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "خطأ غير معروف";
        store.setRxStatus(c.id, {
          status: "loading",
          attempts: attempt,
          reason: `محاولة ${attempt} فشلت: ${lastError}`,
          updatedAt: Date.now(),
        });
        await sleep(500 * attempt);
      }
    }

    this.failures += 1;
    this.recentFailures.push(Date.now());
    store.setRxStatus(c.id, { status: "failed", attempts: MAX_ATTEMPTS, reason: lastError, updatedAt: Date.now() });
    store.addFailed({
      id: uid("fail"),
      sab: c.sab,
      patientName: c.patientName,
      workplace: c.workplace,
      step: "صورة",
      reference: c.reference,
      reason: lastError || "فشل جلب الصورة بعد ٣ محاولات",
      at: Date.now(),
    });
    store.logLine("error", `صورة ${c.reference} (ساب ${c.sab}) فشلت: ${lastError}`);
  }

  /**
   * إعادة جلب صورة استمارة واحدة.
   * بتتنفذ على نسخة محرك مستقلة عشان ما توقفش جلسة شغّالة.
   */
  async retryImage(c: CaseRecord) {
    this.cancelled = false;
    this.finished = true;
    useAppStore.getState().logLine("info", `إعادة جلب صورة ${c.reference} — ساب ${c.sab}`);
    try {
      await this.fetchImage(c);
    } finally {
      if (this.timer) clearInterval(this.timer);
    }
  }

  /** إعادة الجرد لساب واحد (من القرار) */
  async rescanSab(patient: PatientRow) {
    this.cancelled = false;
    this.finished = true;
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
    if (this.finished) return;
    this.finished = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const store = useAppStore.getState();
    store.patchSession({
      state: "done",
      endedAt: Date.now(),
      subsDone: this.doneSubs,
      formsDone: this.doneForms,
      images: this.images,
      failures: this.failures,
    });
    this.log(
      "ok",
      `انتهى التشغيل — صور جاهزة: ${this.images}، متعثرات: ${this.failures}، سابات: ${this.doneSubs}/${store.session.subsTotal}.`,
    );
    store.setScreen("decision");
    this.onTick();
  }
}

/** إعادة حساب الصلاحية على تاريخ النهارده (الاستمارات بتقدم) */
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

/** أي استمارة حالتها ready بدون صورة = حالة غير متسقة، بنعلّمها لإعادة الجلب */
export function repairMissingImages() {
  const store = useAppStore.getState();
  let fixed = 0;
  for (const c of Object.values(store.cases)) {
    if (c.rx.status === "ready" && !c.rx.dataUrl) {
      store.setRxStatus(c.id, {
        status: "failed",
        attempts: c.rx.attempts,
        reason: "الصورة مش محمّلة في الذاكرة — اضغط إعادة الجلب",
        updatedAt: Date.now(),
      });
      fixed += 1;
    }
  }
  if (fixed) store.logLine("warn", `${fixed} روشتة محتاجة إعادة جلب صورة.`);
  return fixed;
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

/** ملخص الشهري لكل ساب بالترتيب */
export function monthlyList(monthly: Record<string, MonthlyCheck>) {
  return Object.values(monthly).sort((a, b) => a.patientName.localeCompare(b.patientName, "ar"));
}

export type { FailedRecord };
