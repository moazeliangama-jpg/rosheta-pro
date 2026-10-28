import { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  Activity,
  ClipboardList,
  Download,
  FlaskConical,
  ImageDown,
  Keyboard,
  ListChecks,
  MessageCircle,
  RotateCcw,
  Search,
  Settings2,
  ShieldOff,
  Sparkles,
} from "lucide-react";
import { useAppStore } from "./lib/store";
import { filterByWorkplaces, selectedWorkplaces } from "./lib/eligibility";
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
import { NextStepBar } from "./components/NextStepBar";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { HelpOverlay } from "./components/HelpOverlay";
import { Toaster } from "./components/Toaster";
import { SaveStatus } from "./components/SaveStatus";
import { OnboardingTour } from "./components/OnboardingTour";
import { useUx } from "./lib/useUx";
import type { NextAction } from "./lib/ux";
import { toast } from "./lib/toast";
import { exportApproved } from "./lib/excel";
import { reportSave } from "./lib/saveFeedback";
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
  // لوحة الأوامر والمساعدة وجولة التعريف — كلها أوفرليز خفيفة
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(() => !useAppStore.getState().settings.onboarded);
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

  // أحداث مباشرة من نوافذ نايس دير — المستخدم بيشوف الخطوة اللي بتتنفذ دلوقتي
  useEffect(() => {
    const b = bridge();
    if (!b?.onStep) return;
    const off = b.onStep((line) => {
      if (!line || !line.message) return;
      useAppStore.getState().pushLive({
        at: Number(line.at) || Date.now(),
        message: String(line.message).slice(0, 300),
        ref: line.ref ? String(line.ref).slice(0, 60) : undefined,
      });
    });
    return () => {
      try {
        off();
      } catch {
        /* تجاهل */
      }
    };
  }, []);

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
        void exportApproved(all, s.outreach).then((res) => {
          if (!res.ok) {
            s.logLine("error", `فشل تصدير إكسل الموافقين اليومي: ${res.error ?? "سبب غير معروف"}`);
            return;
          }
          s.setSettings({ lastReportDate: today });
          s.logLine("ok", `اتحفظ إكسل الموافقين اليومي (${res.count} صف) في: ${res.file ?? res.name}`);
        });
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
    // الأماكن المختارة هي اللي بتتراجع — أي ساب برّاها مش بيدخل التشغيل خالص
    const chosen = selectedWorkplaces(st.settings);
    const list = filterByWorkplaces(st.patients, chosen);
    if (!list.length) {
      logLine("error", chosen.length ? `مفيش سابات في الأماكن المختارة: ${chosen.join(" · ")}` : "مفيش سابات في الملف.");
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

  // ── تجربة الاستخدام: خطوة واحدة واضحة بدل ما المستخدم يدور إيه اللي بعده ──
  const ux = useUx();
  const { action, stages } = ux;

  /** تنفيذ «الخطوة الجاية»: تنقّل لو ناقص تجهيز، أو تنفيذ حقيقي لو الشغل جاهز */
  const runNext = (target: NextAction = action) => {
    switch (target.id) {
      case "upload":
      case "payer":
      case "login":
        setScreen("setup");
        // الإعداد هو المكان الوحيد اللي فيه الحل — بنقول للمستخدم السطر بالظبط
        toast.info(target.hint);
        break;
      case "scan":
        if (!bridges) {
          toast.error("التشغيل الحقيقي محتاج نسخة سطح المكتب.");
          break;
        }
        startEngine({ fresh: true, scan: true, images: false });
        break;
      case "images":
        if (!bridges) {
          toast.error("التشغيل الحقيقي محتاج نسخة سطح المكتب.");
          break;
        }
        startEngine({ fresh: false, scan: false, images: true });
        break;
      case "retry":
        void retryAllFailed();
        break;
      case "decide":
        setScreen("decision");
        break;
      case "send":
      case "finished":
        setScreen("results");
        break;
    }
  };
  // الاختصارات بتقرأ أحدث نسخة من غير ما تسجّل نفسها كل رندر
  const runRef = useRef(runNext);
  runRef.current = runNext;

  // ── نهاية الجلسة: ملخص فوري + إعادة المحاولة من نفس الإشعار ──
  const doneRef = useRef<number | null>(null);
  useEffect(() => {
    if (session.state !== "done") return;
    const stamp = session.endedAt ?? 0;
    if (doneRef.current === stamp) return;
    doneRef.current = stamp;
    if (!session.images && !session.failures) return;
    if (session.failures > 0) {
      toast.warn(`${session.failures} صورة لسه متعثرة بعد المحاولة الأخيرة — ${session.images} صورة جاهزة.`, {
        ttl: 9000,
        action: { label: "أعد المحاولة", run: () => void retryAllFailed() },
      });
    } else {
      toast.ok(`خلصت — ${session.images} صورة جاهزة. شاشة القرار مستنياك.`, {
        ttl: 8000,
        action: { label: "افتح القرار", run: () => setScreen("decision") },
      });
    }
  }, [session.state, session.endedAt, session.failures, session.images, setScreen]);

  // ── اختصارات عامة: كل حاجة من الكيبورد ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      if (typing) return;
      // Ctrl+Enter = نفّذ «الخطوة الجاية» من أي شاشة
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runRef.current();
        return;
      }
      if (e.altKey && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        setScreen(TABS[Number(e.key) - 1].key);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setScreen]);

  /** أوامر لوحة Ctrl+K — كلها أفعال حقيقية على البرنامج نفسه */
  const commands: Command[] = [
    ...TABS.map((t, i) => ({
      id: `nav-${t.key}`,
      label: `اذهب إلى ${t.label}`,
      hint: `Alt + ${i + 1}`,
      keywords: `شاشة ${t.label} nav ${t.key}`,
      icon: t.icon,
      group: "التنقل",
      run: () => setScreen(t.key),
    })),
    {
      id: "act-scan",
      label: "ابدأ الجرد",
      hint: "قراءة استمارات السابات من نايس دير",
      keywords: "scan جرد استمارات بدء",
      icon: Search,
      group: "الشغل",
      disabled: !ux.ready,
      run: () => startEngine({ fresh: true, scan: true, images: false }),
    },
    {
      id: "act-images",
      label: "جلب صور الروشتات",
      hint: "المرحلة اللي بعد الجرد",
      keywords: "images صور روشتات",
      icon: ImageDown,
      group: "الشغل",
      disabled: !bridges || session.state === "running" || session.state === "scanning",
      run: () => startEngine({ fresh: false, scan: false, images: true }),
    },
    {
      id: "act-retry",
      label: "إعادة كل الصور المتعثرة",
      hint: "من غير ما يلمس اللي نجح",
      keywords: "retry اعادة متعثرة فشل",
      icon: RotateCcw,
      group: "الشغل",
      disabled: !bridges,
      run: () => void retryAllFailed(),
    },
    {
      id: "act-export",
      label: "تصدير إكسل الموافقين",
      hint: "كل القرارات + ردود واتساب",
      keywords: "export excel تصدير اكسل تقرير",
      icon: Download,
      group: "النتايج",
      run: () => {
        const st = useAppStore.getState();
        void exportApproved(Object.values(st.cases), st.outreach).then((res) => {
          reportSave(res, "تصدير إكسل الموافقين");
        });
      },
    },
    {
      id: "act-wa",
      label: "شاشة الرسائل وواتساب",
      keywords: "whatsapp واتساب رسائل ارسال",
      icon: MessageCircle,
      group: "النتايج",
      run: () => setScreen("results"),
    },
    {
      id: "help-keys",
      label: "الاختصارات والمساعدة",
      hint: "؟",
      keywords: "help shortcuts اختصارات مساعدة",
      icon: Keyboard,
      group: "مساعدة",
      run: () => setHelpOpen(true),
    },
    {
      id: "help-tour",
      label: "إعادة جولة التعريف",
      keywords: "tour onboard تعريف جولة شرح",
      icon: Sparkles,
      group: "مساعدة",
      run: () => setTourOpen(true),
    },
  ];

  const finishTour = () => {
    setTourOpen(false);
    useAppStore.getState().setSettings({ onboarded: true, tourSeen: true });
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
      className={cn(
        "min-h-screen bg-[#05090a] text-white",
        settings.compactMode && "text-[13px]",
        settings.reducedMotion && "reduce-motion",
      )}
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
            <SaveStatus className="hidden sm:inline-flex" />
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

      <main className={settings.compactMode ? "relative mx-auto max-w-[1200px] px-2 pb-24 pt-2" : "relative mx-auto max-w-[1500px] px-4 pb-24 pt-4"}>
        <Suspense fallback={<ScreenFallback />}>
        {screen === "setup" ? (
          <SetupScreen
            onScan={() => startEngine({ fresh: true, scan: true, images: false })}
            onImages={() => startEngine({ fresh: false, scan: false, images: true })}
            onAdvance={() => runNext()}
          />
        ) : null}
        {screen === "run" ? (
          <RunScreen
            onPause={() => engine?.pause()}
            onResume={() => engine?.resume()}
            onStop={() => void engine?.stop()}
            onDecision={() => setScreen("decision")}
            onRetryFailed={() => void retryAllFailed()}
            onSetup={() => setScreen("setup")}
          />
        ) : null}
        {screen === "decision" ? <DecisionScreen onRetry={retryOne} onRescanSab={rescanSab} /> : null}
        {screen === "results" ? <ResultsScreen /> : null}
        </Suspense>
      </main>

      {/* الشريط الثابت: الخطوة الجاية + المراحل — أوفر لايه فوق كل الشاشات */}
      <NextStepBar action={action} stages={stages} onRun={() => runNext()} onHelp={() => setHelpOpen(true)} />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <OnboardingTour open={tourOpen} onFinish={finishTour} />
      <Toaster />

      {session.state === "done" && screen !== "decision" ? (
        <div className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 space-y-1.5">
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
