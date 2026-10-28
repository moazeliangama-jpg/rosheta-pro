import { useMemo } from "react";
import { CheckCircle2, Info, ShieldAlert, XCircle } from "lucide-react";
import { useAppStore } from "../lib/store";
import { hasDesktopBridge } from "../lib/provider";
import { Badge, Card, SectionTitle } from "./ui";

/**
 * لوحة تشخيص حقيقية: بتقول سبب عدم ظهور الروشتة بالضبط،
 * من غير أي تخمين — بتقرأ حالة الجسر والحالة المحفوظة.
 */
export function DiagnosticsPanel() {
  const cases = useAppStore((s) => s.cases);
  const settings = useAppStore((s) => s.settings);
  const imagesHydrated = useAppStore((s) => s.imagesHydrated);
  const loggedIn = useAppStore((s) => s.niceDeerLoggedIn);
  const session = useAppStore((s) => s.session);

  const checks = useMemo(() => {
    const list = Object.values(cases);
    const ready = list.filter((c) => c.rx.status === "ready" && c.rx.dataUrl);
    const failed = list.filter((c) => c.rx.status === "failed");
    const stale = list.filter((c) => c.rx.status === "ready" && !c.rx.dataUrl);
    const methods = [...new Set(ready.map((c) => c.rx.method).filter(Boolean))];

    return [
      {
        key: "bridge",
        level: hasDesktopBridge() ? "ok" : "bad",
        title: "محرك سطح المكتب",
        detail: hasDesktopBridge()
          ? "متصل — نوافذ نايس دير الحقيقية جاهزة للفتح والتقاط الصور."
          : "غير متاح: أتمتة نايس دير لازم تشتغل من نسخة سطح المكتب (EXE). المتصفح مش قادر يفتح نوافذ مخفية.",
      },
      {
        key: "login",
        level: loggedIn ? "ok" : "warn",
        title: "تسجيل دخول نايس دير",
        detail: loggedIn
          ? "الجلسة مسجلة — البرنامج بيدخل تلقائيًا."
          : "لسه مش متأكد من الدخول. اضغط «اختبار الدخول» في الإعداد.",
      },
      {
        key: "payer",
        level: settings.payerId ? "ok" : "bad",
        title: "الباير",
        detail: settings.payerId
          ? `المختار: ${settings.payerName} (#${settings.payerId})`
          : "لازم تختار الباير — من غيره البحث مش هيجيب استمارات.",
      },
      {
        key: "storage",
        level: imagesHydrated ? "ok" : "warn",
        title: "مخزن صور الروشتات",
        detail: imagesHydrated
          ? "IndexedDB شغّال — الصور بتفضل بعد قفل البرنامج."
          : "بيسترجع الصور… لو فضل كده، التخزين المحلي ممسوح.",
      },
      {
        key: "stale",
        level: stale.length > 0 ? "bad" : "ok",
        title: "استمارات «جاهزة» بدون صورة",
        detail:
          stale.length > 0
            ? `${stale.length} استمارة محتاجة إعادة جلب — هتظهر بعلامة حمراء وسببها.`
            : "مفيش تعارض بين الحالة والصورة.",
      },
      {
        key: "images",
        level: list.length === 0 ? "info" : failed.length > 0 ? "warn" : "ok",
        title: "حصيلة الصور",
        detail:
          list.length === 0
            ? "لسه مفيش جرد. ابدأ «جرد الاستمارات»."
            : `${ready.length} صورة جاهزة، ${failed.length} فاشلة، ${list.length - ready.length - failed.length} لم تُجلب بعد.` +
              (methods.length ? ` طرق الالتقاط: ${methods.join(" / ")}` : ""),
      },
      {
        key: "delete",
        level: settings.preventDelete ? "warn" : "info",
        title: "الإرجاع (Delete)",
        detail: settings.preventDelete
          ? "متوقف — البرنامج مش هيضغط Delete، فاﻻستمارة هتفضل على السيستم."
          : "شغّال — بعد التقاط صورة كل استمارة البرنامج بيضغط #btn-DeleteClaim لإرجاعها زي طريقة الصرف.",
      },
      {
        key: "session",
        level: session.state === "done" ? "ok" : "info",
        title: "آخر تشغيل",
        detail: session.startedAt
          ? `الحالة: ${session.state} — صور: ${session.images}، متعثرات: ${session.failures}.`
          : "لسه مفيش تشغيل.",
      },
    ] as const;
  }, [cases, settings, imagesHydrated, loggedIn, session]);

  return (
    <Card>
      <SectionTitle hint="بيتحدث تلقائيًا">تشخيص عرض الروشتات</SectionTitle>
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
                  <Badge tone={tone}>
                    {c.level === "ok" ? "سليم" : c.level === "bad" ? "مشكلة" : c.level === "warn" ? "انتبه" : "معلومة"}
                  </Badge>
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
