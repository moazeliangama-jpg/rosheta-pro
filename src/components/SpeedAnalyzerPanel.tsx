import { useMemo, useState } from "react";
import { Gauge, Play, Sparkles, Timer, TriangleAlert } from "lucide-react";
import { useAppStore } from "../lib/store";
import { analyzeInventorySpeed, formatDuration } from "../lib/analyzer";
import { Badge, Button, Card, SectionTitle } from "./ui";
import { cn } from "../lib/utils";
import { STEP_LABEL } from "../lib/metrics";

/**
 * محلّل سرعة الجرد: زرار واحد بيقرأ القياس الحقيقي المسجّل على الجهاز
 * وبيقول **أسرع طريقة** نعمل بيها الجرد (عدد نوافذ، ترتيب الجرد/الصور،
 * والإرجاع في الخلفية ولا في المقدمة) مع الزمن المتوقع لكل طريقة.
 *
 * مفيش رقم ثابت هنا: كل الأرقام من `steps` (ملي ثانية فعلية لكل خطوة)
 * ومن إنتاجية الجلسة السابقة لو موجودة.
 */
export function SpeedAnalyzerPanel({ sabs, forms }: { sabs: number; forms: number }) {
  const steps = useAppStore((s) => s.steps);
  const session = useAppStore((s) => s.session);
  const settings = useAppStore((s) => s.settings);
  const [ran, setRan] = useState(false);

  // سقف النوافذ من أنوية الجهاز الحقيقية (نفس قاعدة المحرك: أنوية × ٢ بحد أقصى ١٢).
  // الرام الحقيقية بتيجي من العملية الرئيسية، وهنا مش متاحة — فالقيمة دي حد أدنى آمن.
  const cap = useMemo(() => {
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    return Math.max(2, Math.min(12, cores * 2));
  }, []);

  const measured = useMemo(() => {
    const elapsedMs = session.startedAt && session.endedAt ? session.endedAt - session.startedAt : 0;
    const workers = session.workers || Number(settings.workerChoice) || 0;
    if (!session.formsDone || elapsedMs <= 0 || !workers) return null;
    return { forms: session.formsDone, elapsedMs: Math.max(1000, elapsedMs), workers };
  }, [session.startedAt, session.endedAt, session.formsDone, session.workers, settings.workerChoice]);

  const result = useMemo(() => {
    if (!ran) return null;
    return analyzeInventorySpeed({
      steps,
      sabs,
      forms,
      workers: session.workers || (settings.workerChoice === "auto" ? 5 : Number(settings.workerChoice) || 5),
      cap,
      turbo: settings.turboMode,
      deleteInBackground: !settings.preventDelete,
      measured,
    });
  }, [ran, steps, sabs, forms, session.workers, settings, cap, measured]);

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <SectionTitle hint="من القياس الحقيقي على جهازك">اختبار أسرع طريقة للجرد</SectionTitle>
        <Badge tone={result?.ready ? "ok" : "neutral"}>
          <Gauge className="h-3 w-3" /> {steps.length} قياس مسجّل
        </Badge>
      </div>

      <div className="space-y-2.5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setRan(true)}>
            <Play className="h-3.5 w-3.5" /> حلّل أسرع طريقة
          </Button>
          <span className="text-[11px] text-white/40">
            {sabs} ساب · {forms} استمارة · {settings.preventDelete ? "الإرجاع متوقف" : "الإرجاع شغال"}
          </span>
        </div>

        {result && !result.ready ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100/80">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{result.reason}</span>
          </div>
        ) : null}

        {result?.ready && result.best ? (
          <>
            <div className="rounded-lg border border-teal-400/30 bg-teal-500/10 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-teal-100">
                <Sparkles className="h-3.5 w-3.5" /> {result.best.label}
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-teal-50/70">{result.best.detail}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/60">
                <span className="inline-flex items-center gap-1 rounded-md bg-black/30 px-1.5 py-0.5 tabular-nums">
                  <Timer className="h-3 w-3" /> {formatDuration(result.best.projectedMs)}
                </span>
                <span className="tabular-nums">{Math.round(result.best.projectedMs / 60000) || 1} دقيقة / {forms} استمارة</span>
                {result.savingMs > 0 ? (
                  <span className="text-emerald-300">توفير {formatDuration(result.savingMs)} عن الإعداد الحالي</span>
                ) : (
                  <span className="text-white/40">الإعداد الحالي هو الأسرع</span>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
              <div className="mb-1 text-[11px] text-white/45">مقارنة الطرق (الأسرع الأول)</div>
              <div className="space-y-1">
                {result.plans.map((p) => {
                  const pct = Math.max(6, Math.round((p.projectedMs / result.plans[0].projectedMs) * 100));
                  return (
                    <div key={p.key} className="flex items-center gap-2 text-[11px]">
                      <span className={cn("w-44 shrink-0 truncate", p.fastest ? "text-teal-200" : "text-white/55")}>
                        {p.fastest ? "★ " : ""}
                        {p.label}
                      </span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <span
                          className={cn("block h-full rounded-full", p.fastest ? "bg-teal-400" : "bg-white/25")}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-20 shrink-0 text-end tabular-nums text-white/60">{formatDuration(p.projectedMs)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {(
                [
                  ["search", result.measuredMs.search],
                  ["click", result.measuredMs.click],
                  ["capture", result.measuredMs.capture],
                  ["delete", result.measuredMs.delete],
                ] as Array<["search" | "click" | "capture" | "delete", number]>
              ).map(([key, ms]) => (
                <div key={key} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px]">
                  <div className="text-white/40">{STEP_LABEL[key]}</div>
                  <div className="text-sm font-bold tabular-nums text-white">{ms}</div>
                  <div className="text-[10px] text-white/35">مللي متوسط</div>
                </div>
              ))}
            </div>

            <div className="space-y-0.5 text-[10px] leading-relaxed text-white/35">
              <div>{result.efficiency.note}</div>
              {result.notes.map((n) => (
                <div key={n}>· {n}</div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Card>
  );
}
