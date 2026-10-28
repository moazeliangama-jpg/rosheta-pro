import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  CaseRecord,
  FailedRecord,
  LogEntry,
  MonthlyCheck,
  OutreachMessage,
  PatientRow,
  RxImage,
  SessionMeta,
  Settings,
  SpeedSample,
  StepSample,
  Verdict,
  HourStat,
  Profile,
} from "./types";
import type { Bundle } from "./bundle";
import { applyDecision, applySabDecision, undoDecision, type DecisionEntry } from "./decisions";
import type { SabCacheEntry } from "./prepare";
import { saveImage } from "./imageStore";
import { dateKey, uid } from "./utils";
import { defaultSettings } from "./settings";
import { putCachedImage } from "./imageCache";

export { defaultSettings };

export type Screen = "setup" | "run" | "decision" | "results";

export type DecisionHistory = DecisionEntry;



export const emptySession: SessionMeta = {
  state: "idle",
  phase: "idle",
  startedAt: null,
  endedAt: null,
  subsTotal: 0,
  subsDone: 0,
  formsTotal: 0,
  formsDone: 0,
  images: 0,
  failures: 0,
  workers: 5,
  autoWorkers: true,
  turbo: true,
  avgSearchMs: 0,
  avgCaptureMs: 0,
  formsPerMin: 0,
  etaMin: null,
  deletePending: 0,
  decisions: [],
  lastTuneAt: 0,
  lastSab: "",
  bottleneck: "",
  autoTuned: 0,
  stuckWindows: 0,
};

/** يحافظ على صورة موجودة قوية لو التحديث الجديد جاي من غير صورة */
export function mergeRx(prev: RxImage | undefined, next: RxImage): RxImage {
  if (!prev) return next;
  if (next.dataUrl) return { ...next, status: "ready" };
  if (prev.dataUrl && (next.status === "loading" || next.status === "pending" || next.status === "ready")) {
    return { ...next, status: "ready", dataUrl: prev.dataUrl };
  }
  if (prev.dataUrl && next.status === "failed") {
    // فشل إعادة محاولة مش لازم يمسح صورة شغالة موجودة بالفعل
    return { ...prev, reason: next.reason, updatedAt: next.updatedAt };
  }
  return next;
}

export function mergeCase(prev: CaseRecord | undefined, next: CaseRecord): CaseRecord {
  if (!prev) return next;
  return {
    ...prev,
    ...next,
    rx: mergeRx(prev.rx, next.rx),
    hasDrugs: next.hasDrugs ?? prev.hasDrugs,
    updatedAt: Date.now(),
  };
}

interface AppState {
  settings: Settings;
  patients: PatientRow[];
  cases: Record<string, CaseRecord>;
  caseOrder: string[];
  monthly: Record<string, MonthlyCheck>;
  failed: FailedRecord[];
  log: LogEntry[];
  session: SessionMeta;
  samples: SpeedSample[];
  /** قياس كل خطوة — أساس تقرير السرعة وتحديد الاختناق */
  steps: StepSample[];
  /** كاش جرد اليوم: ساب اتجرد النهاردة مش بيتجرد تاني */
  sabCache: Record<string, SabCacheEntry>;
  /** أول يوم ظهرت فيه كل استمارة — أساس جلسة «الجديد فقط» */
  seenForms: Record<string, string>;
  /** متوسط سرعة السيرفر لكل ساعة (٠–٢٣) — بيتبني على أسبوع */
  hourly: Record<string, HourStat>;
  /** آخر القرارات (للتراجع) — الأحدث الأول */
  history: DecisionHistory[];
  /** مواقع عمل وإعدادات جاهزة للتبديل */
  profiles: Record<string, Profile>;
  outreach: OutreachMessage[];
  screen: Screen;
  viewerId: string | null;
  /** آخر روشتة اتفتحت — «استكمال من مكان الوقوف» في شاشة القرار */
  lastDecisionId: string | null;
  imagesHydrated: boolean;
  niceDeerLoggedIn: boolean;

  setSettings: (patch: Partial<Settings>) => void;
  loadPatients: (patients: PatientRow[]) => void;
  resetRun: () => void;
  upsertCase: (record: CaseRecord) => void;
  /** إدخال دفعة استمارات بتحديث واحد — أسرع بكتير من مئات التحديثات */
  upsertCases: (records: CaseRecord[]) => void;
  patchCase: (id: string, patch: Partial<CaseRecord>) => void;
  setRxStatus: (id: string, rx: RxImage) => void;
  setImage: (id: string, dataUrl: string, method?: string) => void;
  setHasDrugs: (id: string, value: Verdict) => void;
  /** ١٠٥) قرار جماعي لكل استمارات الساب — بيرجع عدد الاستمارات المتأثرة */
  setSabDecision: (sab: string, value: Verdict) => number;
  /** ١٠٦) تراجع عن آخر قرار */
  undoLastDecision: () => DecisionHistory | null;
  clearHistory: () => void;
  /** ١٠٨) تدوير صورة الاستمارة */
  setRotation: (id: string, deg: number) => void;
  markSeen: (ids: string[], day: string) => void;
  addHourSample: (hour: number, ms: number) => void;
  saveProfile: (name: string) => void;
  applyProfile: (name: string) => boolean;
  deleteProfile: (name: string) => void;
  importBundle: (bundle: Bundle) => void;
  upsertMonthly: (checks: MonthlyCheck[]) => void;
  setMonthlyConfirmed: (sab: string, value: "available" | "unavailable" | null) => void;
  addFailed: (rec: FailedRecord) => void;
  clearFailed: () => void;
  logLine: (level: LogEntry["level"], msg: string) => void;
  clearLog: () => void;
  patchSession: (patch: Partial<SessionMeta>) => void;
  pushSample: (s: SpeedSample) => void;
  clearSamples: () => void;
  pushSteps: (items: StepSample[]) => void;
  clearSteps: () => void;
  setSabCache: (sab: string, entry: SabCacheEntry) => void;
  clearSabCache: (day?: string) => void;
  addOutreach: (items: OutreachMessage[]) => void;
  patchOutreach: (id: string, patch: Partial<OutreachMessage>) => void;
  clearOutreach: () => void;
  setScreen: (s: Screen) => void;
  setViewer: (id: string | null) => void;
  setLastDecision: (id: string | null) => void;
  setLoggedIn: (v: boolean) => void;
  resetAll: () => void;
  hydrateImages: () => Promise<void>;
}

/**
 * كتابة localStorage مؤجلة: مع مئات الاستمارات، الكتابة مع كل تحديث كانت
 * بتعمل JSON.stringify لكل الحالة عشرات المرات في الثانية — ده كان بيبطّأ الواجهة.
 */
let saveDelayMs = 600;

/** أثناء التشغيل بنأجل الحفظ أكتر (كتابة كل ٣ ثواني) عشان الشغل ما يتعطلش */
export function setSaveDelay(ms: number) {
  saveDelayMs = Math.max(200, Math.min(10000, ms));
}

function debouncedStorage() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: [string, string] | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!last) return;
    try {
      localStorage.setItem(last[0], last[1]);
    } catch (err) {
      console.warn("تعذر حفظ الحالة محليًا", err);
    }
    last = null;
  };

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", flush);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  return {
    getItem: (key: string) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key: string, value: string) => {
      last = [key, value];
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, saveDelayMs);
    },
    removeItem: (key: string) => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* تجاهل */
      }
    },
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      patients: [],
      cases: {},
      caseOrder: [],
      monthly: {},
      failed: [],
      log: [],
      session: emptySession,
      samples: [],
      steps: [],
      sabCache: {},
      seenForms: {},
      hourly: {},
      history: [],
      profiles: {},
      outreach: [],
      screen: "setup",
      viewerId: null,
      lastDecisionId: null,
      imagesHydrated: false,
      niceDeerLoggedIn: false,

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      loadPatients: (patients) => set({ patients }),

      resetRun: () =>
        set({
          cases: {},
          caseOrder: [],
          monthly: {},
          failed: [],
          samples: [],
          steps: [],
          outreach: [],
          viewerId: null,
          history: [],
          session: { ...emptySession },
        }),

      upsertCase: (record) =>
        set((s) => {
          const prev = s.cases[record.id];
          return {
            cases: { ...s.cases, [record.id]: mergeCase(prev, record) },
            caseOrder: prev || s.caseOrder.includes(record.id) ? s.caseOrder : [...s.caseOrder, record.id],
          };
        }),

      /**
       * دفعة واحدة: كل استمارات ساب بتتضاف بتحديث واحد للمخزن.
       * قبل كده كل استمارة كانت بتنسخ خريطة الحالات كلها — مع ٣٠ استمارة
       * في الساب ده كان ٣٠ نسخة كاملة من كل الحالات.
       */
      upsertCases: (records) =>
        set((s) => {
          if (!records.length) return s;
          const cases = { ...s.cases };
          let caseOrder = s.caseOrder;
          const added: string[] = [];
          for (const record of records) {
            const prev = cases[record.id];
            cases[record.id] = mergeCase(prev, record);
            if (!prev && !caseOrder.includes(record.id)) added.push(record.id);
          }
          if (added.length) caseOrder = [...caseOrder, ...added];
          return { cases, caseOrder };
        }),

      patchCase: (id, patch) =>
        set((s) => {
          const prev = s.cases[id];
          if (!prev) return s;
          return { cases: { ...s.cases, [id]: mergeCase(prev, { ...prev, ...patch }) } };
        }),

      setRxStatus: (id, rx) =>
        set((s) => {
          const prev = s.cases[id];
          if (!prev) return s;
          return { cases: { ...s.cases, [id]: { ...prev, rx: mergeRx(prev.rx, rx), updatedAt: Date.now() } } };
        }),

      /**
       * بتسجل إن الصورة جاهزة. الصورة نفسها بتتحفظ في IndexedDB وبتتقرأ عند العرض
       * — مش بنحتفظ بنسخة منها في حالة React عشان الذاكرة والحفظ يفضلوا سريعين.
       */
      setImage: (id, dataUrl, method) => {
        putCachedImage(id, dataUrl);
        void saveImage(id, dataUrl);
        set((s) => {
          const prev = s.cases[id];
          if (!prev) return s;
          return {
            cases: {
              ...s.cases,
              [id]: {
                ...prev,
                rx: { status: "ready", method, attempts: prev.rx.attempts, updatedAt: Date.now() },
              },
            },
          };
        });
      },

      setHasDrugs: (id, value) =>
        set((s) => {
          // ١٠٦) بنحفظ القرار القديم عشان نقدر نتراجع
          const res = applyDecision(s.cases, id, value);
          if (!res.entry) return s;
          return { cases: res.cases, history: [res.entry, ...s.history].slice(0, 60) };
        }),

      /** ١٠٥) قرار واحد لكل استمارات الساب — القرار في الصرف بيبقى للساب كله */
      setSabDecision: (sab, value) => {
        const res = applySabDecision(get().cases, sab, value);
        if (!res.entries.length) return 0;
        set({ cases: res.cases, history: [...res.entries, ...get().history].slice(0, 60) });
        return res.entries.length;
      },

      undoLastDecision: () => {
        const s = get();
        const last = s.history[0];
        if (!last) return null;
        set({ history: s.history.slice(1), cases: undoDecision(s.cases, last) });
        return last;
      },

      clearHistory: () => set({ history: [] }),

      setRotation: (id, deg) =>
        set((s) => {
          const prev = s.cases[id];
          if (!prev) return s;
          const rotation = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
          return { cases: { ...s.cases, [id]: { ...prev, rotation } } };
        }),

      markSeen: (ids, day) =>
        set((s) => {
          const seenForms = { ...s.seenForms };
          let changed = false;
          for (const id of ids) {
            if (!seenForms[id]) {
              seenForms[id] = day;
              changed = true;
            }
          }
          return changed ? { seenForms } : s;
        }),

      addHourSample: (hour, ms) =>
        set((s) => {
          const key = String(((hour % 24) + 24) % 24);
          const prev = s.hourly[key] ?? { count: 0, totalMs: 0 };
          if (!Number.isFinite(ms) || ms <= 0) return s;
          return { hourly: { ...s.hourly, [key]: { count: prev.count + 1, totalMs: prev.totalMs + Math.round(ms) } } };
        }),

      saveProfile: (name) =>
        set((s) => {
          const clean = name.trim();
          if (!clean) return s;
          return {
            profiles: {
              ...s.profiles,
              [clean]: {
                name: clean,
                workplace: s.settings.workplace,
                payerId: s.settings.payerId,
                payerName: s.settings.payerName,
                validityDays: s.settings.validityDays,
                workerChoice: s.settings.workerChoice,
                turboMode: s.settings.turboMode,
                messageDrugs: s.settings.messageDrugs,
                messageMonthly: s.settings.messageMonthly,
              },
            },
          };
        }),

      applyProfile: (name) => {
        const s = get();
        const p = s.profiles[name];
        if (!p) return false;
        s.setSettings({
          workplace: p.workplace,
          payerId: p.payerId,
          payerName: p.payerName,
          validityDays: p.validityDays,
          workerChoice: p.workerChoice,
          turboMode: p.turboMode,
          messageDrugs: p.messageDrugs,
          messageMonthly: p.messageMonthly,
        });
        return true;
      },

      deleteProfile: (name) =>
        set((s) => {
          const profiles = { ...s.profiles };
          delete profiles[name];
          return { profiles };
        }),

      importBundle: (bundle) => {
        const s = get();
        const cases: Record<string, CaseRecord> = {};
        const caseOrder: string[] = [];
        for (const c of bundle.cases) {
          cases[c.id] = c;
          caseOrder.push(c.id);
        }
        const monthly: Record<string, MonthlyCheck> = {};
        for (const m of bundle.monthly ?? []) monthly[m.sab] = m;
        set({
          settings: { ...s.settings, ...(bundle.settings ?? {}), niceDeerPass: s.settings.niceDeerPass },
          patients: bundle.patients ?? s.patients,
          cases,
          caseOrder,
          monthly,
          outreach: bundle.outreach ?? s.outreach,
          seenForms: bundle.seenForms ?? s.seenForms,
          hourly: bundle.hourly ?? s.hourly,
          history: [],
        });
      },

      upsertMonthly: (checks) =>
        set((s) => {
          const next = { ...s.monthly };
          for (const c of checks) {
            const prev = next[c.sab];
            next[c.sab] = prev ? { ...c, confirmed: prev.confirmed } : c;
          }
          return { monthly: next };
        }),

      setMonthlyConfirmed: (sab, value) =>
        set((s) => {
          const prev = s.monthly[sab];
          if (!prev) return s;
          return { monthly: { ...s.monthly, [sab]: { ...prev, confirmed: value, updatedAt: Date.now() } } };
        }),

      addFailed: (rec) => set((s) => ({ failed: [rec, ...s.failed].slice(0, 1000) })),

      clearFailed: () => set({ failed: [] }),

      logLine: (level, msg) =>
        set((s) => ({ log: [{ id: uid("log"), at: Date.now(), level, msg }, ...s.log].slice(0, 800) })),

      clearLog: () => set({ log: [] }),

      patchSession: (patch) => set((s) => ({ session: { ...s.session, ...patch } })),

      pushSample: (sample) => set((s) => ({ samples: [...s.samples, sample].slice(-300) })),

      clearSamples: () => set({ samples: [] }),

      pushSteps: (items) =>
        set((s) => (items.length ? { steps: [...s.steps, ...items].slice(-2000) } : s)),

      clearSteps: () => set({ steps: [] }),

      setSabCache: (sab, entry) => set((s) => ({ sabCache: { ...s.sabCache, [sab]: entry } })),

      clearSabCache: (day) =>
        set((s) => {
          if (!day) return { sabCache: {} };
          const next: Record<string, SabCacheEntry> = {};
          for (const [sab, entry] of Object.entries(s.sabCache)) if (entry.day === day) next[sab] = entry;
          return { sabCache: next };
        }),

      addOutreach: (items) => set((s) => ({ outreach: [...s.outreach, ...items] })),

      patchOutreach: (id, patch) =>
        set((s) => ({ outreach: s.outreach.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),

      clearOutreach: () => set({ outreach: [] }),

      setScreen: (screen) => set({ screen }),

      setViewer: (viewerId) => set(viewerId ? { viewerId, lastDecisionId: viewerId } : { viewerId }),

      setLastDecision: (lastDecisionId) => set({ lastDecisionId }),

      setLoggedIn: (niceDeerLoggedIn) => set({ niceDeerLoggedIn }),

      resetAll: () =>
        set({
          patients: [],
          cases: {},
          caseOrder: [],
          monthly: {},
          failed: [],
          log: [],
          samples: [],
          outreach: [],
          session: { ...emptySession },
          screen: "setup",
          viewerId: null,
          lastDecisionId: null,
          steps: [],
          sabCache: {},
          seenForms: {},
          hourly: {},
          history: [],
          profiles: {},
          niceDeerLoggedIn: false,
        }),

      /**
       * الصور بتتقرأ من IndexedDB وقت العرض (lazy) — مش بنحمّل كل الصور في الذاكرة
       * عند فتح البرنامج. الدالة للتوافق وبس بتعلّم الجاهزية.
       */
      hydrateImages: async () => {
        if (get().imagesHydrated) return;
        set({ imagesHydrated: true });
      },
    }),
    {
      name: "rosheta-pro-v2",
      storage: createJSONStorage(debouncedStorage),
      partialize: (s) => ({
        ...s,
        imagesHydrated: false,
        cases: Object.fromEntries(
          Object.entries(s.cases).map(([id, c]) => [id, { ...c, rx: { ...c.rx, dataUrl: undefined } }]),
        ),
        log: s.log.slice(0, 250),
        samples: s.samples.slice(-150),
        steps: s.steps.slice(-1200),
        viewerId: null,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.session.state === "running" || state.session.state === "paused" || state.session.state === "scanning") {
          state.patchSession({ state: "done", endedAt: state.session.endedAt ?? Date.now() });
          state.logLine("warn", "البرنامج اتقفل أثناء التشغيل — الجلسة السابقة اتقفلت. اضغط «استكمال» لتكملة الباقي.");
        }
        setTimeout(() => void state.hydrateImages(), 60);
      },
    },
  ),
);

export const todayKey = () => dateKey();
