import { useMemo } from "react";
import { CheckCircle2, Info, ShieldAlert, XCircle } from "lucide-react";
import { useAppStore } from "../lib/store";
import { hasDesktopBridge } from "../lib/provider";
import { Badge, Card, SectionTitle } from "./ui";

/**
 * لوحة تشخيص «الروشتة مش بتظهر» — بتقول للمستخدم سبب واحد واضح بدل ما يفضل يدوّر.
 * كل بند ليه حالة نجاح/تحذير/فشل وطريقة إصلاح مكتوبة.
 */
export function DiagnosticsPanel() {
  const cases = useAppStore((s) => s.cases);
  const settings = useAppStore((s) => s.settings);
  const imagesHydrated = useAppStore((s) => s.imagesHydrated);

  const checks = useMemo(() => {
    const list = Object.values(cases);
    const withImage = list.filter((c) => c.rx.status === "ready" && c.rx.dataUrl).length;
    const failed = list.filter((c) => c.rx.status === "failed").length;
    const stale = list.filter((c) => c.rx.status === "ready" && !c.rx.dataUrl).length;

    return [
      {
        key: "bridge",
        level: hasDesktopBridge() ? "ok" : "warn",
        title: "جسر نايس دير",
        detail: hasDesktopBridge()
          ? "متصل بنسخة سطح المكتب — النوافذ المخفية جاهزة."
          : "شغّال في المتصفح: نايس دير محتاج نسخة سطح المكتب. الوضع التجريبي بيغطي الاختبار.",
      },
      {
        key: "mode",
        level: settings.demoMode ? "info" : "ok",
        title: "مصدر الصور",
        detail: settings.demoMode ? "الوضع التجريبي — صور روشتات تجريبية بدل السيستم." : "بيجلب من نايس دير فعليًا.",
      },
      {
        key: "storage",
        level: imagesHydrated ? "ok" : "warn",
        title: "مخزن الصور المحلي",
        detail: imagesHydrated
          ? "IndexedDB شغّال — الصور بتفضل موجودة بعد قفل البرنامج."
          : "لسه بيسترجع الصور… لو فضل كده، الصور اتمسحت من تخزين المتصفح.",
      },
      {
        key: "stale",
        level: stale > 0 ? "bad" : "ok",
        title: "استمارات بحالة «جاهزة» بدون صورة",
        detail:
          stale > 0
            ? `${stale} استمارة محتاجة إعادة جلب — هتظهر برسالة واضحة في شاشة القرار بدل مربع فاضي.`
            : "مفيش تعارض بين الحالة والصورة.",
      },
      {
        key: "images",
        level: list.length === 0 ? "info" : failed > 0 ? "warn" : "ok",
        title: "حصيلة الصور",
        detail:
          list.length === 0
            ? "لسه مفيش استمارات محمّلة."
            : `${withImage} صورة جاهزة، ${failed} غير متاحة، ${list.length - withImage - failed} قيد الجلب.`,
      },
    ] as const;
  }, [cases, settings, imagesHydrated]);

  return (
    <Card>
      <SectionTitle hint="بتتحدث تلقائيًا">تشخيص عرض الروشتات</SectionTitle>
      <div className="space-y-2">
        {checks.map((c) => {
          const Icon = c.level === "ok" ? CheckCircle2 : c.level === "bad" ? XCircle : c.level === "warn" ? ShieldAlert : Info;
          const tone = c.level === "ok" ? "ok" : c.level === "bad" ? "bad" : c.level === "warn" ? "warn" : "info";
          return (
            <div key={c.key} className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
              <Icon
                className={
                  "mt-0.5 h-4 w-4 shrink-0 " +
                  (c.level === "ok"
                    ? "text-emerald-400"
                    : c.level === "bad"
                      ? "text-rose-400"
                      : c.level === "warn"
                        ? "text-amber-400"
                        : "text-sky-400")
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{c.title}</span>
                  <Badge tone={tone}>{c.level === "ok" ? "سليم" : c.level === "bad" ? "مشكلة" : c.level === "warn" ? "انتبه" : "معلومة"}</Badge>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-white/50">{c.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
