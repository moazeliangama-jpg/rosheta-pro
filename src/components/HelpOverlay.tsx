import { Keyboard, Lightbulb, X } from "lucide-react";
import { formatShortcut } from "../lib/ux";

const SHORTCUTS: Array<{ keys: string; what: string; where?: string }> = [
  { keys: "ctrl+k", what: "لوحة الأوامر — كل حاجة من مكان واحد" },
  { keys: "ctrl+enter", what: "نفّذ «الخطوة الجاية» من أي شاشة" },
  { keys: "alt+1", what: "شاشة الإعداد" },
  { keys: "alt+2", what: "شاشة التشغيل" },
  { keys: "alt+3", what: "شاشة القرار" },
  { keys: "alt+4", what: "شاشة النتيجة" },
  { keys: "1", what: "الروشتة بها دواء", where: "شاشة القرار" },
  { keys: "2", what: "الروشتة بدون دواء", where: "شاشة القرار" },
  { keys: "space", what: "الروشتة اللي بعدها", where: "شاشة القرار" },
  { keys: "ctrl+z", what: "تراجع عن آخر قرار", where: "شاشة القرار" },
  { keys: "r", what: "تدوير الصورة ٩٠°", where: "الصورة مفتوحة" },
  { keys: "shift+r", what: "تدوير عكس الاتجاه", where: "الصورة مفتوحة" },
  { keys: "esc", what: "إغلاق الصورة / النافذة" },
  { keys: "?", what: "هذه القائمة" },
];

const TIPS = [
  "اسحب ملف Excel وأفلته على شاشة الإعداد — مش محتاج تدور على زرار.",
  "كل إعداد بيتحفظ لوحده لحظة ما تغيّره.",
  "زرار «الخطوة الجاية» في الشريط السفلي هو كل اللي محتاجه — مش لازم تفتكر إنت فين.",
  "لو القرار غلط، Ctrl+Z بيرجّع آخر واحدة (وحتى القرار الجماعي لساب كامل).",
  "«الجديد فقط» بيعرض استمارات النهاردة بس، عشان ما تعيدش مراجعة القديم.",
];

/** دليل الاختصارات — بيفتح بـ `?` أو من الشريط السفلي */
export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="الاختصارات والمساعدة"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#0b1518] p-5 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-white">
              <Keyboard className="h-4 w-4 text-teal-300" /> اختصارات ومفاتيح سريعة
            </h3>
            <p className="mt-1 text-[11px] text-white/40">كل الاختصارات دي بتوفر نقرات — جرّبها مرة وهتتعوّد عليها.</p>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-lg p-1.5 text-white/40 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys + s.what}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <div className="truncate text-[11px] text-white/80">{s.what}</div>
                {s.where ? <div className="text-[10px] text-white/30">{s.where}</div> : null}
              </div>
              <kbd className="shrink-0 rounded-md border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/70" dir="ltr">
                {formatShortcut(s.keys)}
              </kbd>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-teal-500/20 bg-teal-500/5 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-teal-200">
            <Lightbulb className="h-3.5 w-3.5" /> حاجات بتوفّر وقت
          </div>
          <ul className="space-y-1 text-[11px] leading-relaxed text-white/60">
            {TIPS.map((t) => (
              <li key={t} className="flex gap-1.5">
                <span className="text-teal-400">•</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
