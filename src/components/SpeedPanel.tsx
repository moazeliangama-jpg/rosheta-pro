import { useMemo } from "react";
import { Activity, Download, FolderOpen, Gauge, Timer, TrendingDown } from "lucide-react";
import { useAppStore } from "../lib/store";
import { STEP_LABEL, STEP_ORDER, bottleneck, slowestSabs, summarize } from "../lib/metrics";
import { hasDesktopBridge, bridge } from "../lib/provider";
import { Badge, Button, Card, SectionTitle } from "./ui";

/**
 * لوحة السرعة: بتقرأ القياس الحقيقي لكل خطوة (بحث/فتح/التقاط/إرجاع)
 * وبتقول سطر واحد: الاختناق فين. مفيش تخمين ومفيش أرقام ثابتة.
 */
export function SpeedPanel({ compact = false }: { compact?: boolean }) {
  const steps = useAppStore((s) => s.steps);
  const session = useAppStore((s) => s.session);
  const logLine = useAppStore((s) => s.logLine);

  const stats = useMemo(() => summarize(steps), [steps]);
  const bn = useMemo(() => bottleneck(steps), [steps]);
  const slow = useMemo(() => slowestSabs(steps, compact ? 5 : 10), [steps, compact]);
  const total = stats.reduce((n, s) => n + s.count, 0);

  const exportCsv = async () => {
    if (!steps.length) return;
    const x = await import("../lib/excel");
    const n = x.exportStepsCsv(steps);
    logLine("ok", `تم تصدير توقيت ${n} خطوة إلى CSV.`);
  };

  const openFolder = async () => {
    const b = bridge();
    if (!b) return;
    const res = await b.openExportFolder();
    logLine(res?.ok ? "info" : "warn", res?.ok ? "تم فتح مجلد التنزيلات." : "تعذر فتح المجلد.");
  };

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <SectionTitle hint={`${total} قياس`}>قياس السرعة الحقيقي</SectionTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={bn.step === "idle" ? "neutral" : "info"}>
            <Gauge className="h-3 w-3" /> {bn.step === "idle" ? "لسه مفيش قياس" : `الاختناق: ${bn.label} ${bn.share}%`}
          </Badge>
          {session.autoTuned > 0 ? (
            <Badge tone="ok">
              <TrendingDown className="h-3 w-3" /> ضبط تلقائي {session.autoTuned}×
            </Badge>
          ) : null}
          {session.workers ? <Badge tone="neutral">{session.workers} نوافذ</Badge> : null}
          {session.autoTuned > 0 ? null : null}
        </div>
      </div>

      <div className="space-y-2 px-4 py-3">
        {total === 0 ? (
          <div className="py-4 text-center text-xs text-white/40">
            ابدأ تشغيل — كل خطوة بتتقاس بالمللي ثانية وتظهر هنا وفي تقرير الإكسل.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STEP_ORDER.map((step) => {
                const st = stats.find((x) => x.step === step);
                const active = bn.step === step;
                return (
                  <div
                    key={step}
                    className={
                      "rounded-lg border px-2.5 py-2 text-xs " +
                      (active ? "border-teal-400/40 bg-teal-500/10" : "border-white/10 bg-black/20")
                    }
                  >
                    <div className="flex items-center justify-between text-white/50">
                      <span>{STEP_LABEL[step]}</span>
                      <span className="tabular-nums">{st?.count ?? 0}</span>
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-1">
                      <span className="text-sm font-bold tabular-nums text-white">{st?.avg ?? 0}</span>
                      <span className="text-[10px] text-white/40">مللي متوسط</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-white/35">
                      p95 {st?.p95 ?? 0} · أقصى {st?.max ?? 0}
                      {st?.errors ? ` · ${st.errors} فشل` : ""}
                    </div>
                  </div>
                );
              })}
            </div>

            {slow.length ? (
              <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                <div className="mb-1 flex items-center gap-1 text-[11px] text-white/45">
                  <Timer className="h-3 w-3" /> أبطأ {slow.length} ساب
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {slow.map((r) => (
                    <span
                      key={r.sab}
                      className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] tabular-nums text-white/60"
                    >
                      {r.sab} · {(r.totalMs / 1000).toFixed(1)}ث
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Button size="sm" variant="ghost" onClick={() => void exportCsv()} disabled={!steps.length}>
            <Download className="h-3.5 w-3.5" /> CSV بتوقيت كل خطوة
          </Button>
          {hasDesktopBridge() ? (
            <Button size="sm" variant="ghost" onClick={() => void openFolder()}>
              <FolderOpen className="h-3.5 w-3.5" /> مجلد التصدير
            </Button>
          ) : null}
          {session.bottleneck ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-white/40">
              <Activity className="h-3 w-3" /> {session.bottleneck}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
