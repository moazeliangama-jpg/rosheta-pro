import { useAppStore, mergeCase } from "./store";
import { providerFor, estimateWorkers } from "./provider";
import { evaluateMonthly, groupFormsBySab, isMonthlyType } from "./eligibility";
import type { CaseRecord, FailedRecord, FormRow, NiceDeerProvider, PatientRow } from "./types";
import { clamp, rand, sleep, uid } from "./utils";

const MAX_ATTEMPTS = 3;
const TUNE_INTERVAL = 5000;

/** مفتاح ثابت للاستمارة: الساب + رقم الاستمارة — مش ترتيبها في الشاشة ولا رقم النافذة */
export const caseKey = (sab: string, formId: string) => `${sab}::${formId}`;

export function buildCases(
  patients: PatientRow[],
  forms: FormRow[],
  cooldownDays: number,
): CaseRecord[] {
  const bySab = groupFormsBySab(patients, forms);
  const out: CaseRecord[] = [];

  for (const patient of patients) {
    const list = bySab.get(patient.sab) ?? [];
    const history: FormRow[] = [];
    for (const form of list) {
      const isMonthly = form.isMonthly || isMonthlyType(form.formType);
      const { eligible, reason } = evaluateMonthly({ isMonthly, date: form.date }, history, cooldownDays);
      out.push({
        id: caseKey(patient.sab, form.formId),
        sab: patient.sab,
        patientName: patient.name,
        phone: patient.phone,
        workplace: patient.workplace || useAppStore.getState().settings.workplace,
        buyer: patient.buyer,
        formId: form.formId,
        formType: form.formType,
        formLabel: form.formLabel,
        formDate: form.date,
        isMonthly,
        monthlyEligible: eligible,
        monthlyReason: reason,
        deleted: false,
        rx: { status: "pending", attempts: 0, updatedAt: Date.now() },
        drugs: null,
        monthly: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      history.push({ ...form, isMonthly });
    }
  }
  return out;
}

type Listener = () => void;

/**
 * محرك الجلسة: بيشتغل بعدد نوافذ متوازي، وكل استمارة:
 * بحث → جلب صورة (٣ محاولات) → إرجاع الاستمارة → حفظ الصورة في IndexedDB.
 *
 * أهم ضمانة: مفيش استمارة تفضل «معلّقة» — أي واحدة مالهاش صورة بتتحول
 * لحالة failed بسبب مكتوب، وبتظهر في شاشة القرار بزرار «إعادة المحاولة».
 */
export class SessionEngine {
  private cancelled = false;
  private paused = false;
  private queue: CaseRecord[] = [];
  private active = 0;
  private completed = 0;
  private failedCount = 0;
  private rxReady = 0;
  private startedAt = 0;
  private workers = 4;
  private readonly provider: NiceDeerProvider & { demoImageFor?: (c: CaseRecord) => string };
  private readonly onTick: Listener;
  private timer?: ReturnType<typeof setInterval>;
  private tuningBusy = false;
  private finished = false;
  private recentFailures: number[] = [];

  constructor(onTick: Listener = () => {}) {
    const settings = useAppStore.getState().settings;
    this.provider = providerFor(settings);
    this.onTick = onTick;
  }

  get isRunning() {
    return !this.cancelled;
  }

  private settings() {
    return useAppStore.getState().settings;
  }

  private log(level: "info" | "ok" | "warn" | "error", msg: string) {
    useAppStore.getState().logLine(level, msg);
  }

  async start(cases: CaseRecord[], opts: { fresh: boolean }) {
    const store = useAppStore.getState();
    const settings = this.settings();

    this.cancelled = false;
    this.paused = false;
    this.finished = false;
    this.completed = 0;
    this.failedCount = 0;
    this.rxReady = 0;
    this.startedAt = Date.now();
    this.recentFailures = [];

    const alreadyDecided = (c: CaseRecord) =>
      c.rx.status === "ready" && (c.drugs !== null || (c.isMonthly && c.monthly !== null));

    this.queue = opts.fresh ? cases.slice() : cases.filter((c) => !alreadyDecided(c));

    this.workers = estimateWorkers(settings.workerChoice, store.session.currentBest);

    if (opts.fresh) {
      store.clearFailed();
      store.clearSamples();
      store.clearOutreach();
    }

    store.patchSession({
      state: "running",
      startedAt: this.startedAt,
      endedAt: null,
      subsTotal: new Set(this.queue.map((c) => c.sab)).size,
      subsDone: 0,
      rxTotal: this.queue.length,
      rxReady: 0,
      failures: 0,
      workers: this.workers,
      autoWorkers: settings.workerChoice === "auto",
      fastMode: settings.fastMode,
      decisions: [],
      lastTuneAt: Date.now(),
    });

    this.log("info", `بدأت الجلسة — ${this.queue.length} استمارة لـ ${new Set(this.queue.map((c) => c.sab)).size} ساب، ${this.workers} نوافذ.`);

    this.timer = setInterval(() => {
      void this.emitSample();
      void this.tune();
      this.persistProgress();
    }, 900);

    await this.runPool();
  }

  private async runPool() {
    const worker = async () => {
      while (!this.cancelled) {
        if (this.paused) {
          await sleep(250);
          continue;
        }
        const item = this.queue.shift();
        if (!item) return;
        this.active += 1;
        try {
          await this.processCase(item);
        } catch (err) {
          this.fail(item, "صورة", err instanceof Error ? err.message : "خطأ غير متوقع");
        } finally {
          this.active -= 1;
        }
      }
    };

    // نبدأ بالعدد الحالي؛ التعديل التلقائي بيزود/يقلل نوافذ إضافية فوق دي
    const base = Array.from({ length: this.workers }, () => worker());
    await Promise.all(base);
    this.finish();
  }

  private async processCase(c: CaseRecord) {
    const store = useAppStore.getState();
    if (this.cancelled) return;

    store.setRxStatus(c.id, { status: "loading", attempts: 0, updatedAt: Date.now() });
    this.onTick();

    // 1) البحث
    let searchOk = false;
    let lastErr = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !this.cancelled; attempt++) {
      try {
        await this.provider.searchSub({
          sab: c.sab,
          buyer: c.buyer,
          workplace: c.workplace,
          fast: this.settings().fastMode,
        });
        searchOk = true;
        break;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : "فشل البحث";
        await sleep(rand(300, 700) * attempt);
      }
    }
    if (!searchOk) {
      this.fail(c, "بحث", lastErr || "فشل البحث بعد ٣ محاولات");
      return;
    }

    // 2) الصورة — ٣ محاولات
    let dataUrl: string | null = null;
    let deleted = false;
    lastErr = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !this.cancelled; attempt++) {
      try {
        const res = await this.provider.fetchFormImage({
          sab: c.sab,
          formId: c.formId,
          buyer: c.buyer,
          fast: this.settings().fastMode,
          preventDelete: this.settings().preventDelete,
        });
        deleted = res.deleted;
        if (res.dataUrl) {
          dataUrl = res.dataUrl;
        } else if (this.provider.demoImageFor) {
          dataUrl = this.provider.demoImageFor(useAppStore.getState().cases[c.id] ?? c);
        }
        if (dataUrl) break;
        lastErr = "لم تُرجع نافذة نايس دير صورة للاستمارة";
      } catch (err) {
        lastErr = err instanceof Error ? err.message : "فشل جلب الصورة";
        await sleep(rand(250, 600) * attempt);
      }
      if (attempt < MAX_ATTEMPTS) {
        store.setRxStatus(c.id, {
          status: "loading",
          attempts: attempt,
          reason: `محاولة ${attempt} فشلت: ${lastErr}`,
          updatedAt: Date.now(),
        });
        this.onTick();
      }
    }

    if (this.cancelled) return;

    if (!dataUrl) {
      this.fail(c, "صورة", lastErr || "فشل جلب صورة الروشتة بعد ٣ محاولات");
      return;
    }

    // 3) الحفظ — الصورة في IndexedDB والحالة في المتجر (بمفتاح ثابت)
    store.setRxStatus(c.id, {
      status: "ready",
      attempts: 0,
      updatedAt: Date.now(),
    });
    store.setImage(c.id, dataUrl);
    if (deleted) store.patchCase(c.id, { deleted: true });

    this.completed += 1;
    this.rxReady += 1;
    this.onTick();
  }

  private fail(c: CaseRecord, step: FailedRecord["step"], reason: string) {
    if (this.cancelled) return;
    const store = useAppStore.getState();
    store.setRxStatus(c.id, { status: "failed", attempts: MAX_ATTEMPTS, reason, updatedAt: Date.now() });
    store.addFailed({
      id: uid("fail"),
      sab: c.sab,
      patientName: c.patientName,
      workplace: c.workplace,
      step,
      form: c.formLabel,
      reason,
      at: Date.now(),
    });
    this.failedCount += 1;
    this.recentFailures.push(Date.now());
    this.onTick();
  }

  /** إعادة محاولة يدوية لاستمارة واحدة — نفس المسار بالظبط */
  async retryOne(c: CaseRecord) {
    this.cancelled = false;
    useAppStore.getState().logLine("info", `إعادة محاولة جلب صورة: ${c.patientName} — ${c.formLabel}`);
    await this.processCase(c);
    this.cancelled = true;
  }

  private async emitSample() {
    const store = useAppStore.getState();
    if (!this.startedAt) return;
    store.pushSample({
      at: Date.now(),
      done: this.completed,
      failed: this.failedCount,
      rx: this.rxReady,
      workers: this.workers,
    });
    this.onTick();
  }

  /** الضبط التلقائي: يزيد نافذة لو السرعة بتتحسن، ويرجع لو الأخطاء زادت */
  private async tune() {
    const settings = this.settings();
    if (settings.workerChoice !== "auto" || this.tuningBusy) return;
    const now = Date.now();
    const samples = useAppStore.getState().samples;
    if (now - (useAppStore.getState().session.lastTuneAt || 0) < TUNE_INTERVAL) return;
    if (samples.length < 3) return;
    this.tuningBusy = true;
    try {
      const window = samples.filter((s) => now - s.at <= 60000);
      if (window.length < 3) return;
      const first = window[0];
      const last = window[window.length - 1];
      const minutes = Math.max((last.at - first.at) / 60000, 0.15);
      const rate = (last.done - first.done) / minutes;
      const errRate = last.done + last.failed > 0 ? last.failed / (last.done + last.failed) : 0;
      const store = useAppStore.getState();
      const best = store.session.currentBest;

      if (best === null) {
        store.patchSession({ currentBest: this.workers, decisions: [`تثبيت البداية على ${this.workers} نوافذ`].concat(store.session.decisions).slice(0, 8), lastTuneAt: now });
        return;
      }

      if (errRate >= 0.2 && this.recentFailures.length >= 2 && this.workers > 2) {
        this.setWorkers(this.workers - 1);
        store.patchSession({
          decisions: [`تخفيض إلى ${this.workers} نوافذ — نسبة الأخطاء ${Math.round(errRate * 100)}%`].concat(store.session.decisions).slice(0, 8),
          lastTuneAt: now,
        });
      } else if (this.workers < 10 && rate > 0) {
        const prevRate = Number(sessionStorage.getItem("rp_rate") || 0);
        this.setWorkers(this.workers + 1);
        sessionStorage.setItem("rp_rate", String(rate));
        if (prevRate && rate < prevRate * 1.08) {
          this.setWorkers(this.workers - 1);
          store.patchSession({
            currentBest: this.workers,
            decisions: [`تثبيت على ${this.workers} نوافذ — الزيادة لم تسرّع`].concat(store.session.decisions).slice(0, 8),
            lastTuneAt: now,
          });
        } else {
          store.patchSession({
            currentBest: this.workers,
            decisions: [`زيادة إلى ${this.workers} نوافذ — ${rate.toFixed(1)} ساب/دقيقة`].concat(store.session.decisions).slice(0, 8),
            lastTuneAt: now,
          });
        }
      }
    } finally {
      this.tuningBusy = false;
    }
  }

  private setWorkers(n: number) {
    this.workers = clamp(n, 2, 10);
    useAppStore.getState().patchSession({ workers: this.workers });
  }

  private persistProgress() {
    const store = useAppStore.getState();
    const doneSubs = new Set(
      Object.values(store.cases)
        .filter((c) => c.rx.status === "ready" || c.rx.status === "failed")
        .map((c) => c.sab),
    ).size;
    store.patchSession({
      subsDone: doneSubs,
      failures: this.failedCount,
      rxReady: this.rxReady,
      fastMode: this.settings().fastMode,
    });
  }

  pause() {
    this.paused = true;
    useAppStore.getState().patchSession({ state: "paused" });
    this.log("warn", "تم إيقاف الجلسة مؤقتًا — الاستمارات الجارية هتكمل.");
  }

  resume() {
    this.paused = false;
    useAppStore.getState().patchSession({ state: "running" });
    this.log("info", "استكمال الجلسة.");
  }

  async stop() {
    this.cancelled = true;
    this.paused = false;
    if (this.timer) clearInterval(this.timer);
    // الاستمارات اللي لسه في الطابور بتتعلّم إن الجلسة اتوقفت — مش بتفضل «قيد الجلب» للأبد
    const store = useAppStore.getState();
    for (const c of this.queue.splice(0)) {
      store.setRxStatus(c.id, {
        status: "failed",
        attempts: 0,
        reason: "الجلسة اتوقفت قبل جلب الصورة — اضغط إعادة المحاولة",
        updatedAt: Date.now(),
      });
    }
    try {
      await this.provider.closeAll?.();
    } catch {
      /* تجاهل */
    }
    useAppStore.getState().patchSession({ state: "stopping" });
    this.log("warn", "إيقاف الجلسة…");
    this.finish();
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const store = useAppStore.getState();
    const endedAt = Date.now();
    store.patchSession({
      state: "done",
      endedAt,
      failures: this.failedCount,
      rxReady: this.rxReady,
    });
    this.log(
      "ok",
      `انتهت الجلسة — صورة جاهزة: ${this.rxReady}، متعثرة: ${this.failedCount}.`,
    );
    store.setScreen("decision");
    this.onTick();
  }
}

/** تنقية موانع الرسم: أي استمارة حالتها ready من غير صورة بتتحول لـ failed برسالة واضحة */
export function repairMissingImages() {
  const store = useAppStore.getState();
  let fixed = 0;
  for (const c of Object.values(store.cases)) {
    if (c.rx.status === "ready" && !c.rx.dataUrl) {
      store.setRxStatus(c.id, {
        status: "failed",
        attempts: c.rx.attempts,
        reason: "الصورة غير محمّلة في الذاكرة — أعد المحاولة",
        updatedAt: Date.now(),
      });
      fixed += 1;
    }
  }
  if (fixed) store.logLine("warn", `تم تعليم ${fixed} روشتة تحتاج إعادة جلب الصورة.`);
  return fixed;
}

/** إعادة وضع الحالات في شاشة القرار بنفس الترتيب الثابت */
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
  // أي حالة اتضافت بعد كده (مثل إعادة المحاولة) بتظهر كمان — مش بتختفي
  for (const [id, c] of Object.entries(cases)) {
    if (!seen.has(id)) list.push(c);
  }
  return list.map((c) => mergeCase(c, c));
}
