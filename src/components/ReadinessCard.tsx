import { AlertTriangle, CheckCircle2, Circle, Info, Lightbulb, X } from "lucide-react";
import type { ReadinessItem, SmartTip } from "../lib/ux";
import { cn } from "../lib/utils";

/**
 * لوحة «إيه اللي ناقص» — بتحوّل الأخطاء اللي كانت بتظهر بعد ما تدوس «ابدأ»
 * إلى قايمة واضحة قبل ما تبدأ. كل سطر بيروح مكانه بضغطة.
 */
export function ReadinessCard({
  items,
  onFix,
  onHide,
}: {
  items: ReadinessItem[];
  onFix: (item: ReadinessItem) => void;
  onHide: () => void;
}) {
  const required = items.filter((i) => !i.optional);
  const missing = required.filter((i) => !i.ok).length;
  const allDone = missing === 0;

  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        allDone ? "border-emerald-500/30 bg-emerald-950/20" : "border-amber-500/30 bg-amber-950/20",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          {allDone ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-emerald-200">كله جاهز — تقدر تبدأ الجرد</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <span className="text-amber-200">ناقص {missing} حاجة قبل التشغيل</span>
            </>
          )}
        </div>
        <button onClick={onHide} aria-label="إخفاء" className="rounded-md p-1 text-white/30 hover:bg-white/10 hover:text-white/60">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ul className="grid gap-1.5 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key}>
            <button
              onClick={() => (item.ok ? undefined : onFix(item))}
              disabled={item.ok}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-right text-[11px] transition",
                item.ok
                  ? "border-white/5 bg-white/[0.03] text-white/50"
                  : item.optional
                    ? "border-white/10 bg-black/20 text-white/60 hover:bg-white/5"
                    : "border-amber-500/25 bg-black/20 text-amber-100 hover:bg-amber-500/10",
              )}
            >
              {item.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <Circle className={cn("h-3.5 w-3.5 shrink-0", item.optional ? "text-white/25" : "text-amber-400")} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {item.label}
                  {item.optional ? <span className="mr-1 font-normal text-white/30">(اختياري)</span> : null}
                </span>
                <span className="block truncate text-[10px] text-white/35">{item.hint}</span>
              </span>
              {!item.ok && !item.optional ? <span className="shrink-0 text-[10px] text-amber-300/80">صلّحها</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TIP_STYLES: Record<SmartTip["tone"], { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: "border-sky-500/25 bg-sky-950/25 text-sky-100", icon: "text-sky-400", Icon: Info },
  warn: { box: "border-amber-500/25 bg-amber-950/25 text-amber-100", icon: "text-amber-400", Icon: AlertTriangle },
  ok: { box: "border-emerald-500/25 bg-emerald-950/25 text-emerald-100", icon: "text-emerald-400", Icon: Lightbulb },
};

/** تلميح واحد أو اتنين بحد أقصى — بيتحسب من حالة الشغل نفسها مش رسائل ثابتة */
export function SmartTips({ tips }: { tips: SmartTip[] }) {
  if (!tips.length) return null;
  return (
    <div className="space-y-1.5">
      {tips.map((tip) => {
        const s = TIP_STYLES[tip.tone];
        const Icon = s.Icon;
        return (
          <div key={tip.id} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed", s.box)}>
            <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", s.icon)} />
            <span>{tip.text}</span>
          </div>
        );
      })}
    </div>
  );
}
