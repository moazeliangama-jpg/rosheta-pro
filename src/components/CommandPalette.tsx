import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import { filterCommands } from "../lib/ux";
import { cn } from "../lib/utils";

export interface Command {
  id: string;
  label: string;
  /** شرح قصير تحت الاسم */
  hint?: string;
  keywords?: string;
  icon: LucideIcon;
  group: string;
  run: () => void;
  disabled?: boolean;
}

/**
 * لوحة الأوامر (Ctrl+K) — كل حاجة في البرنامج من مكان واحد،
 * بدون ما المستخدم يدور على زرار في شاشة معيّنة.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    // التركيز بعد الرسم عشان النافذة تبقى ظاهرة
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, list.length - 1)));
  }, [list.length]);

  if (!open) return null;

  const runAt = (index: number) => {
    const cmd = list[index];
    if (!cmd || cmd.disabled) return;
    onClose();
    // بعد ما النافذة تتقفل، عشان الأوامر اللي بتفتح نوافذ تانية تشتغل صح
    setTimeout(() => cmd.run(), 0);
  };

  const groups = list.reduce<Record<string, Command[]>>((acc, cmd) => {
    (acc[cmd.group] ??= []).push(cmd);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="لوحة الأوامر"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-[#0b1518] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-white/35" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => (list.length ? (i + 1) % list.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runAt(active);
              }
            }}
            placeholder="اكتب أمر… (جرد، صور، قرار، تصدير، واتساب)"
            className="w-full bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
          />
          <kbd className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">Esc</kbd>
        </div>

        <div className="max-h-[52vh] overflow-auto py-1">
          {!list.length ? (
            <div className="px-4 py-8 text-center text-xs text-white/40">
              مفيش أمر بالاسم ده — جرّب «صور» أو «تصدير» أو «قرار».
            </div>
          ) : (
            Object.entries(groups).map(([group, items]) => (
              <div key={group} className="mb-1">
                <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-white/25">
                  {group}
                </div>
                {items.map((cmd) => {
                  const index = list.indexOf(cmd);
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => runAt(index)}
                      disabled={cmd.disabled}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2 text-right text-xs transition",
                        index === active ? "bg-teal-500/15 text-white" : "text-white/70 hover:bg-white/5",
                        cmd.disabled && "cursor-not-allowed opacity-35",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-teal-300/80" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{cmd.label}</span>
                        {cmd.hint ? <span className="block truncate text-[10px] text-white/35">{cmd.hint}</span> : null}
                      </span>
                      {index === active ? <CornerDownLeft className="h-3.5 w-3.5 text-white/30" /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[10px] text-white/30">
          <span>↑↓ للتنقل · Enter للتنفيذ</span>
          <span>{list.length} أمر</span>
        </div>
      </div>
    </div>
  );
}
