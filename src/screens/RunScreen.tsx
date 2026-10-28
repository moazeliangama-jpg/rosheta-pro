import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Download, Gauge, ListChecks, Pause, Play, Square, Timer, Zap } from "lucide-react";
import { useAppStore } from "../lib/store";
import { progressOf } from "../lib/eligibility";
import { exportFailed } from "../lib/excel";
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
  const samples = useAppStore((s) => s.samples);
  const failed = useAppStore((s) => s.failed);
  const setSettings = useAppStore((s) => s.setSettings);
  const settings = useAppStore((s) => s.settings);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const list = Object.values(cases);
  const stats = progressOf(list);
  const running = session.state === "running" || session.state === "paused";
  const elapsed = session.startedAt ? (session.endedAt ?? now) - session.startedAt : 0;
  const pct = stats.total ? Math.round(((stats.ready + stats.failed) / stats.total) * 100) : 0;

  const last = samples[samples.length - 1];
  const first = samples[0];
  const span = last && first ? Math.max((last.at - first.at) / 60000, 0.1) : 0;
  const rate = last && first ? (last.done - first.done) / span : 0;
  const remaining = rate > 0 ? Math.max(0, (stats.total - stats.ready - stats.failed) / rate) : null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-teal-500/15 p-2.5">
              <Activity className={running ? "h-5 w-5 animate-pulse text-teal-300" : "h-5 w-5 text-white/40"} />
            </div>
            <div>
              <div className="text-sm font-bold text-white">
                {session.state === "running"
                  ? "الجلسة شغّالة"
                  : session.state === "paused"
                    ? "الجلسة متوقفة مؤقتًا"
                    : session.state === "done"
                      ? "الجلسة انتهت"
                      : "لسه مفيش جلسة"}
              </div>
              <div className="text-xs text-white/45">
                {session.startedAt ? `بدأت ${nowTime(session.startedAt)}` : "ابدأ من شاشة الإعداد"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {session.state === "running" ? (
              <Button variant="ghost" onClick={onPause}>
                <Pause className="h-4 w-4" /> إيقاف مؤقت
              </Button>
            ) : null}
            {session.state === "paused" ? (
              <Button onClick={onResume}>
                <Play className="h-4 w-4" /> استكمال
              </Button>
            ) : null}
            {running ? (
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
              {stats.ready + stats.failed} / {stats.total} استمارة
            </span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="وقت الجلسة" value={<span className="inline-flex items-center gap-1"><Timer className="h-4 w-4" />{elapsedLabel(elapsed)}</span>} />
          <Stat label="المتبقي المتوقع" value={remaining !== null ? `${arNum(Math.ceil(remaining))} د` : "—"} />
          <Stat label="السرعة" value={`${arNum(rate)} /د`} tone="ok" />
          <Stat label="صور جاهزة" value={stats.ready} tone="ok" />
          <Stat label="قيد الجلب" value={stats.loading} tone="warn" />
          <Stat label="متعثرة" value={stats.failed} tone="bad" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="info">
            <Gauge className="h-3 w-3" /> {session.workers} نوافذ {session.autoWorkers ? "(تلقائي)" : ""}
          </Badge>
          <Badge tone={session.fastMode ? "ok" : "neutral"}>
            <Zap className="h-3 w-3" /> {session.fastMode ? "الوضع السريع" : "الوضع الآمن"}
          </Badge>
          <Badge tone={settings.preventDelete ? "ok" : "neutral"}>
            {settings.preventDelete ? "منع الإرجاع مفعّل" : "الإرجاع مسموح"}
          </Badge>
          <button
            onClick={() => setSettings({ fastMode: !settings.fastMode })}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:bg-white/5"
          >
            تبديل السرعة
          </button>
          <button
            onClick={() => setSettings({ preventDelete: !settings.preventDelete })}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:bg-white/5"
          >
            تبديل منع الإرجاع
          </button>
        </div>

        {session.decisions.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {session.decisions.slice(0, 4).map((d, i) => (
              <Badge key={i} tone="neutral">
                {d}
              </Badge>
            ))}
          </div>
        ) : null}
      </Card>

      {stats.failed > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            {stats.failed} استمارة متعثرة (اتخطّت والجلسة كملت) — التفاصيل في القرار أو الإكسل.
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              exportFailed(failed, {
                "مدة الجلسة": elapsedLabel(elapsed),
                "عدد الاستمارات": stats.total,
                "الصور الجاهزة": stats.ready,
                "المتعثرة": stats.failed,
              })
            }
          >
            <Download className="h-3.5 w-3.5" /> تصدير إكسل المتعثرين
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-white/10 px-4 py-3">
            <SectionTitle hint={`${log.length} سطر`}>سجل التشغيل</SectionTitle>
          </div>
          <div className="max-h-72 space-y-1 overflow-auto p-3 font-mono text-[11px]" dir="rtl">
            {log.length === 0 ? (
              <div className="py-6 text-center text-white/35">لسه مفيش أحداث</div>
            ) : (
              log.slice(0, 200).map((l) => (
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
            <SectionTitle hint={`${failed.length} سطر`}>السابات المتعثرة</SectionTitle>
          </div>
          <div className="max-h-72 overflow-auto">
            {failed.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-10 text-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                <span className="text-xs text-white/45">مفيش تعثرات — كل حاجة رجعت</span>
              </div>
            ) : (
              <table className="w-full text-right text-[11px]">
                <thead className="sticky top-0 bg-[#0f1b1e] text-white/50">
                  <tr>
                    <th className="px-3 py-2 font-medium">الساب</th>
                    <th className="px-3 py-2 font-medium">الخطوة</th>
                    <th className="px-3 py-2 font-medium">السبب</th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((f) => (
                    <tr key={f.id} className="border-t border-white/5">
                      <td className="px-3 py-1.5 tabular-nums text-white/80">{f.sab}</td>
                      <td className="px-3 py-1.5 text-amber-300">{f.step}</td>
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
        <EmptyState title="مفيش استمارات في الجلسة" body="ارجع لشاشة الإعداد وارفع ملف Excel أو حمّل البيانات التجريبية." />
      ) : null}
    </div>
  );
}
