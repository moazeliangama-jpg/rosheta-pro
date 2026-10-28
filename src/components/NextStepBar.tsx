import { ArrowLeft, Check, CircleHelp, Sparkles } from "lucide-react";
import type { NextAction, Stage } from "../lib/ux";
import { cn } from "../lib/utils";
import { Button } from "./ui";

const TONE_BTN: Record<NextAction["tone"], string> = {
  setup: "bg-white/10 text-white hover:bg-white/15",
  primary: "bg-teal-500 text-[#04201c] hover:bg-teal-400",
  success: "bg-emerald-500 text-[#032015] hover:bg-emerald-400",
  warn: "bg-amber-500 text-[#241603] hover:bg-amber-400",
  done: "bg-white/10 text-white/70 hover:bg-white/15",
};

/**
 * الشريط السفلي: «الخطوة الجاية» زرار واحد كبير + المراحل اللي إحنا فيها.
 * الفكرة إن المستخدم ما يحتاجش يفكر «أروح فين» — البرنامج بيقوله بالظبط.
 */
export function NextStepBar({
  action,
  stages,
  onRun,
  onHelp,
}: {
  action: NextAction;
  stages: Stage[];
  onRun: () => void;
  onHelp: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#05090a]/92 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-2.5">
        {/* المراحل — نقاط صغيرة مع اسم المرحلة الحالية بس */}
        <div className="flex items-center gap-1.5" aria-label="مراحل الشغل">
          {stages.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <div
                title={`${s.label} — ${s.status === "done" ? "خلص" : s.status === "current" ? "دلوقتي" : "لسه"}`}
                className={cn(
                  "grid h-5 w-5 place-items-center rounded-full border text-[10px] font-bold transition",
                  s.status === "done" && "border-emerald-400/40 bg-emerald-500/20 text-emerald-300",
                  s.status === "current" && "border-teal-400 bg-teal-500 text-[#04201c]",
                  s.status === "todo" && "border-white/15 bg-white/5 text-white/30",
                )}
              >
                {s.status === "done" ? <Check className="h-3 w-3" /> : s.step}
              </div>
              {s.status === "current" ? (
                <span className="text-[11px] font-semibold text-white/70">{s.label}</span>
              ) : null}
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 text-right">
          <div className="flex items-center justify-end gap-1.5 text-[11px] text-white/35">
            <Sparkles className="h-3 w-3 text-teal-400/70" />
            الخطوة {action.step} من {action.totalSteps}
          </div>
          <div className="truncate text-[10px] text-white/30">
            {action.hint}
            <span className="ms-1.5 hidden text-white/20 sm:inline">· Ctrl+Enter</span>
          </div>
        </div>

        <Button
          size="md"
          onClick={onRun}
          className={cn("shrink-0 rounded-xl font-bold shadow-lg", TONE_BTN[action.tone])}
        >
          {action.label}
          {action.optional ? null : <ArrowLeft className="h-4 w-4" />}
        </Button>

        <button
          onClick={onHelp}
          title="الاختصارات والمساعدة (؟)"
          aria-label="الاختصارات والمساعدة"
          className="hidden shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-white/40 transition hover:bg-white/5 hover:text-white sm:block"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
