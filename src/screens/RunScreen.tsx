import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Gauge,
  ImageDown,
  ListChecks,
  Pause,
  Play,
  Search,
  Square,
  Timer,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { progressSummary } from "../lib/eligibility";
import { SpeedPanel } from "../components/SpeedPanel";
import { Badge, Button, Card, EmptyState, Progress, SectionTitle, Stat } from "../components/ui";
import { arNum, elapsedLabel, nowTime } from "../lib/utils";

export function RunScreen({
  onPause,
  onResume,
  onStop,
  onDecision,
}: {
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDecision: () => void;
}) {
  const session = useAppStore((s) => s.session);
  const cases = useAppStore((s) => s.cases);
  const log = useAppStore((s) => s.log);
  const failed = useAppStore((s) => s.failed);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const list = Object.values(cases);
  const stats = progressSummary(list);
  const busy = session.state === "scanning" || session.state === "running" || session.state === "paused";
  const elapsed = session.startedAt ? (session.endedAt ?? now) - session.startedAt : 0;

  const total = session.phase === "images" ? session.formsTotal : session.subsTotal;
  const done = session.phase === "images" ? session.formsDone : session.subsDone;
  const pct = total ? Math.round((done / total) * 100) : 0;

  // معدل حقيقي من عدادات الجلسة (مش من العينات) — أدق وأسرع
  const rate = session.formsPerMin || 0;
  const remainingMin = session.etaMin;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-teal-500/15 p-2.5">
              <Activity className={busy ? "h-5 w-5 animate-pulse text-teal-300" : "h-5 w-5 text-white/40"} />
            </div>
            <div>
              <div className="text-sm font-bold text-white">
                {session.state === "scanning"
                  ? "المرحلة ١: جرد الاستمارات من نايس دير"
                  : session.state === "running"
                    ? "المرحلة ٢: جلب صور الروشتات"
                    : session.state === "paused"
                      ? "متوقف مؤقتًا"
                      : session.state === "done"
                        ? "التشغيل انتهى"
                        : "مفيش تشغيل"}
              </div>
              <div className="text-xs text-white/45">
                {session.startedAt ? `بدأ ${nowTime(session.startedAt)}` : "ابدأ من شاشة الإعداد"}
                {session.workers ? ` • ${session.workers} نوافذ` : ""}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {session.state === "running" || session.state === "scanning" ? (
              <Button variant="ghost" onClick={onPause}>
                <Pause className="h-4 w-4" /> إيقاف مؤقت
              </Button>
            ) : null}
            {session.state === "paused" ? (
              <Button onClick={onResume}>
                <Play className="h-4 w-4" /> استكمال
              </Button>
            ) : null}
            {busy ? (
              <Button variant="danger" onClick={onStop}>
                <Square className="h-4 w-4" /> إيقاف
              </Button>
            ) : null}
            <Button variant="success" onClick={onDecision}>
              <ListChecks className="h-4 w-4" /> شاشة القرار
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>
              {session.phase === "images" ? (
                <>
                  <ImageDown className="ml-1 inline h-3 w-3" /> {done} / {total} استمارة
                </>
              ) : (
                <>
                  <Search className="ml-1 inline h-3 w-3" /> {done} / {total} ساب
                </>
              )}
            </span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="وقت التشغيل"
            value={
              <span className="inline-flex items-center gap-1">
                <Timer className="h-4 w-4" />
                {elapsedLabel(elapsed)}
              </span>
            }
          />
          <Stat label="المتبقي المتوقع" value={remainingMin !== null ? `${arNum(Math.ceil(remainingMin))} د` : "—"} />
          <Stat label="استمارة/دقيقة" value={arNum(rate)} tone="ok" />
          <Stat label="متوسط الالتقاط" value={session.avgCaptureMs ? `${session.avgCaptureMs} ms` : "—"} />
          <Stat label="متوسط البحث" value={session.avgSearchMs ? `${session.avgSearchMs} ms` : "—"} />
          <Stat label="صور جاهزة" value={stats.ready} tone="ok" />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone="info">
            <Gauge className="h-3 w-3" /> {session.workers} نوافذ متوازية
          </Badge>
          {session.turbo ? <Badge tone="ok">وضع مرعب ⚡</Badge> : <Badge tone="neutral">وضع عادي</Badge>}
          {session.deletePending > 0 ? <Badge tone="warn">Delete في الخلفية: {session.deletePending}</Badge> : null}
          <Badge tone={stats.withDrugs ? "ok" : "neutral"}>بها دواء: {stats.withDrugs}</Badge>
          <Badge tone="neutral">بدون دواء: {stats.withoutDrugs}</Badge>
          <Badge tone="warn">خارج المدة: {stats.invalid}</Badge>
          <Badge tone={stats.failed ? "bad" : "ok"}>متعثرة: {stats.failed}</Badge>
        </div>
      </Card>

      {stats.failed > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            {stats.failed} استمارة متعثرة — اتخطّت والجلسة كملت، وتقدر تعيدها من شاشة القرار.
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // تحميل مكتبة الإكسل وقت التصدير بس — البرنامج بيفتح أسرع
              void import("../lib/excel").then((x) =>
                x.exportFailed(failed, {
                  "مدة التشغيل": elapsedLabel(elapsed),
                  "عدد الاستمارات": stats.total,
                  "صور جاهزة": stats.ready,
                  "متعثرة": stats.failed,
                }),
              );
            }}
          >
            <Download className="h-3.5 w-3.5" /> إكسل المتعثرين
          </Button>
        </div>
      ) : null}

      <SpeedPanel />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-white/10 px-4 py-3">
            <SectionTitle hint={`${log.length} سطر`}>سجل التشغيل الحقيقي</SectionTitle>
          </div>
          <div className="max-h-80 space-y-1 overflow-auto p-3 font-mono text-[11px]" dir="rtl">
            {log.length === 0 ? (
              <div className="py-6 text-center text-white/35">لسه مفيش أحداث</div>
            ) : (
              log.slice(0, 250).map((l) => (
                <div key={l.id} className="flex gap-2">
                  <span className="shrink-0 text-white/25">{nowTime(l.at)}</span>
                  <span
                    className={
                      l.level === "error"
                        ? "text-rose-300"
                        : l.level === "warn"
                          ? "text-amber-300"
                          : l.level === "ok"
                            ? "text-emerald-300"
                            : "text-white/60"
                    }
                  >
                    {l.msg}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-0">
          <div className="border-b border-white/10 px-4 py-3">
            <SectionTitle hint={`${failed.length} سطر`}>المتعثرات</SectionTitle>
          </div>
          <div className="max-h-80 overflow-auto">
            {failed.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-10 text-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                <span className="text-xs text-white/45">مفيش تعثرات</span>
              </div>
            ) : (
              <table className="w-full text-right text-[11px]">
                <thead className="sticky top-0 bg-[#0f1b1e] text-white/50">
                  <tr>
                    <th className="px-3 py-2 font-medium">الساب</th>
                    <th className="px-3 py-2 font-medium">الخطوة</th>
                    <th className="px-3 py-2 font-medium">المرجع</th>
                    <th className="px-3 py-2 font-medium">السبب</th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((f) => (
                    <tr key={f.id} className="border-t border-white/5">
                      <td className="px-3 py-1.5 tabular-nums text-white/80">{f.sab}</td>
                      <td className="px-3 py-1.5 text-amber-300">{f.step}</td>
                      <td className="px-3 py-1.5 tabular-nums text-white/60">{f.reference || "—"}</td>
                      <td className="px-3 py-1.5 text-white/50">{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      {!list.length ? (
        <EmptyState
          title="مفيش جرد لسه"
          body="ارجع للإعداد، اختار الباير وارفع ملف السابات، واضغط «جرد الاستمارات» — الجرد بيقرأ الجدولين من نايس دير فعليًا."
        />
      ) : null}
    </div>
  );
}
