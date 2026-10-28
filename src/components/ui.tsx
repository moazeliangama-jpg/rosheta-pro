import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-[#0b1518]/80 p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-bold text-white">{children}</h2>
      {hint ? <span className="text-xs text-white/45">{hint}</span> : null}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "success" | "muted";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "primary", size = "md", className, ...props }: BtnProps) {
  const variants: Record<string, string> = {
    primary: "bg-teal-500 text-[#04201c] hover:bg-teal-400 disabled:bg-teal-500/40",
    success: "bg-emerald-500 text-[#032015] hover:bg-emerald-400 disabled:bg-emerald-500/40",
    danger: "bg-rose-500/90 text-white hover:bg-rose-500 disabled:bg-rose-500/40",
    ghost: "border border-white/15 bg-white/5 text-white hover:bg-white/10",
    muted: "bg-white/10 text-white/70 hover:bg-white/15",
  };
  const sizes: Record<string, string> = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2.5 text-sm",
    lg: "px-6 py-3.5 text-base",
  };
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-white/80">{label}</span>
      <input
        {...props}
        className={cn(
          "w-full rounded-xl border bg-black/30 px-3.5 py-2.5 text-white placeholder:text-white/30 focus:outline-none focus:ring-2",
          error ? "border-rose-500/60 focus:ring-rose-500/40" : "border-white/10 focus:border-teal-400/60 focus:ring-teal-500/30",
          props.className,
        )}
      />
      {error ? <span className="mt-1 block text-xs text-rose-400">{error}</span> : hint ? <span className="mt-1 block text-xs text-white/40">{hint}</span> : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-right transition hover:bg-black/30",
        disabled && "opacity-50",
      )}
    >
      <span>
        <span className="block text-sm font-medium text-white">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-white/45">{hint}</span> : null}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition",
          checked ? "bg-teal-500" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
            checked ? "left-0.5" : "left-[22px]",
          )}
        />
      </span>
    </button>
  );
}

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "ok" | "warn" | "bad" | "info";
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-white/10 text-white/70",
    ok: "bg-emerald-500/15 text-emerald-300",
    warn: "bg-amber-500/15 text-amber-300",
    bad: "bg-rose-500/15 text-rose-300",
    info: "bg-sky-500/15 text-sky-300",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Stat({ label, value, tone = "neutral" }: { label: string; value: ReactNode; tone?: "neutral" | "ok" | "warn" | "bad" }) {
  const tones: Record<string, string> = {
    neutral: "text-white",
    ok: "text-emerald-400",
    warn: "text-amber-400",
    bad: "text-rose-400",
  };
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
      <div className="text-[11px] text-white/45">{label}</div>
      <div className={cn("mt-0.5 text-lg font-bold tabular-nums", tones[tone])}>{value}</div>
    </div>
  );
}

export function Progress({ value, tone = "teal" }: { value: number; tone?: "teal" | "amber" }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={cn("h-full rounded-full transition-all duration-500", tone === "teal" ? "bg-teal-400" : "bg-amber-400")}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-black/20 px-6 py-12 text-center">
      <div className="text-base font-bold text-white">{title}</div>
      <p className="max-w-md text-sm leading-relaxed text-white/50">{body}</p>
      {action}
    </div>
  );
}
