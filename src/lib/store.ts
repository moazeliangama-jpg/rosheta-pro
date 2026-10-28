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
  Verdict,
} from "./types";
import { saveImage } from "./imageStore";
import { dateKey, uid } from "./utils";
import { defaultSettings } from "./settings";
import { putCachedImage } from "./imageCache";

export { defaultSettings };

export type Screen = "setup" | "run" | "decision" | "results";



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
  outreach: OutreachMessage[];
  screen: Screen;
  viewerId: string | null;
  imagesHydrated: boolean;
  niceDeerLoggedIn: boolean;

  setSettings: (patch: Partial<Settings>) => void;
  loadPatients: (patients: PatientRow[]) => void;
  resetRun: () => void;
  upsertCase: (record: CaseRecord) => void;
  patchCase: (id: string, patch: Partial<CaseRecord>) => void;
  setRxStatus: (id: string, rx: RxImage) => void;
  setImage: (id: string, dataUrl: string, method?: string) => void;
  setHasDrugs: (id: string, value: Verdict) => void;
  upsertMonthly: (checks: MonthlyCheck[]) => void;
  setMonthlyConfirmed: (sab: string, value: "available" | "unavailable" | null) => void;
  addFailed: (rec: FailedRecord) => void;
  clearFailed: () => void;
  logLine: (level: LogEntry["level"], msg: string) => void;
  clearLog: () => void;
  patchSession: (patch: Partial<SessionMeta>) => void;
  pushSample: (s: SpeedSample) => void;
  clearSamples: () => void;
  addOutreach: (items: OutreachMessage[]) => void;
  patchOutreach: (id: string, patch: Partial<OutreachMessage>) => void;
  clearOutreach: () => void;
  setScreen: (s: Screen) => void;
  setViewer: (id: string | null) => void;
  setLoggedIn: (v: boolean) => void;
  resetAll: () => void;
  hydrateImages: () => Promise<void>;
}

/**
 * كتابة localStorage مؤجلة: مع مئات الاستمارات، الكتابة مع كل تحديث كانت
 * بتعمل JSON.stringify لكل الحالة عشرات المرات في الثانية — ده كان بيبطّأ الواجهة.
 */
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
      }, 600);
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
      outreach: [],
      screen: "setup",
      viewerId: null,
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
          outreach: [],
          viewerId: null,
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
          const prev = s.cases[id];
          if (!prev) return s;
          return { cases: { ...s.cases, [id]: { ...prev, hasDrugs: value, updatedAt: Date.now() } } };
        }),

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

      addOutreach: (items) => set((s) => ({ outreach: [...s.outreach, ...items] })),

      patchOutreach: (id, patch) =>
        set((s) => ({ outreach: s.outreach.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),

      clearOutreach: () => set({ outreach: [] }),

      setScreen: (screen) => set({ screen }),

      setViewer: (viewerId) => set({ viewerId }),

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
