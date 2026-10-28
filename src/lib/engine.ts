import { useAppStore } from "./store";
import { evaluateMonthly, evaluateValidity, isMonthlyForm } from "./eligibility";
import { bridge, bridgeError, requireBridge } from "./provider";
import type { CaseRecord, FailedRecord, MonthlyCheck, NdForm, NdSearchResult, PatientRow } from "./types";
import { clamp, sleep, uid } from "./utils";
import { buildTasks, type Task } from "./tasks";

export { buildTasks };
export type { Task };

const MAX_ATTEMPTS = 3;
/** فاصل إعادة المحاولة — صغير عشان السرعة، البرنامج بيعيد بسرعة بدل ما يستنى */
const RETRY_BASE_MS = 120;

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
    if (s.workerChoice === "auto") return 8;
    return clamp(Number(s.workerChoice), 1, 16);
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
  }

  async start(patients: PatientRow[], opts: { fresh: boolean; scan?: boolean; images?: boolean }) {
    const store = useAppStore.getState();
    const b = requireBridge();
    const doScan = opts.scan !== false;
    const doImages = opts.images !== false;
    const s0 = this.settings();

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
    });

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

    await this.resolveDeletes();

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
    store.patchSession({
      subsDone: this.doneSubs,
      formsDone: this.doneForms,
      images: this.images,
      failures: this.failures,
      avgSearchMs: this.searchCount ? Math.round(this.searchMsTotal / this.searchCount) : 0,
      avgCaptureMs: this.captureCount ? Math.round(this.captureMsTotal / this.captureCount) : 0,
      formsPerMin: Math.round(rate * 10) / 10,
      etaMin: rate > 0 ? Math.max(0, Math.round(((store.session.formsTotal - this.doneForms) / rate) * 10) / 10) : null,
    });
    void this.pollDeletes();
    this.onTick();
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

  private async scanOne(patient: PatientRow): Promise<CaseRecord[]> {
    const b = requireBridge();
    const s = this.settings();
    const store = useAppStore.getState();
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !this.cancelled; attempt++) {
      const t0 = Date.now();
      try {
        const res = await b.searchSub({ sab: patient.sab, payerId: s.payerId, payerName: s.payerName });
        if (!res.ok) throw new Error(bridgeError(res, "فشل البحث في نايس دير"));
        const data = res.data as NdSearchResult;
        this.searchMsTotal += res.ms ?? Date.now() - t0;
        this.searchCount += 1;

        const phone = (data.phone || patient.phone || "").trim();
        const effective: PatientRow = { ...patient, phone };

        if (data.empty || !data.forms.length) {
          store.logLine("warn", `الساب ${patient.sab}: ${data.note || "مفيش استمارات"}`);
          this.doneSubs += 1;
          return [];
        }

        const cases = data.forms.map((f) => toCase(effective, f, s));
        for (const c of cases) store.upsertCase(c);

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
        this.doneSubs += 1;
        return cases;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "خطأ غير معروف";
        if (/غير موجود|مش موجود/.test(lastError)) break;
        await sleep(RETRY_BASE_MS * attempt);
      }
    }

    this.fail(lastError || "فشل بعد ٣ محاولات", "بحث", patient.sab, patient.name, patient.workplace, "");
    return [];
  }

  /**
   * خط إنتاج: لكل ساب — بحث واحد، وبعدها صور استماراته على نفس النافذة.
   * بيوفر بحث كامل لكل استمارة لأن نتايج الساب بتفضل محفوظة في النافذة.
   */
  private async pipelinePhase(patients: PatientRow[]) {
    const s = this.settings();
    this.log("info", `وضع مرعب ⚡: خطة مختلطة — كل ساب بيتجرد وبيتصور على نفس النافذة (${this.workers} نوافذ).`);

    await pool(patients, this.workers, async (patient) => {
      while (this.paused && !this.cancelled) await sleep(150);
      if (this.cancelled) return;

      const cases = await this.scanOne(patient);
      if (!cases.length || this.cancelled) return;

      const queue = cases
        .filter((c) => c.valid || s.includeInvalid)
        .filter((c) => useAppStore.getState().cases[c.id]?.rx.status !== "ready")
        .sort((a, b) => (a.formDateISO || "").localeCompare(b.formDateISO || ""));

      if (queue.length) useAppStore.getState().patchSession({ phase: "images" });

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
    const s = this.settings();
    return Object.values(useAppStore.getState().cases)
      .filter((c) => (c.valid || s.includeInvalid) && c.rx.status !== "ready")
      .sort((a, b) => (a.formDateISO || "").localeCompare(b.formDateISO || ""));
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

    store.setRxStatus(c.id, { status: "loading", attempts: 0, updatedAt: Date.now() });

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

        const timings = res.data.timings || {};
        if (typeof timings.searchMs === "number") {
          this.searchMsTotal += timings.searchMs;
          this.searchCount += 1;
        }
        if (typeof timings.captureMs === "number") {
          this.captureMsTotal += timings.captureMs;
          this.captureCount += 1;
        }

        this.keyToId.set(deleteKey(c.sab, c.reference), c.id);
        this.images += 1;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "خطأ غير معروف";
        // أخطاء مش هتتحسن بإعادة المحاولة
        if (/غير موجود|مش موجود|الساب والرقم المرجعي/.test(lastError)) break;
        await sleep(RETRY_BASE_MS * attempt);
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
    const store = useAppStore.getState();
    const elapsedMin = Math.max((Date.now() - this.startedAt) / 60000, 0.02);
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
    });
    this.log(
      "ok",
      `انتهى التشغيل — ${this.images} صورة، ${this.failures} متعثر، متوسط البحث ${store.session.avgSearchMs} مللي، متوسط الالتقاط ${store.session.avgCaptureMs} مللي.`,
    );
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
