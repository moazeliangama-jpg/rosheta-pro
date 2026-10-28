import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  CaseRecord,
  FailedRecord,
  FormRow,
  LogEntry,
  OutreachMessage,
  PatientRow,
  RxImage,
  SessionMeta,
  Settings,
  SpeedSample,
  Verdict,
} from "./types";
import { loadImage, saveImage } from "./imageStore";
import { dateKey, uid } from "./utils";

export type Screen = "setup" | "run" | "decision" | "results";

export const defaultSettings: Settings = {
  workplace: "",
  buyer: "",
  niceDeerUser: "",
  niceDeerPass: "",
  whatsappSender: "",
  whatsappConnected: false,
  receptionNumbers: "",
  sessionTime: "08:30",
  reportTime: "20:00",
  workerChoice: "auto",
  fastMode: true,
  preventDelete: false,
  demoMode: true,
  messageTemplate:
    "أهلاً {name}، روشتتك الشهرية جاهزة للصرف من مكان العمل. برجاء تأكيد الموافقة على الصرف.",
  sendDelaySec: 6,
  lastReportDate: "",
  lastAutoSessionDate: "",
  monthlyCooldownDays: 6,
};

const emptySession: SessionMeta = {
  state: "idle",
  startedAt: null,
  endedAt: null,
  subsTotal: 0,
  subsDone: 0,
  rxTotal: 0,
  rxReady: 0,
  failures: 0,
  workers: 4,
  autoWorkers: true,
  fastMode: true,
  currentBest: null,
  decisions: [],
  lastTuneAt: 0,
};

/** دمج صورتين لنفس الاستمارة بدون ما نضيّع صورة سليمة وصلت قبل كده */
export function mergeRx(prev: RxImage | undefined, next: RxImage): RxImage {
  if (!prev) return next;
  if (next.dataUrl) return next;
  if (next.status === "ready" && !next.dataUrl && prev.dataUrl) {
    return { ...next, dataUrl: prev.dataUrl };
  }
  if (prev.dataUrl && next.status !== "failed") {
    return { ...next, dataUrl: prev.dataUrl, status: "ready" };
  }
  return next;
}

export function mergeCase(prev: CaseRecord | undefined, next: CaseRecord): CaseRecord {
  if (!prev) return next;
  return {
    ...prev,
    ...next,
    rx: mergeRx(prev.rx, next.rx),
    // قرارات المستخدم لا تُمس من تحديثات المحرك
    drugs: next.drugs ?? prev.drugs,
    monthly: next.monthly ?? prev.monthly,
    updatedAt: Date.now(),
  };
}

interface AppState {
  settings: Settings;
  patients: PatientRow[];
  forms: FormRow[];
  cases: Record<string, CaseRecord>;
  caseOrder: string[];
  failed: FailedRecord[];
  log: LogEntry[];
  session: SessionMeta;
  samples: SpeedSample[];
  outreach: OutreachMessage[];
  screen: Screen;
  viewerId: string | null;
  imagesHydrated: boolean;

  setSettings: (patch: Partial<Settings>) => void;
  loadSheet: (patients: PatientRow[], forms: FormRow[]) => void;
  upsertCase: (record: CaseRecord) => void;
  patchCase: (id: string, patch: Partial<CaseRecord>) => void;
  setRxStatus: (id: string, rx: RxImage) => void;
  setImage: (id: string, dataUrl: string) => void;
  setVerdict: (id: string, kind: "drugs" | "monthly", value: Verdict) => void;
  resetDecisions: () => void;
  addFailed: (rec: FailedRecord) => void;
  clearFailed: () => void;
  logLine: (level: LogEntry["level"], msg: string) => void;
  patchSession: (patch: Partial<SessionMeta>) => void;
  pushSample: (s: SpeedSample) => void;
  clearSamples: () => void;
  addOutreach: (items: OutreachMessage[]) => void;
  patchOutreach: (id: string, patch: Partial<OutreachMessage>) => void;
  clearOutreach: () => void;
  setScreen: (s: Screen) => void;
  setViewer: (id: string | null) => void;
  resetAll: () => void;
  hydrateImages: () => Promise<void>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      patients: [],
      forms: [],
      cases: {},
      caseOrder: [],
      failed: [],
      log: [],
      session: emptySession,
      samples: [],
      outreach: [],
      screen: "setup",
      viewerId: null,
      imagesHydrated: false,

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      loadSheet: (patients, forms) =>
        set({
          patients,
          forms,
          cases: {},
          caseOrder: [],
          failed: [],
          outreach: [],
          samples: [],
          session: { ...emptySession },
        }),

      upsertCase: (record) =>
        set((s) => {
          const prev = s.cases[record.id];
          const merged = mergeCase(prev, record);
          return {
            cases: { ...s.cases, [record.id]: merged },
            caseOrder: prev ? s.caseOrder : [...s.caseOrder, record.id],
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

      setImage: (id, dataUrl) => {
        set((s) => {
          const prev = s.cases[id];
          if (!prev) return s;
          return {
            cases: {
              ...s.cases,
              [id]: { ...prev, rx: { status: "ready", dataUrl, attempts: prev.rx.attempts, updatedAt: Date.now() } },
            },
          };
        });
        void saveImage(id, dataUrl);
      },

      setVerdict: (id, kind, value) =>
        set((s) => {
          const prev = s.cases[id];
          if (!prev) return s;
          return { cases: { ...s.cases, [id]: { ...prev, [kind]: value, updatedAt: Date.now() } } };
        }),

      resetDecisions: () =>
        set((s) => {
          const cases: Record<string, CaseRecord> = {};
          for (const [id, c] of Object.entries(s.cases)) cases[id] = { ...c, drugs: null, monthly: null };
          return { cases };
        }),

      addFailed: (rec) => set((s) => ({ failed: [rec, ...s.failed].slice(0, 500) })),

      clearFailed: () => set({ failed: [] }),

      logLine: (level, msg) =>
        set((s) => ({
          log: [{ id: uid("log"), at: Date.now(), level, msg }, ...s.log].slice(0, 600),
        })),

      patchSession: (patch) => set((s) => ({ session: { ...s.session, ...patch } })),

      pushSample: (sample) => set((s) => ({ samples: [...s.samples, sample].slice(-240) })),

      clearSamples: () => set({ samples: [] }),

      addOutreach: (items) => set((s) => ({ outreach: [...s.outreach, ...items] })),

      patchOutreach: (id, patch) =>
        set((s) => ({ outreach: s.outreach.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),

      clearOutreach: () => set({ outreach: [] }),

      setScreen: (screen) => set({ screen }),

      setViewer: (viewerId) => set({ viewerId }),

      resetAll: () =>
        set({
          patients: [],
          forms: [],
          cases: {},
          caseOrder: [],
          failed: [],
          log: [],
          samples: [],
          outreach: [],
          session: { ...emptySession },
          screen: "setup",
          viewerId: null,
        }),

      /**
       * استرجاع الصور من IndexedDB بعد إعادة تشغيل البرنامج.
       * لو صورة ضاعت من المخزن، الحالة بتتحول لـ «failed» برسالة واضحة
       * بدل ما تفضل «ready» بمربع فاضي في شاشة القرار.
       */
      hydrateImages: async () => {
        if (get().imagesHydrated) return;
        const cases = get().cases;
        const ids = Object.keys(cases).filter((id) => cases[id].rx.status === "ready" && !cases[id].rx.dataUrl);
        if (!ids.length) {
          set({ imagesHydrated: true });
          return;
        }
        const next = { ...get().cases };
        let missing = 0;
        for (const id of ids) {
          const dataUrl = await loadImage(id);
          const c = next[id];
          if (!c) continue;
          if (dataUrl) next[id] = { ...c, rx: { ...c.rx, dataUrl } };
          else {
            missing += 1;
            next[id] = {
              ...c,
              rx: { ...c.rx, status: "failed", reason: "الصورة غير موجودة في التخزين المحلي — أعد جلبها" },
            };
          }
        }
        set({ cases: next, imagesHydrated: true });
        if (missing) {
          get().logLine("warn", `عدد ${missing} صورة روشتة لم توجد في التخزين المحلي. أعد جلبها من شاشة القرار.`);
        }
      },
    }),
    {
      name: "rosheta-pro-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        ...s,
        // الحالة دي مؤقتة للجلسة الحالية — لازم تتصفّر عند إعادة الفتح
        // وإلا الصور مش هتسترجع من IndexedDB ويبقى عندنا مربعات فاضية.
        imagesHydrated: false,
        // الصور مش بتتحفظ في localStorage — بتتحفظ في IndexedDB
        cases: Object.fromEntries(
          Object.entries(s.cases).map(([id, c]) => [id, { ...c, rx: { ...c.rx, dataUrl: undefined, status: c.rx.status === "ready" && !c.rx.dataUrl ? "ready" : c.rx.status } }]),
        ),
        log: s.log.slice(0, 200),
        samples: s.samples.slice(-120),
        viewerId: null,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // جلسة كانت شغّالة قبل قفل البرنامج: مفيش محرك حي، فبنعلّمها «منتهية»
        if (state.session.state === "running" || state.session.state === "paused" || state.session.state === "stopping") {
          state.patchSession({
            state: "done",
            endedAt: state.session.endedAt ?? Date.now(),
          });
          state.logLine("warn", "البرنامج اتقفل أثناء الجلسة — الجلسة السابقة اتقفلت. اضغط «استكمال» عشان تكمّل الباقي.");
        }
        // استرجاع الصور من IndexedDB بعد ما الحالة ترجع
        setTimeout(() => void state.hydrateImages(), 60);
      },
    },
  ),
);

export const isDemo = () => useAppStore.getState().settings.demoMode;
export { emptySession };
export const today = () => dateKey();
