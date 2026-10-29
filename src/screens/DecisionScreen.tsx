import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  ChevronLeft,
  CircleSlash,
  Download,
  FileSpreadsheet,
  Filter,
  ImageIcon,
  Pill,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { toast } from "../lib/toast";
import { orderedCases, monthlyList } from "../lib/engine";
import { progressSummary } from "../lib/eligibility";
import type { CaseRecord, MonthlyCheck } from "../lib/types";
import { Badge, Button, Card, EmptyState, SectionTitle, Stat } from "../components/ui";
import { RxImage, RxLightbox, RxLinkButton, SOURCE_LABEL } from "../components/RxViewer";
import { SabDrugsView } from "../components/SabDrugsView";
import { cn } from "../lib/utils";
import { reportSave } from "../lib/saveFeedback";
type ExcelModule = typeof import("../lib/excel");
// مكتبة الإكسل بتتحمّل وقت التصدير بس — فتح البرنامج أسرع بكتير
const excel = () => import("../lib/excel") as Promise<ExcelModule>;

type Tab = "all" | "undecided" | "drugs" | "sabdrugs" | "nodrugs" | "failed" | "invalid";

export function DecisionScreen({
  onRetry,
  onRescanSab,
}: {
  onRetry: (c: CaseRecord) => Promise<void>;
  onRescanSab: (sab: string) => Promise<void>;
}) {
  const cases = useAppStore((s) => s.cases);
  const caseOrder = useAppStore((s) => s.caseOrder);
  const monthly = useAppStore((s) => s.monthly);
  const viewerId = useAppStore((s) => s.viewerId);
  const setViewer = useAppStore((s) => s.setViewer);
  const setHasDrugs = useAppStore((s) => s.setHasDrugs);
  const setSabDecision = useAppStore((s) => s.setSabDecision);
  const undoLastDecision = useAppStore((s) => s.undoLastDecision);
  const history = useAppStore((s) => s.history);
  const setMonthlyConfirmed = useAppStore((s) => s.setMonthlyConfirmed);
  const setScreen = useAppStore((s) => s.setScreen);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const logLine = useAppStore((s) => s.logLine);
  const patients = useAppStore((s) => s.patients);

  /** التصدير كله بيكتب ملف حقيقي على القرص ويرجّع مساره */
  const exportAnalysisFile = async () => {
    const x = await excel();
    reportSave(await x.exportAnalysis(all), "تصدير جرد الاستمارات");
  };

  const exportDrugsFile = async () => {
    const x = await excel();
    reportSave(await x.exportWithDrugs(all), "تصدير إكسل بها دواء");
  };

  const exportPreApprovalFile = async () => {
    const x = await excel();
    reportSave(await x.exportPreApproval(all), "تصدير إكسل Pre-Approval");
  };

  /** إكسل الشهري: كتابة حقيقية على القرص + مسار الملف في الإشعار */
  const exportMonthlyFile = async () => {
    const x = await excel();
    reportSave(await x.exportMonthly(monthlyRows), "تصدير إكسل الشهري");
  };

  // ٧٨) الافتراضي «لم يُحسم» — الشاشة بتفتح على اللي محتاج شغل مش على الأرشيف
  const [tab, setTab] = useState<Tab>("undecided");
  const [query, setQuery] = useState("");
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [undoNote, setUndoNote] = useState("");
  const [showMonthly, setShowMonthly] = useState(true);

  const all = useMemo(() => orderedCases(caseOrder, cases), [caseOrder, cases]);
  const stats = progressSummary(all);
  const monthlyRows = useMemo(() => monthlyList(monthly), [monthly]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return all.filter((c) => {
      if (q && !`${c.patientName} ${c.sab} ${c.phone} ${c.reference}`.includes(q)) return false;
      switch (tab) {
        case "undecided":
          return c.valid && c.hasDrugs === null;
        case "drugs":
        case "sabdrugs":
          return c.hasDrugs === "available";
        case "nodrugs":
          return c.hasDrugs === "unavailable";
        case "failed":
          return c.rx.status === "failed";
        case "invalid":
          return !c.valid;
        default:
          return true;
      }
    });
  }, [all, query, tab]);

  /**
   * ١٠٥) تجميع استمارات كل ساب: القرار في الصرف بيبقى للساب كله،
   * فبنعرض الساب الواحد مرة واحدة بعدد استماراته والمحسوم منها.
   */
  const sabGroups = useMemo(() => {
    const map = new Map<
      string,
      { sab: string; name: string; phone: string; total: number; decided: number; withDrugs: number; ids: string[] }
    >();
    for (const c of all) {
      if (!c.valid) continue;
      let g = map.get(c.sab);
      if (!g) {
        g = { sab: c.sab, name: c.patientName, phone: c.phone, total: 0, decided: 0, withDrugs: 0, ids: [] };
        map.set(c.sab, g);
      }
      g.total += 1;
      g.ids.push(c.id);
      if (c.hasDrugs !== null) g.decided += 1;
      if (c.hasDrugs === "available") g.withDrugs += 1;
    }
    return [...map.values()].sort((a, b) => b.total - b.decided - (a.total - a.decided));
  }, [all]);

  const decideSab = (sab: string, value: "available" | "unavailable") => {
    const n = setSabDecision(sab, value);
    logLine("ok", `قرار جماعي على ساب ${sab}: ${value === "available" ? "بها دواء" : "بدون دواء"} — ${n} استمارة.`);
    // إشعار فيه تراجع فوري — القرار الجماعي بيلمس استمارات كتير، لازم يكون رجعته بضغطة
    toast.ok(`ساب ${sab}: ${value === "available" ? "بها دواء" : "بدون دواء"} (${n} استمارة)`, {
      action: { label: "تراجع", run: () => undo() },
    });
  };

  const undo = () => {
    const last = undoLastDecision();
    if (!last) {
      logLine("warn", "مفيش قرار للتراجع عنه.");
      return;
    }
    setUndoNote(`تم التراجع عن قرار ساب ${last.sab} — رجع «${last.prev === "available" ? "بها دواء" : last.prev === "unavailable" ? "بدون دواء" : "غير محدد"}».`);
    setTimeout(() => setUndoNote(""), 4000);
  };

  const viewer = viewerId ? cases[viewerId] ?? null : null;
  const lastDecisionId = useAppStore((s) => s.lastDecisionId);
  const lastDecision = lastDecisionId ? cases[lastDecisionId] : null;

  /** ٧٧) الروشتة اللي بعدها في نفس الفلتر — عشان القرار يمشي بسرعة */
  const nextCase = (fromId?: string) => {
    const list = filtered.filter((c) => c.valid && c.hasDrugs === null && c.rx.status === "ready");
    const idx = fromId ? list.findIndex((c) => c.id === fromId) : -1;
    return list[idx + 1] ?? (idx === -1 ? list[0] : undefined);
  };

  const decideAndNext = (c: CaseRecord, value: "available" | "unavailable") => {
    setHasDrugs(c.id, value);
    const next = nextCase(c.id);
    if (next) setViewer(next.id);
    else setViewer(null);
    // تأكيد + تراجع في نفس المكان: مفيش نافذة بتقطع الشغل، ولو غلطت رجّعت بضغطة
    toast.info(`${c.sab} — ${value === "available" ? "بها دواء" : "بدون دواء"}`, {
      action: { label: "تراجع", run: () => undo() },
      ttl: 3500,
    });
  };

  /**
   * ٢٦) تحميل الصور اللي بعد كده مسبقًا (٣ قدام) — القرار بيمشي بسرعة
   * من غير ما نستنى IndexedDB في كل روشتة.
   */
  useEffect(() => {
    if (!viewerId) return;
    const list = filtered.filter((c) => c.valid && c.hasDrugs === null && c.rx.status === "ready");
    const idx = list.findIndex((c) => c.id === viewerId);
    if (idx < 0) return;
    let alive = true;
    void import("../lib/imageCache").then(({ getCachedImage, putCachedImage }) =>
      import("../lib/imageStore").then(({ loadImage }) => {
        for (const c of list.slice(idx + 1, idx + 4)) {
          if (getCachedImage(c.id)) continue;
          void loadImage(c.id).then((url) => {
            if (alive && url) putCachedImage(c.id, url);
          });
        }
      }),
    );
    return () => {
      alive = false;
    };
  }, [viewerId, filtered]);

  // ٧٦) اختصارات لوحة المفاتيح: ١ بها دواء، ٢ بدون، مسافة = اللي بعدها
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const current = viewerId ? cases[viewerId] : null;
      if (e.key === "1" && current) {
        e.preventDefault();
        decideAndNext(current, "available");
      } else if (e.key === "2" && current) {
        e.preventDefault();
        decideAndNext(current, "unavailable");
      } else if (e.key === " ") {
        e.preventDefault();
        setViewer(nextCase(viewerId ?? undefined)?.id ?? null);
      } else if (e.key === "Escape" && viewerId) {
        setViewer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
    for (const c of all.filter((x) => x.rx.status === "failed")) await handleRetry(c);
  };

  const validCount = all.filter((c) => c.valid).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="كل الاستمارات" value={stats.total} />
        <Stat label="داخل المدة" value={stats.valid} tone="ok" />
        <Stat label="صور جاهزة" value={stats.ready} tone="ok" />
        <Stat label="بها دواء" value={stats.withDrugs} tone="ok" />
        <Stat label="بدون دواء" value={stats.withoutDrugs} />
        <Stat label="متعثرة" value={stats.failed} tone="bad" />
      </div>

      {undoNote ? (
        <div className="rounded-xl border border-teal-500/25 bg-teal-500/10 px-4 py-2 text-xs text-teal-200">
          {undoNote}
        </div>
      ) : null}

      {stats.failed > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {stats.failed} استمارة صورتها لسه مش متاحة — كل واحدة بعلامة حمراء وسببها وزرار إعادة الجلب.
          </div>
          <div className="flex items-center gap-2">
            {/* ١٠٦) تراجع عن آخر قرار */}
            <Button size="sm" variant="ghost" onClick={undo} disabled={!history.length}>
              <RotateCcw className="h-3.5 w-3.5" /> تراجع (Ctrl+Z)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void retryAllFailed()}>
              <RefreshCw className="h-3.5 w-3.5" /> إعادة جلب الكل
            </Button>
          </div>
        </div>
      ) : null}

      {/* ١٠٥) قرار جماعي لكل استمارات الساب */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle hint={`${sabGroups.length} ساب`}>قرار جماعي للساب — استماراته كلها مرة واحدة</SectionTitle>
          {history.length ? (
            <Button size="sm" variant="ghost" onClick={undo}>
              <RotateCcw className="h-3.5 w-3.5" /> تراجع عن آخر قرار
            </Button>
          ) : null}
        </div>
        {sabGroups.length === 0 ? (
          <EmptyState title="مفيش استمارات داخل المدة" body="ابدأ الجرد من شاشة الإعداد أولًا." />
        ) : (
          <div className="max-h-72 overflow-auto rounded-xl border border-white/10">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-[#0f1b1e] text-white/50">
                <tr>
                  <th className="px-3 py-2 font-medium">الساب</th>
                  <th className="px-3 py-2 font-medium">الاسم</th>
                  <th className="px-3 py-2 font-medium">استمارات</th>
                  <th className="px-3 py-2 font-medium">محسوم</th>
                  <th className="px-3 py-2 font-medium">بها دواء</th>
                  <th className="px-3 py-2 font-medium">القرار الجماعي</th>
                </tr>
              </thead>
              <tbody>
                {sabGroups.map((g) => (
                  <tr key={g.sab} className="border-t border-white/5">
                    <td className="px-3 py-1.5 tabular-nums text-white/80">{g.sab}</td>
                    <td className="max-w-[160px] truncate px-3 py-1.5 text-white/70">{g.name || "—"}</td>
                    <td className="px-3 py-1.5 tabular-nums text-white/70">{g.total}</td>
                    <td className="px-3 py-1.5 tabular-nums text-white/50">
                      {g.decided}/{g.total}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-emerald-300">{g.withDrugs || "—"}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="success" onClick={() => decideSab(g.sab, "available")}>
                          <Pill className="h-3 w-3" /> الكل بها دواء
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => decideSab(g.sab, "unavailable")}>
                          <CircleSlash className="h-3 w-3" /> الكل بدون
                        </Button>
                        <Button size="sm" variant="muted" onClick={() => setViewer(g.ids[0])}>
                          عرض الاستمارات
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* الشهري */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle hint={`${monthlyRows.length} ساب`}>الشهري متاح أم لا — أكّد لكل ساب</SectionTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => void exportMonthlyFile()}>
              <Download className="h-3.5 w-3.5" /> إكسل الشهري
            </Button>
            <button
              onClick={() => setShowMonthly((v) => !v)}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:bg-white/5"
            >
              {showMonthly ? "إخفاء" : "إظهار"}
            </button>
          </div>
        </div>
        {showMonthly ? (
          monthlyRows.length === 0 ? (
            <EmptyState title="مفيش بيانات شهري" body="الشهري بيتحسب من عمود النوع في الجدولين بعد الجرد." />
          ) : (
            <div className="max-h-80 overflow-auto rounded-xl border border-white/10">
              <table className="w-full text-right text-xs">
                <thead className="sticky top-0 bg-[#0f1b1e] text-white/50">
                  <tr>
                    <th className="px-3 py-2 font-medium">الساب</th>
                    <th className="px-3 py-2 font-medium">الاسم</th>
                    <th className="px-3 py-2 font-medium">التليفون</th>
                    <th className="px-3 py-2 font-medium">آخر شهري</th>
                    <th className="px-3 py-2 font-medium">حسب القاعدة</th>
                    <th className="px-3 py-2 font-medium">التأكيد</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map((m) => (
                    <MonthlyRow
                      key={m.sab}
                      m={m}
                      onConfirm={(v) => setMonthlyConfirmed(m.sab, v)}
                      onRescan={async () => {
                        const patient = patients.find((p) => p.sab === m.sab);
                        if (patient) await onRescanSab(patient.sab);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </Card>

      {/* الاستمارات */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الساب أو التليفون أو الرقم المرجعي…"
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pe-9 ps-3 text-sm text-white placeholder:text-white/30 focus:border-teal-400/60 focus:outline-none"
            />
          </div>
          <select
            value={settings.workplace}
            onChange={(e) => setSettings({ workplace: e.target.value })}
            className="rounded-xl border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-white focus:outline-none"
          >
            <option value="">كل أماكن العمل</option>
            {[...new Set(all.map((c) => c.workplace).filter(Boolean))].map((w) => (
              <option key={w} value={w} className="bg-[#0b1518]">
                {w}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
            {(
              [
                ["all", "الكل"],
                ["undecided", "لم يُحسم"],
                ["drugs", "بها دواء"],
                ["sabdrugs", "ساب بها دواء"],
                ["nodrugs", "بدون دواء"],
                ["failed", "متعثر"],
                ["invalid", "خارج المدة"],
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition",
                  tab === key ? "bg-teal-500 text-[#04201c]" : "text-white/60 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => void exportAnalysisFile()}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> جرد الاستمارات
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void exportDrugsFile()}>
            <Pill className="h-3.5 w-3.5" /> بها دواء
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void exportPreApprovalFile()}>
            <ShieldCheck className="h-3.5 w-3.5" /> Pre-Approval
          </Button>
          {/* ٧٩) استكمال من مكان الوقوف */}
          {lastDecision && !viewerId ? (
            <Button size="sm" variant="ghost" onClick={() => setViewer(lastDecision.id)}>
              <ChevronLeft className="h-3.5 w-3.5" /> استكمال من {lastDecision.patientName || lastDecision.sab}
            </Button>
          ) : null}
          <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/40">
            1 بها دواء · 2 بدون · مسافة التالي
          </span>
        </div>

        {tab === "sabdrugs" ? (
          <SabDrugsView cases={cases} query={query} onOpen={(id) => setViewer(id)} />
        ) : filtered.length === 0 ? (
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
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((c) => (
              <CaseCard
                key={c.id}
                c={c}
                retrying={retrying.has(c.id)}
                onOpen={() => setViewer(c.id)}
                onRetry={() => void handleRetry(c)}
                onDrugs={(v) => {
                  if (viewerId === c.id) decideAndNext(c, v);
                  else setHasDrugs(c.id, v);
                }}
              />
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0b1518]/70 px-4 py-3">
        <div className="text-xs text-white/50">
          {stats.withDrugs} استمارة بها دواء • {monthlyRows.filter((m) => (m.confirmed ?? m.computed) === "available").length} ساب
          الشهري متاح • {stats.decided}/{validCount} قرار محسوم
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setScreen("run")}>
            شاشة التشغيل
          </Button>
          <Button
            variant="success"
            onClick={() => {
              if (!stats.decided) {
                logLine("warn", "لسه مفيش قرارات — حدد «بها دواء» أو «بدون دواء» الأول.");
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

function MonthlyRow({
  m,
  onConfirm,
  onRescan,
}: {
  m: MonthlyCheck;
  onConfirm: (v: "available" | "unavailable" | null) => void;
  onRescan: () => Promise<void>;
}) {
  const effective = m.confirmed ?? m.computed;
  const [busy, setBusy] = useState(false);
  return (
    <tr className="border-t border-white/5">
      <td className="px-3 py-1.5 tabular-nums text-white/80">{m.sab}</td>
      <td className="px-3 py-1.5 text-white/80">{m.patientName}</td>
      <td className="px-3 py-1.5 tabular-nums text-white/60" dir="ltr">
        {m.phone}
      </td>
      <td className="px-3 py-1.5 text-white/60">
        {m.lastMonthlyDate ? (
          <span title={m.reason}>
            {m.lastMonthlyDate} <span className="text-white/35">({m.lastMonthlyRef})</span>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-1.5">
        <Badge tone={m.computed === "available" ? "ok" : "bad"}>
          {m.computed === "available" ? "متاح" : `غير متاح (${m.daysSince} يوم)`}
        </Badge>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1">
          {(["available", "unavailable"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onConfirm(m.confirmed === v ? null : v)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[10px] font-semibold transition",
                effective === v
                  ? v === "available"
                    ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                    : "border-rose-400/50 bg-rose-500/20 text-rose-200"
                  : "border-white/10 text-white/45 hover:bg-white/5",
              )}
            >
              {v === "available" ? "متاح" : "غير متاح"}
            </button>
          ))}
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await onRescan();
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md border border-white/10 p-0.5 text-white/40 hover:bg-white/5"
            title="إعادة جرد الساب"
          >
            <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function CaseCard({
  c,
  retrying,
  onOpen,
  onRetry,
  onDrugs,
}: {
  c: CaseRecord;
  retrying: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onDrugs: (v: "available" | "unavailable") => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

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
      { rootMargin: "350px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-[#081114]", c.valid ? "border-white/10" : "border-white/5 opacity-80")}>
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-white">{c.patientName}</div>
          <div className="truncate text-[11px] text-white/45">
            ساب {c.sab} • مرجع {c.reference}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <Badge tone={c.source === "pre-approval" ? "info" : "neutral"}>{SOURCE_LABEL[c.source] ?? c.source}</Badge>
            {c.monthly ? <Badge tone="warn">شهري</Badge> : null}
            <Badge tone={c.valid ? "ok" : "bad"}>
              <CalendarClock className="h-3 w-3" /> {c.formDate || "—"}
            </Badge>
            {c.deleted ? <Badge tone="warn">تم الإرجاع</Badge> : null}
          </div>
        </div>
        {c.rx.status === "ready" ? (
          <Badge tone="ok">
            <ImageIcon className="h-3 w-3" /> صورة
          </Badge>
        ) : c.rx.status === "failed" ? (
          <Badge tone="bad">
            <XCircle className="h-3 w-3" /> فشل
          </Badge>
        ) : (
          <Badge tone="warn">
            <RefreshCw className="h-3 w-3 animate-spin" /> جارٍ
          </Badge>
        )}
      </div>

      <div ref={mountRef} className="px-3 pt-2">
        {visible ? (
          <button onClick={onOpen} className="block w-full cursor-zoom-in" aria-label={`عرض روشتة ${c.sab}`}>
            <RxImage c={c} className="max-h-56" onRetry={onRetry} />
          </button>
        ) : (
          <div className="flex aspect-[3/4] max-h-56 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-xs text-white/25">
            …
          </div>
        )}
      </div>

      <div className="px-3 pb-1">
        <RxLinkButton c={c} />
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        {c.rx.status === "failed" ? (
          <Button size="sm" variant="ghost" className="w-full" onClick={onRetry} disabled={retrying}>
            <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} /> {retrying ? "جارٍ الجلب…" : "إعادة الجلب"}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="w-full" onClick={onOpen}>
            <ChevronLeft className="h-3.5 w-3.5" /> عرض بالكامل
          </Button>
        )}
      </div>

      <div className="border-t border-white/10 px-3 py-2.5">
        {!c.valid ? (
          <div className="flex items-center gap-1.5 text-[11px] text-rose-300">
            <CircleSlash className="h-3 w-3" /> {c.validityReason}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => onDrugs("available")}
              className={cn(
                "flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition",
                c.hasDrugs === "available"
                  ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                  : "border-white/10 bg-black/20 text-white/55 hover:bg-white/5",
              )}
            >
              <BadgeCheck className="h-3 w-3" /> بها دواء
            </button>
            <button
              onClick={() => onDrugs("unavailable")}
              className={cn(
                "flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition",
                c.hasDrugs === "unavailable"
                  ? "border-rose-400/50 bg-rose-500/20 text-rose-200"
                  : "border-white/10 bg-black/20 text-white/55 hover:bg-white/5",
              )}
            >
              <XCircle className="h-3 w-3" /> بدون دواء
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
