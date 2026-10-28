import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Keyboard, ListChecks, MousePointerClick, ScrollText, X } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui";

interface TourStep {
  icon: typeof ScrollText;
  title: string;
  body: string;
  /** سطر عملي: «جرّبها دلوقتي» */
  tryIt: string;
}

const STEPS: TourStep[] = [
  {
    icon: ScrollText,
    title: "١) ملف السابات — اسحبه وأفلته",
    body: "بنقرأ الساب والاسم ومكان العمل من ملف الإكسل نفسه. أي ملف زيه بيتسحب على الشاشة، والقراءة بتحصل في ثانية.",
    tryIt: "جرّب: اسحب الملف وارميه جوه المربع المتقطّع.",
  },
  {
    icon: MousePointerClick,
    title: "٢) زرار واحد بس في كل مرة",
    body: "الشريط اللي تحت بيقولك الخطوة الجاية بالاسم («ابدأ الجرد»، «جلب الصور»، «ابدأ القرار»). مش محتاج تفتكر ترتيب الشغل — البرنامج بيرتّبه.",
    tryIt: "ملاحظة: الجرد والصور مرحلتين منفصلتين عن قصد — تقدر تراجع الجرد قبل ما تصرف وقت في الصور.",
  },
  {
    icon: ListChecks,
    title: "٣) شاشة القرار — ١ و ٢ ومسافة",
    body: "كل روشتة بتظهر بصورتها. اضغط ١ لو فيها دواء، ٢ لو بدون، ومسافة للانتقال. Ctrl+Z بيرجّع أي قرار غلط.",
    tryIt: "جرّب: ١ / ٢ / مسافة — أسرع بكتير من الماوس.",
  },
  {
    icon: Keyboard,
    title: "٤) Ctrl+K — كل حاجة من مكان واحد",
    body: "لوحة أوامر فيها كل خطوة وكل تصدير. اكتب «صور» أو «تصدير» وينفّذ. ولو نسيت اختصار، اضغط ؟",
    tryIt: "جرّب: Ctrl+K دلوقتي.",
  },
];

/**
 * جولة تعريف ٤ خطوات — بتظهر أول مرة بس، وقابلة للتخطي في أي لحظة.
 * مفيش أي مؤثرات وقتية أو «محتوى تجريبي»: كل خطوة بتوصف حاجة حقيقية في البرنامج.
 */
export function OnboardingTour({ open, onFinish }: { open: boolean; onFinish: () => void }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onFinish();
      } else if (e.key === "ArrowLeft") {
        // في RTL السهم الشمال = «التالي»
        setIndex((i) => Math.min(STEPS.length - 1, i + 1));
      } else if (e.key === "ArrowRight") {
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onFinish]);

  if (!open) return null;
  const step = STEPS[index];
  const Icon = step.icon;
  const last = index === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/15 bg-[#0b1518] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-6 bg-teal-400" : i < index ? "w-1.5 bg-teal-400/50" : "w-1.5 bg-white/15",
                )}
              />
            ))}
          </div>
          <button onClick={onFinish} className="flex items-center gap-1 text-[11px] text-white/35 hover:text-white/70">
            تخطّي <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="p-5">
          <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-teal-500/15 text-teal-300">
            <Icon className="h-5 w-5" />
          </div>
          <h3 className="text-base font-bold text-white">{step.title}</h3>
          <p className="mt-2 text-xs leading-relaxed text-white/60">{step.body}</p>
          <div className="mt-3 rounded-lg border border-teal-500/20 bg-teal-500/5 px-3 py-2 text-[11px] text-teal-200/90">
            {step.tryIt}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
          <span className="text-[10px] text-white/30">
            {index + 1} / {STEPS.length}
          </span>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setIndex((i) => i - 1)}>
                <ArrowRight className="h-3.5 w-3.5" /> السابق
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => (last ? onFinish() : setIndex((i) => i + 1))}
              className="bg-teal-500 text-[#04201c] hover:bg-teal-400"
            >
              {last ? "يلا نبدأ" : "التالي"} <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
