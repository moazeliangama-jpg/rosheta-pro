import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Download,
  Filter,
  ImageIcon,
  RefreshCw,
  Search,
  Send,
  XCircle,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { orderedCases } from "../lib/engine";
import { progressOf } from "../lib/eligibility";
import type { CaseRecord } from "../lib/types";
import { Badge, Button, Card, EmptyState, Progress, SectionTitle, Stat } from "../components/ui";
import { RxImage, RxLightbox } from "../components/RxViewer";
import { cn } from "../lib/utils";
import { exportAvailable } from "../lib/excel";

type Tab = "all" | "undecided" | "available" | "failed";

export function DecisionScreen({ onRetry }: { onRetry: (c: CaseRecord) => void }) {
  const cases = useAppStore((s) => s.cases);
  const caseOrder = useAppStore((s) => s.caseOrder);
  const viewerId = useAppStore((s) => s.viewerId);
  const setViewer = useAppStore((s) => s.setViewer);
  const setVerdict = useAppStore((s) => s.setVerdict);
  const setScreen = useAppStore((s) => s.setScreen);
  const session = useAppStore((s) => s.session);
  const logLine = useAppStore((s) => s.logLine);

  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  const all = useMemo(() => orderedCases(caseOrder, cases), [caseOrder, cases]);
  const stats = progressOf(all);

  // تشخيص سريع: ليه ممكن الروشتة مش ظاهرة
  const diagnostics = useMemo(() => {
    const noImage = all.filter((c) => !c.rx.dataUrl);
    const failed = all.filter((c) => c.rx.status === "failed");
    return { noImage: noImage.length, failed: failed.length };
  }, [all]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return all.filter((c) => {
      if (q && !`${c.patientName} ${c.sab} ${c.phone} ${c.formLabel}`.includes(q)) return false;
      switch (tab) {
        case "undecided":
          return c.drugs === null || (c.isMonthly && c.monthly === null);
        case "available":
          return c.drugs === "available" || c.monthly === "available";
        case "failed":
          return c.rx.status === "failed";
        default:
          return true;
      }
    });
  }, [all, query, tab]);

  const viewer = viewerId ? cases[viewerId] ?? null : null;

  const handleRetry = async (c: CaseRecord) => {
    setRetrying((prev) => new Set(prev).add(c.id));
    try {
      await onRetry(c);
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
    }
  };

  const retryAllFailed = async () => {
    const failed = all.filter((c) => c.rx.status === "failed");
    for (const c of failed) await handleRetry(c);
  };

  if (!all.length) {
    return (
      <Card>
        <EmptyState
          title="مفيش استمارات محمّلة"
          body="شاشة القرار بتعرض الاستمارات اللي جت من جلسة التشغيل. ابدأ جلسة من شاشة التشغيل أو ارفع ملف Excel من الإعداد."
          action={
            <Button className="mt-2" onClick={() => setScreen("setup")}>
              رجوع للإعداد
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="إجمالي الاستمارات" value={stats.total} />
        <Stat label="صورة جاهزة" value={stats.ready} tone="ok" />
        <Stat label="قيد الجلب" value={stats.loading} tone="warn" />
        <Stat label="غير متاحة" value={stats.failed} tone="bad" />
        <Stat label="تم قرارها" value={stats.decided} />
        <Stat label="متاح للصرف" value={stats.available} tone="ok" />
      </div>

      {diagnostics.failed > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {diagnostics.failed} استمارة صورتها لسه مش متاحة — ظاهرة في القائمة بعلامة حمراء بسبب واضح، وتقدر تعيد المحاولة.
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void retryAllFailed()}>
            <RefreshCw className="h-3.5 w-3.5" /> إعادة محاولة الكل
          </Button>
        </div>
      ) : null}

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الساب أو التليفون…"
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pe-9 ps-3 text-sm text-white placeholder:text-white/30 focus:border-teal-400/60 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
            {(
              [
                ["all", "الكل"],
                ["undecided", "لم يُحسم"],
                ["available", "متاح"],
                ["failed", "متعثر"],
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  tab === key ? "bg-teal-500 text-[#04201c]" : "text-white/60 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => exportAvailable(all)}>
            <Download className="h-3.5 w-3.5" /> إكسل المتاحين
          </Button>
        </div>

        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="مفيش نتائج بالفلتر الحالي"
              body="جرّب فلتر «الكل» أو امسح كلمة البحث."
              action={
                <Button size="sm" className="mt-2" variant="ghost" onClick={() => { setTab("all"); setQuery(""); }}>
                  <Filter className="h-3.5 w-3.5" /> إظهار الكل
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((c) => (
              <CaseCard
                key={c.id}
                c={c}
                retrying={retrying.has(c.id)}
                onOpen={() => setViewer(c.id)}
                onRetry={() => void handleRetry(c)}
                onDrugs={(v) => setVerdict(c.id, "drugs", v)}
                onMonthly={(v) => setVerdict(c.id, "monthly", v)}
              />
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0b1518]/70 px-4 py-3">
        <div className="text-xs text-white/50">
          جلسة {session.rxTotal} استمارة • {stats.decided} قرار محسوم من {stats.total}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setScreen("run")}>
            شاشة التشغيل
          </Button>
          <Button
            variant="success"
            onClick={() => {
              if (stats.decided === 0) {
                logLine("warn", "لسه مفيش قرارات — حدد «الأدوية متاحة» أو «الشهري متاح» الأول.");
                return;
              }
              setScreen("results");
            }}
          >
            <Send className="h-4 w-4" /> اعتماد وبدء التواصل
          </Button>
        </div>
      </div>

      {viewer ? <RxLightbox c={viewer} onClose={() => setViewer(null)} onRetry={() => void handleRetry(viewer)} /> : null}
    </div>
  );
}

function CaseCard({
  c,
  retrying,
  onOpen,
  onRetry,
  onDrugs,
  onMonthly,
}: {
  c: CaseRecord;
  retrying: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onDrugs: (v: "available" | "unavailable") => void;
  onMonthly: (v: "available" | "unavailable") => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // تحميل مؤجل للصور: بيمنع تجمّد الشاشة لما يكون فيه مئات الصور
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const statusBadge =
    c.rx.status === "ready" ? (
      <Badge tone="ok">
        <ImageIcon className="h-3 w-3" /> صورة جاهزة
      </Badge>
    ) : c.rx.status === "failed" ? (
      <Badge tone="bad">
        <XCircle className="h-3 w-3" /> غير متاحة
      </Badge>
    ) : (
      <Badge tone="warn">
        <RefreshCw className="h-3 w-3 animate-spin" /> جارٍ الجلب
      </Badge>
    );

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#081114]">
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-white">{c.patientName}</div>
          <div className="truncate text-[11px] text-white/45">
            ساب {c.sab} • {c.formLabel} • {c.formType}
          </div>
        </div>
        {statusBadge}
      </div>

      <div ref={mountRef} className="px-3 pt-2">
        {visible ? (
          <button onClick={onOpen} className="block w-full cursor-zoom-in" aria-label={`عرض روشتة ${c.patientName}`}>
            <RxImage c={c} className="max-h-56" onRetry={onRetry} />
          </button>
        ) : (
          <div className="flex aspect-[3/4] max-h-56 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-xs text-white/25">
            …
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        {c.rx.status === "failed" ? (
          <Button size="sm" variant="ghost" className="w-full" onClick={onRetry} disabled={retrying}>
            <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} /> {retrying ? "جارٍ الإصلاح…" : "إعادة المحاولة"}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="w-full" onClick={onOpen}>
            <ChevronLeft className="h-3.5 w-3.5" /> عرض الصورة بالكامل
          </Button>
        )}
      </div>

      <div className="space-y-2 border-t border-white/10 px-3 py-2.5">
        <VerdictRow
          label="الأدوية"
          value={c.drugs}
          onChange={onDrugs}
          disabled={c.rx.status !== "ready"}
        />
        {c.isMonthly ? (
          <VerdictRow
            label="الشهري"
            value={c.monthly}
            onChange={onMonthly}
            disabled={!c.monthlyEligible}
            hint={c.monthlyReason}
          />
        ) : null}
        {c.deleted ? <Badge tone="warn">تم إرجاعها (Delete)</Badge> : null}
      </div>
    </div>
  );
}

function VerdictRow({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: "available" | "unavailable" | null;
  onChange: (v: "available" | "unavailable") => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/50">{label}</span>
        {hint ? <span className="truncate text-[10px] text-white/30" title={hint}>{hint}</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          disabled={disabled}
          onClick={() => onChange("available")}
          className={cn(
            "flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition",
            value === "available"
              ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
              : "border-white/10 bg-black/20 text-white/55 hover:bg-white/5",
            disabled && "cursor-not-allowed opacity-40",
          )}
        >
          <CheckCircle2 className="h-3 w-3" /> متاح
        </button>
        <button
          disabled={disabled}
          onClick={() => onChange("unavailable")}
          className={cn(
            "flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition",
            value === "unavailable"
              ? "border-rose-400/50 bg-rose-500/20 text-rose-200"
              : "border-white/10 bg-black/20 text-white/55 hover:bg-white/5",
            disabled && "cursor-not-allowed opacity-40",
          )}
        >
          <XCircle className="h-3 w-3" /> غير متاح
        </button>
      </div>
    </div>
  );
}

export { Progress, SectionTitle };
