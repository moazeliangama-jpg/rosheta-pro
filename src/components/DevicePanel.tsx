import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Stethoscope,
  Trash2,
  XCircle,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { bridge, hasDesktopBridge, type MaintenanceInfo } from "../lib/provider";
import { downloadBlob, nowTime } from "../lib/utils";
import { Badge, Button, Card, SectionTitle } from "./ui";

interface Check {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

interface ProbeRow {
  selector: string;
  label: string;
  optional?: boolean;
  found: boolean;
}

/**
 * ١١٩/١٢٠ + تجهيز الجهاز:
 * البرنامج بيفحص الجهاز بنفسه (مفيش أي متطلب سابق)، وبيقول بالظبط إيه الناقص،
 * وبيفحص سلكتورات الموقع الحقيقي — فلو نايس دير غيّر الصفحة بنعرف من غير تخمين.
 */
export function DevicePanel() {
  const logLine = useAppStore((s) => s.logLine);
  const [busy, setBusy] = useState<"device" | "probe" | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [probe, setProbe] = useState<{ missing: string[]; results: ProbeRow[]; page: string } | null>(null);
  const [dirs, setDirs] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  // ١٢٧) صيانة ملفات اللوج والتشخيص
  const [files, setFiles] = useState<MaintenanceInfo | null>(null);
  const [cleanBusy, setCleanBusy] = useState<null | "stats" | "prune" | "clear">(null);

  const runPreflight = async () => {
    const b = bridge();
    if (!b) return;
    setBusy("device");
    setError("");
    try {
      const res = await b.preflight();
      if (res.ok && res.data) {
        setChecks(res.data.checks);
        setDirs(res.data.dirs ?? null);
        const failed = res.data.checks.filter((c) => !c.ok);
        logLine(
          failed.length ? "warn" : "ok",
          failed.length
            ? `فحص الجهاز: ${failed.length} عنصر محتاج انتباه — ${failed.map((f) => f.label).join(" · ")}`
            : "فحص الجهاز: الجهاز جاهز على كل حاجة.",
        );
      } else {
        setError(res.error || "فحص الجهاز فشل");
      }
    } finally {
      setBusy(null);
    }
  };

  const runProbe = async () => {
    const b = bridge();
    if (!b) return;
    setBusy("probe");
    setError("");
    try {
      const res = await b.probe();
      if (res.ok && res.data) {
        setProbe(res.data);
        logLine(
          res.data.missing.length ? "error" : "ok",
          res.data.missing.length
            ? `الموقع اتغير؟ السلكتورات الناقصة: ${res.data.missing.join(" · ")}`
            : "فحص السلكتورات: كل عناصر نايس دير موجودة زي ما هي.",
        );
      } else {
        setError(res.error || "فحص السلكتورات فشل");
      }
    } finally {
      setBusy(null);
    }
  };

  /** ١٢٧) إحصاء/تنضيف ملفات اللوج واللقطات — مفيش ملفات بتكبر لانهائي */
  const maintain = async (action: "stats" | "prune" | "clear" | "open-logs" | "open-diagnostics") => {
    const b = bridge();
    if (!b) return;
    if (action === "stats" || action === "prune" || action === "clear") setCleanBusy(action);
    setError("");
    try {
      const res = await b.maintenance({ action });
      if (!res.ok || !res.data) {
        setError(res.error || "صيانة الملفات فشلت");
        return;
      }
      setFiles(res.data);
      if (action === "prune" || action === "clear") {
        logLine("ok", `صيانة الملفات: اتمسح ${res.data.removed ?? 0} ملف — فاضل ${res.data.logs.count} لوج و${res.data.diagnostics.count} لقطة.`);
      }
    } finally {
      setCleanBusy(null);
    }
  };

  /** ١١٩) ملف تشخيص صغير: بيتبعت للدعم بدل شرح طويل */
  const exportDiagnostics = () => {
    const s = useAppStore.getState();
    const report = {
      exportedAt: new Date().toISOString(),
      time: nowTime(),
      bridge: hasDesktopBridge(),
      device: checks,
      dirs,
      probe,
      settings: {
        payerId: s.settings.payerId,
        payerName: s.settings.payerName,
        workplace: s.settings.workplace,
        workerChoice: s.settings.workerChoice,
        turboMode: s.settings.turboMode,
        validityDays: s.settings.validityDays,
        preventDelete: s.settings.preventDelete,
      },
      files,
      session: {
        state: s.session.state,
        workers: s.session.workers,
        images: s.session.images,
        failures: s.session.failures,
        bottleneck: s.session.bottleneck,
      },
      counts: {
        patients: s.patients.length,
        cases: Object.keys(s.cases).length,
        steps: s.steps.length,
        failed: s.failed.length,
      },
      lastLogs: s.log.slice(0, 40),
    };
    downloadBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      `روشتة-برو-تشخيص-${new Date().toISOString().slice(0, 10)}.json`,
    );
    logLine("ok", "تم تصدير ملف التشخيص — ابعته للدعم.");
  };

  if (!hasDesktopBridge()) return null;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle hint="البرنامج بيجهّز الجهاز بنفسه">جهازك جاهز؟</SectionTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void runPreflight()} disabled={busy !== null}>
            <HardDrive className={busy === "device" ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"} /> فحص الجهاز
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void runProbe()} disabled={busy !== null}>
            <Stethoscope className={busy === "probe" ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"} /> فحص السلكتورات
          </Button>
          <Button size="sm" variant="muted" onClick={exportDiagnostics}>
            <Download className="h-3.5 w-3.5" /> ملف تشخيص
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      {!checks ? (
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-relaxed text-white/45">
          اضغط «فحص الجهاز» — البرنامج بيتأكد إن ملفاته ومساحة التخزين والاتصال بـ نايس دير والمحرك المدمج
          (Chromium + Node) كلهم شغالين، وبيجهّز الناقص بنفسه. مفيش أي حاجة محتاج تسطّبها قبل كده.
        </div>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {checks.map((c) => (
            <div
              key={c.key}
              className={
                "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] " +
                (c.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/25 bg-rose-500/10")
              }
            >
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
              )}
              <div className="min-w-0">
                <div className="font-semibold text-white/80">{c.label}</div>
                <div className="truncate text-white/45" title={c.detail}>
                  {c.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {probe ? (
        <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            {probe.missing.length ? (
              <Badge tone="bad">
                <AlertTriangle className="h-3 w-3" /> الموقع اتغير — {probe.missing.length} سلكتور ناقص
              </Badge>
            ) : (
              <Badge tone="ok">
                <Activity className="h-3 w-3" /> كل السلكتورات موجودة
              </Badge>
            )}
            <span className="truncate text-white/35" dir="ltr">
              {probe.page}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {probe.results.map((r) => (
              <span
                key={r.selector}
                className={
                  "rounded-md px-1.5 py-0.5 text-[10px] tabular-nums " +
                  (r.found
                    ? "bg-emerald-500/10 text-emerald-200"
                    : r.optional
                      ? "bg-white/5 text-white/35"
                      : "bg-rose-500/15 text-rose-200")
                }
                title={r.label}
                dir="ltr"
              >
                {r.selector}
              </span>
            ))}
          </div>
          <div className="mt-1.5 text-[10px] text-white/30">
            السلكتورات الرمادية اختيارية (بتظهر في صفحات معيّنة بس).
          </div>
        </div>
      ) : (
        <div className="mt-2 text-[10px] text-white/30">
          «فحص السلكتورات» بيفتح صفحة البحث الحقيقية مرة واحدة ويقرأ كل العناصر المهمة.
        </div>
      )}

      {/* ١٢٧) اللوجات واللقطات: بنعرض الحجم الحقيقي وبننضّف بضغطة */}
      <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-semibold text-white/70">ملفات اللوج والتشخيص</span>
          {files ? (
            <span className="text-white/40">
              {files.logs.count} لوج ({Math.round(files.logs.bytes / 1024)} ك.ب) · {files.diagnostics.count} لقطة
              تشخيص ({Math.round(files.diagnostics.bytes / 1024)} ك.ب)
            </span>
          ) : (
            <span className="text-white/30">
              بيتنضّفوا تلقائيًا: اللوج بعد 14 يوم واللقطات بعد 7 يوم
            </span>
          )}
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="muted" onClick={() => void maintain("stats")} disabled={cleanBusy !== null}>
              <RefreshCw className={cleanBusy === "stats" ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> إحصاء
            </Button>
            <Button size="sm" variant="muted" onClick={() => void maintain("open-logs")}>
              <FolderOpen className="h-3.5 w-3.5" /> مجلد اللوج
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void maintain("prune")} disabled={cleanBusy !== null}>
              <Trash2 className="h-3.5 w-3.5" /> تنضيف القديم
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void maintain("clear")} disabled={cleanBusy !== null}>
              <Trash2 className="h-3.5 w-3.5" /> مسح الكل
            </Button>
          </div>
        </div>
        <div className="mt-1 text-[10px] text-white/30">
          الملفات دي بتتحفظ داخل بيانات البرنامج، ومش بتأثر على الجلسة — بتفيدك في الدعم لو حصلت مشكلة.
        </div>
      </div>

      {dirs ? (
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-white/30">
          {Object.entries(dirs).map(([k, v]) => (
            <span key={k} className="rounded bg-white/5 px-1.5 py-0.5" dir="ltr" title={v}>
              {k}: {v}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> بيتعملوا تلقائيًا أول تشغيل
          </span>
        </div>
      ) : null}
    </Card>
  );
}
