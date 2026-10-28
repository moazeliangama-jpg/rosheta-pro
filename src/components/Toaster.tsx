import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { dismissToast, useToasts, type ToastTone } from "../lib/toast";
import { cn } from "../lib/utils";

const ICONS: Record<ToastTone, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
  info: Info,
};

const TONES: Record<ToastTone, string> = {
  ok: "border-emerald-500/30 bg-emerald-950/90 text-emerald-100",
  warn: "border-amber-500/30 bg-amber-950/90 text-amber-100",
  error: "border-rose-500/30 bg-rose-950/90 text-rose-100",
  info: "border-sky-500/30 bg-sky-950/90 text-sky-100",
};

const ICON_TONES: Record<ToastTone, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-rose-400",
  info: "text-sky-400",
};

/**
 * إشعارات أسفل الشاشة — بتختفي لوحدها وما بتمنعش أي شغل تحتها
 * (`pointer-events-none` على الحاوية، والتفاعل على الإشعار نفسه بس).
 */
export function Toaster() {
  const items = useToasts();
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-3">
      {items.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)] backdrop-blur",
              TONES[t.tone],
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", ICON_TONES[t.tone])} />
            <span className="min-w-0 flex-1 leading-relaxed">{t.text}</span>
            {t.action ? (
              <button
                onClick={() => {
                  t.action?.run();
                  dismissToast(t.id);
                }}
                className="shrink-0 rounded-lg border border-current/30 px-2 py-1 text-[11px] font-semibold hover:bg-white/10"
              >
                {t.action.label}
              </button>
            ) : null}
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="إغلاق"
              className="shrink-0 rounded-md p-1 opacity-50 transition hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
