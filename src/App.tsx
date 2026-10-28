import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Activity, ClipboardList, FlaskConical, ListChecks, Settings2, ShieldOff } from "lucide-react";
import { useAppStore } from "./lib/store";
import { SessionEngine, refreshValidity } from "./lib/engine";
import { hasDesktopBridge, bridge } from "./lib/provider";
// ٥٨) الشاشات بتتحمّل وقت الحاجة — فتح البرنامج بيبقى أسرع
const SetupScreen = lazy(() => import("./screens/SetupScreen").then((m) => ({ default: m.SetupScreen })));
const RunScreen = lazy(() => import("./screens/RunScreen").then((m) => ({ default: m.RunScreen })));
const DecisionScreen = lazy(() => import("./screens/DecisionScreen").then((m) => ({ default: m.DecisionScreen })));
const ResultsScreen = lazy(() => import("./screens/ResultsScreen").then((m) => ({ default: m.ResultsScreen })));

function ScreenFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-white/40">
      <div className="flex items-center gap-2">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal-400/40 border-t-teal-400" />
        بيفتح الشاشة…
      </div>
    </div>
  );
}
import { Badge, Button, Card } from "./components/ui";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { exportApproved } from "./lib/excel";
import { isOnline } from "./lib/net";
import { runDailyBackup } from "./lib/backup";
import { WifiOff } from "lucide-react";
import { dateKey, cn } from "./lib/utils";
import type { CaseRecord } from "./lib/types";

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
  const setLoggedIn = useAppStore((s) => s.setLoggedIn);

  const [, setTick] = useState(0);
  const [engine, setEngine] = useState<SessionEngine | null>(null);
  // ٦٧) حالة الشبكة على الشاشة — التشغيل بيستنى رجوع النت بنفسه
  const [online, setOnline] = useState(() => isOnline());
  const autoRef = useRef(false);
  const bridges = hasDesktopBridge();

  const onTick = () => setTick((t) => t + 1);

  // استرجاع الصور + تنقية الحالات + تحديث الصلاحية حسب تاريخ اليوم
  useEffect(() => {
    void hydrateImages();
    // ٥٤) تنظيف صور أقدم من ٣٠ يوم مرة واحدة عند فتح البرنامج
    void import("./lib/imageStore").then((m) => m.pruneImages(30));
    const t = setTimeout(() => {
      refreshValidity();
    }, 800);
    const b = bridge();
    if (b) void b.status().then((res) => setLoggedIn(Boolean(res?.loggedIn)));
    return () => clearTimeout(t);
  }, [hydrateImages, setLoggedIn]);

  // ٦٧) متابعة حالة الشبكة
  useEffect(() => {
    const onUp = () => {
      setOnline(true);
      useAppStore.getState().logLine("ok", "النت رجع — التشغيل يقدر يكمّل.");
    };
    const onDown = () => {
      setOnline(false);
      useAppStore.getState().logLine("warn", "النت اتقطع — البرنامج بيستنى رجوع الاتصال، الشغل محفوظ.");
    };
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  // ٦٠) نسخة احتياطية تلقائية مرة واحدة في اليوم
  useEffect(() => {
    if (!bridges) return;
    const t = setTimeout(() => {
      void runDailyBackup()
        .then((res) => {
          if (res) useAppStore.getState().logLine("ok", `اتعملت نسخة احتياطية لشغل النهاردة (${Math.round(res.bytes / 1024)} ك.ب).`);
        })
        .catch(() => {
          /* النسخة الاحتياطية مش بتوقف البرنامج */
        });
    }, 4000);
    return () => clearTimeout(t);
  }, [bridges]);

  // التشغيل التلقائي اليومي + تصدير إكسل الموافقين
  useEffect(() => {
    if (autoRef.current) return;
    autoRef.current = true;
    const t = setInterval(() => {
      const s = useAppStore.getState();
      const now = new Date();
      const [sh, sm] = s.settings.sessionTime.split(":").map(Number);
      const [rh, rm] = s.settings.reportTime.split(":").map(Number);
      const today = dateKey(now);

      const scanDue = now.getHours() === sh && now.getMinutes() === sm;
      if (scanDue && s.settings.lastAutoSessionDate !== today && s.patients.length && s.session.state === "idle") {
        s.setSettings({ lastAutoSessionDate: today });
        s.logLine("info", "التشغيل التلقائي اليومي بدأ.");
        startEngine({ fresh: true, scan: true, images: true });
      }

      const reportDue = now.getHours() === rh && now.getMinutes() === rm;
      if (reportDue && s.settings.lastReportDate !== today && s.outreach.length) {
        const all = Object.values(s.cases);
        const count = exportApproved(all, s.outreach);
        s.setSettings({ lastReportDate: today });
        s.logLine("ok", `تم تصدير إكسل الموافقين اليومي (${count} صف).`);
      }
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const startEngine = (opts: { fresh: boolean; scan: boolean; images: boolean }) => {
    if (!bridges) {
      logLine("error", "الأتمتة الحقيقية تحتاج نسخة سطح المكتب — شغّل الـ EXE.");
      return;
    }
    const st = useAppStore.getState();
    const list = st.patients.filter((p) => !st.settings.workplace || (p.workplace || "بدون مكان عمل") === st.settings.workplace);
    if (!list.length) {
      logLine("error", "مفيش سابات في مكان العمل المختار.");
      return;
    }
    if (!st.settings.payerId) {
      logLine("error", "اختر الباير الأول.");
      return;
    }
    st.setScreen("run");
    const eng = new SessionEngine(onTick);
    setEngine(eng);
    void eng.start(list, opts).catch((err) => {
      logLine("error", `خطأ في المحرك: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const retryOne = async (c: CaseRecord) => {
    // محرك مستقل لكل إعادة جلب — ما بيوقفش الجلسة الشغّالة
    const eng = new SessionEngine(onTick);
    useAppStore.getState().setRxStatus(c.id, { status: "loading", attempts: 0, updatedAt: Date.now() });
    try {
      await eng.retryImage(c);
    } catch (err) {
      useAppStore.getState().setRxStatus(c.id, {
        status: "failed",
        attempts: 3,
        reason: err instanceof Error ? err.message : "فشل إعادة الجلب",
        updatedAt: Date.now(),
      });
    }
  };

  /** ١٢٣) زرار واحد: أعد كل الصور الفاشلة (بدون ما تلمس اللي نجح) */
  const retryAllFailed = async () => {
    if (!bridges) return;
    logLine("info", "إعادة محاولة كل الصور المتعثرة…");
    try {
      await new SessionEngine(onTick).retryAllFailed();
    } catch (err) {
      logLine("error", `فشل إعادة المحاولة: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const rescanSab = async (sab: string) => {
    const st = useAppStore.getState();
    const patient = st.patients.find((p) => p.sab === sab);
    if (!patient) return;
    await new SessionEngine(onTick).rescanSab(patient);
  };

  const badges: Record<string, number> = {
    decision: Object.values(cases).filter((c) => c.rx.status === "failed").length,
    results: outreach.filter((m) => m.status === "queued" || m.status === "failed").length,
  };

  if (!bridges) {
    return (
      <div className="min-h-screen bg-[#05090a] text-white" dir="rtl">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-teal-500/15 text-teal-300">
              <FlaskConical className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold">روشتة برو</h1>
              <p className="text-xs text-white/45">أتمتة نايس دير الحقيقية — نسخة سطح المكتب</p>
            </div>
          </div>

          <Card className="border-rose-500/30 bg-rose-950/20">
            <div className="flex items-start gap-3">
              <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
              <div className="space-y-2 text-sm">
                <div className="font-bold text-rose-200">البرنامج لازم يشتغل من نسخة سطح المكتب</div>
                <p className="text-xs leading-relaxed text-rose-100/70">
                  قراءة الجدولين، فتح نافذة الروشتة، التقاط صورتها، والضغط على Delete — كلها عمليات على نوافذ
                  نايس دير الحقيقية، والمتصفح مش بيسمح بيها. شغّل الـ EXE وكل حاجة هتشتغل فعليًا.
                </p>
                <pre className="overflow-auto rounded-lg bg-black/50 p-3 text-[11px] text-emerald-200" dir="ltr">
{`npm install
npm run build
npx electron .      # للتشغيل مباشرة
build-exe.bat       # لتوليد مثبّت ويندوز`}
                </pre>
              </div>
            </div>
          </Card>

          <div className="mt-4">
            <DiagnosticsPanel />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={settings.compactMode ? "min-h-screen bg-[#05090a] text-[13px] text-white" : "min-h-screen bg-[#05090a] text-white"}
      dir="rtl"
    >
      <div className="pointer-events-none fixed inset-0 opacity-60 [background:radial-gradient(900px_400px_at_80%_-10%,rgba(13,148,136,0.18),transparent),radial-gradient(700px_300px_at_10%_110%,rgba(16,185,129,0.12),transparent)]" />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05090a]/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-teal-500/15 text-teal-300">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-extrabold leading-tight">روشتة برو</div>
              <div className="text-[10px] text-white/40">تسجيل دخول · جرد · صور الروشتات · واتساب</div>
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
                    <span className="rounded-md bg-rose-500/80 px-1 text-[10px] tabular-nums text-white">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Badge tone="ok">سطح المكتب</Badge>
            {settings.payerName ? <Badge tone="info">{settings.payerName}</Badge> : <Badge tone="bad">الباير غير محدد</Badge>}
            {session.state === "scanning" || session.state === "running" ? <Badge tone="ok">تشغيل جارٍ</Badge> : null}
          </div>
        </div>
      </header>

      {/* ٦٧) شريط ثابت لما النت يقطع — بيقول إن الشغل محفوظ والبرنامج مستني */}
      {!online ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10">
          <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-2 text-xs text-amber-200">
            <WifiOff className="h-4 w-4 shrink-0" />
            النت واقف — التشغيل مستني رجوع الاتصال، وكل اللي اتعمل محفوظ. هيكمّل لوحده أول ما يرجع.
          </div>
        </div>
      ) : null}

      <main className={settings.compactMode ? "relative mx-auto max-w-[1200px] px-2 py-2" : "relative mx-auto max-w-[1500px] px-4 py-4"}>
        <Suspense fallback={<ScreenFallback />}>
        {screen === "setup" ? (
          <SetupScreen
            onScan={() => startEngine({ fresh: true, scan: true, images: false })}
            onImages={() => startEngine({ fresh: false, scan: false, images: true })}
          />
        ) : null}
        {screen === "run" ? (
          <RunScreen
            onPause={() => engine?.pause()}
            onResume={() => engine?.resume()}
            onStop={() => void engine?.stop()}
            onDecision={() => setScreen("decision")}
            onRetryFailed={() => void retryAllFailed()}
          />
        ) : null}
        {screen === "decision" ? <DecisionScreen onRetry={retryOne} onRescanSab={rescanSab} /> : null}
        {screen === "results" ? <ResultsScreen /> : null}
        </Suspense>
      </main>

      {session.state === "done" && screen !== "decision" ? (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 space-y-1.5">
          {/* ٨٢) ملخص نهاية الجلسة في سطرين */}
          <div className="rounded-xl border border-white/10 bg-[#0b1518]/95 px-4 py-2 text-center text-[11px] text-white/60 shadow-xl backdrop-blur">
            <div>
              {session.images} صورة جاهزة · {session.subsDone} ساب · {session.failures} متعثر ·{" "}
              {session.startedAt && session.endedAt
                ? `${Math.round((session.endedAt - session.startedAt) / 60000)} دقيقة`
                : ""}
            </div>
            {session.bottleneck ? <div className="text-white/40">{session.bottleneck}</div> : null}
          </div>
          <Button
            size="lg"
            onClick={() => setScreen("decision")}
            className="w-full rounded-full shadow-xl"
          >
            التشغيل انتهى — افتح شاشة القرار ({Object.values(cases).filter((c) => c.rx.status === "ready").length} صورة جاهزة)
          </Button>
        </div>
      ) : null}
    </div>
  );
}
