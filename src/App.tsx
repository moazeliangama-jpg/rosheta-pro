import { useEffect, useRef, useState } from "react";
import { Activity, ClipboardList, FlaskConical, ListChecks, Settings2 } from "lucide-react";
import { useAppStore } from "./lib/store";
import { SessionEngine, buildCases, repairMissingImages } from "./lib/engine";
import { SetupScreen } from "./screens/SetupScreen";
import { RunScreen } from "./screens/RunScreen";
import { DecisionScreen } from "./screens/DecisionScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { Badge } from "./components/ui";
import type { CaseRecord } from "./lib/types";
import { dateKey, cn } from "./lib/utils";

const TABS = [
  { key: "setup", label: "الإعداد", icon: Settings2 },
  { key: "run", label: "التشغيل", icon: Activity },
  { key: "decision", label: "القرار", icon: ListChecks },
  { key: "results", label: "النتيجة", icon: ClipboardList },
] as const;

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const setScreen = useAppStore((s) => s.setScreen);
  const settings = useAppStore((s) => s.settings);
  const cases = useAppStore((s) => s.cases);
  const session = useAppStore((s) => s.session);
  const outreach = useAppStore((s) => s.outreach);
  const logLine = useAppStore((s) => s.logLine);
  const hydrateImages = useAppStore((s) => s.hydrateImages);

  const [, setTick] = useState(0);
  const [engine, setEngine] = useState<SessionEngine | null>(null);
  const autoRef = useRef(false);

  // استرجاع الصور + تنقية الحالات المعلّقة عند فتح البرنامج
  useEffect(() => {
    void hydrateImages();
    const t = setTimeout(() => {
      const fixed = repairMissingImages();
      if (fixed) logLine("warn", `تم رصد ${fixed} روشتة بحالة غير متسقة وتم تعليمها لإعادة الجلب.`);
    }, 900);
    return () => clearTimeout(t);
  }, [hydrateImages, logLine]);

  // الجلسة التلقائية اليومية
  useEffect(() => {
    if (autoRef.current) return;
    autoRef.current = true;
    const t = setInterval(() => {
      const s = useAppStore.getState();
      const [h, m] = s.settings.sessionTime.split(":").map(Number);
      const now = new Date();
      const due = now.getHours() === h && now.getMinutes() === m;
      const alreadyToday = s.settings.lastAutoSessionDate === dateKey(now);
      const missedToday = s.settings.lastAutoSessionDate !== dateKey(now) && now.getHours() >= h;
      const hasWork = Object.values(s.cases).some((c) => c.rx.status !== "ready");
      if ((due || (missedToday && now.getMinutes() < 5)) && !alreadyToday && hasWork && s.session.state !== "running") {
        s.setSettings({ lastAutoSessionDate: dateKey(now) });
        s.setScreen("run");
        startEngine(true);
      }
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const onTick = () => setTick((t) => t + 1);

  const startEngine = (fresh: boolean) => {
    const st = useAppStore.getState();
    st.setScreen("run");
    let list = Object.values(st.cases);
    const sheetPatients = st.patients;
    const sheetForms = st.forms;
    if (!list.length && sheetPatients.length && sheetForms.length) {
      for (const c of buildCases(sheetPatients, sheetForms, st.settings.monthlyCooldownDays)) st.upsertCase(c);
      list = Object.values(useAppStore.getState().cases);
    }
    if (!list.length) {
      logLine("warn", "مفيش استمارات للتشغيل — ارفع Excel أو حمّل بيانات تجريبية.");
      return;
    }
    const sessionSettings = useAppStore.getState().settings;
    const merged = list.map((c) => ({ ...c, workplace: c.workplace || sessionSettings.workplace }));

    const eng = new SessionEngine(onTick);
    setEngine(eng);
    logLine("info", fresh ? "بدء تشغيل كامل جديد." : "استكمال الجلسة.");
    void eng.start(merged, { fresh }).catch((err) => {
      logLine("error", `خطأ في المحرك: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const retryOne = async (c: CaseRecord) => {
    // إعادة محاولة منفردة: تستخدم نفس مسار المحرك بالظبط عشان النتيجة تتحفظ بنفس المفتاح
    const eng = engine ?? new SessionEngine(onTick);
    if (!engine) setEngine(eng);
    useAppStore.getState().setRxStatus(c.id, { status: "loading", attempts: 0, updatedAt: Date.now() });
    try {
      await eng.retryOne(c);
      const after = useAppStore.getState().cases[c.id];
      if (after?.rx.status === "ready") logLine("ok", `تم إصلاح صورة ${c.patientName}.`);
    } catch (err) {
      useAppStore.getState().setRxStatus(c.id, {
        status: "failed",
        attempts: 3,
        reason: err instanceof Error ? err.message : "فشل إعادة المحاولة",
        updatedAt: Date.now(),
      });
    }
  };

  const badges: Record<string, number> = {
    decision: Object.values(cases).filter((c) => c.rx.status === "failed").length,
    results: outreach.filter((m) => m.status === "queued").length,
  };

  const decisionReady = Object.values(cases).some((c) => c.drugs !== null || c.monthly !== null);

  return (
    <div className="min-h-screen bg-[#05090a] text-white" dir="rtl">
      <div className="pointer-events-none fixed inset-0 opacity-60 [background:radial-gradient(900px_400px_at_80%_-10%,rgba(13,148,136,0.18),transparent),radial-gradient(700px_300px_at_10%_110%,rgba(16,185,129,0.12),transparent)]" />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05090a]/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-teal-500/15 text-teal-300">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-extrabold leading-tight">روشتة برو</div>
              <div className="text-[10px] text-white/40">نظام تحليل الاستمارات والمتابعة</div>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = screen === t.key;
              const count = badges[t.key] ?? 0;
              return (
                <button
                  key={t.key}
                  onClick={() => setScreen(t.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    active ? "bg-teal-500 text-[#04201c]" : "text-white/60 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  {count > 0 ? (
                    <span className="rounded-md bg-rose-500/80 px-1 text-[10px] text-white tabular-nums">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {settings.demoMode ? <Badge tone="info">وضع تجريبي</Badge> : null}
            {session.state === "running" ? <Badge tone="ok">جلسة شغّالة</Badge> : null}
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-[1400px] px-4 py-4">
        {screen === "setup" ? <SetupScreen onStart={() => startEngine(true)} /> : null}
        {screen === "run" ? (
          <RunScreen
            onPause={() => engine?.pause()}
            onResume={() => engine?.resume()}
            onStop={() => void engine?.stop()}
            onDecision={() => setScreen("decision")}
          />
        ) : null}
        {screen === "decision" ? <DecisionScreen onRetry={retryOne} /> : null}
        {screen === "results" ? <ResultsScreen onSend={() => setScreen("results")} /> : null}
      </main>

      {session.state === "done" && screen !== "decision" && decisionReady ? (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
          <button
            onClick={() => setScreen("decision")}
            className="rounded-full border border-teal-400/40 bg-teal-500/20 px-5 py-2.5 text-sm font-semibold text-teal-100 shadow-xl backdrop-blur hover:bg-teal-500/30"
          >
            الجلسة انتهت — افتح شاشة القرار ({Object.values(cases).filter((c) => c.rx.status === "ready").length} صورة جاهزة)
          </button>
        </div>
      ) : null}
    </div>
  );
}
