import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, CloudOff, Save } from "lucide-react";
import { getSaveState, subscribeSave } from "../lib/store";
import { cn } from "../lib/utils";

function useSaveState() {
  return useSyncExternalStore(subscribeSave, getSaveState, getSaveState);
}

/**
 * مؤشر «كل حاجة محفوظة» — بيوفر على المستخدم سؤال «هل اتحفظ؟»
 * وبيقول الوقت اللي اتحفظ فيه آخر مرة.
 */
export function SaveStatus({ className }: { className?: string }) {
  const { dirty, savedAt } = useSaveState();
  const [, setTick] = useState(0);

  // تحديث الوقت المعروض كل دقيقة (من غير ما نعمل تايمر لكل ثانية)
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const time = savedAt ? new Date(savedAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "";

  if (dirty) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[10px] text-amber-300/80", className)}>
        <Save className="h-3 w-3 animate-pulse" /> بيتحفظ…
      </span>
    );
  }
  if (!savedAt) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[10px] text-white/25", className)}>
        <CloudOff className="h-3 w-3" /> الحفظ التلقائي شغّال
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] text-emerald-300/70", className)} title="الحفظ بيحصل لوحده">
      <Check className="h-3 w-3" /> محفوظ {time}
    </span>
  );
}
