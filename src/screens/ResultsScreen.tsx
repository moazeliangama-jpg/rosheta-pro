import { useMemo, useRef, useState } from "react";
import {
  CheckCheck,
  Download,
  MessageCircle,
  RefreshCw,
  Send,
  ThumbsDown,
  ThumbsUp,
  Timer,
  UserRound,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { orderedCases, monthlyList } from "../lib/engine";
import { buildOutreachQueue, classifyReply, replyStats } from "../lib/whatsapp";
import { exportApproved, exportSessionReport, exportWithDrugs } from "../lib/excel";
import { Badge, Button, Card, EmptyState, Progress, SectionTitle, Stat } from "../components/ui";
import { bridge } from "../lib/provider";
import { cn, nowTime } from "../lib/utils";
import type { OutreachMessage } from "../lib/types";

const KIND_LABEL: Record<OutreachMessage["kind"], string> = {
  drugs: "بها دواء",
  monthly: "شهري متاح",
};

const REPLY_LABEL: Record<OutreachMessage["reply"], string> = {
  approved: "موافق",
  rejected: "رافض",
  postpone: "طلب تأجيل",
  pending: "معلّق",
};

export function ResultsScreen() {
  const cases = useAppStore((s) => s.cases);
  const caseOrder = useAppStore((s) => s.caseOrder);
  const monthly = useAppStore((s) => s.monthly);
  const outreach = useAppStore((s) => s.outreach);
  const addOutreach = useAppStore((s) => s.addOutreach);
  const patchOutreach = useAppStore((s) => s.patchOutreach);
  const settings = useAppStore((s) => s.settings);
  const session = useAppStore((s) => s.session);
  const failed = useAppStore((s) => s.failed);
  const samples = useAppStore((s) => s.samples);
  const logLine = useAppStore((s) => s.logLine);
  const setScreen = useAppStore((s) => s.setScreen);

  const [busy, setBusy] = useState<"build" | "send" | "sync" | null>(null);
  const [sendProgress, setSendProgress] = useState({ done: 0, total: 0 });
  const stopRef = useRef(false);

  const all = useMemo(() => orderedCases(caseOrder, cases), [caseOrder, cases]);
  const stats = replyStats(outreach);
  const monthlyRows = useMemo(() => monthlyList(monthly), [monthly]);
  const approvedSabs = new Set(outreach.filter((m) => m.reply === "approved").map((m) => m.sab));

  const prepare = () => {
    setBusy("build");
    const queue = buildOutreachQueue(all, monthly, settings, outreach);
    if (!queue.length) {
      logLine("warn", "مفيش رسائل جديدة — تأكد إن فيه استمارات «بها دواء» أو ساب الشهري متاح له ومتأكد.");
    } else {
      addOutreach(queue);
      logLine("ok", `تم تجهيز ${queue.length} رسالة واتساب.`);
    }
    setBusy(null);
  };

  const sendOne = async (m: OutreachMessage) => {
    const b = bridge();
    if (!b) return { ok: false, error: "نسخة سطح المكتب مطلوبة" };
    patchOutreach(m.id, { status: "sending" });
    const res = await b.wa.send({ phone: m.phone, text: m.text });
    if (res.ok) {
      patchOutreach(m.id, { status: "sent", at: Date.now(), error: undefined });
      return { ok: true };
    }
    patchOutreach(m.id, { status: "failed", error: res.error });
    return { ok: false, error: res.error };
  };

  const sendAll = async () => {
    const pending = outreach.filter((m) => m.status === "queued" || m.status === "failed");
    if (!pending.length) {
      logLine("warn", "مفيش رسائل في الانتظار — اضغط «تجهيز الرسائل» الأول.");
      return;
    }
    stopRef.current = false;
    setBusy("send");
    setSendProgress({ done: 0, total: pending.length });
    let okCount = 0;
    for (let i = 0; i < pending.length; i++) {
      if (stopRef.current) break;
      const m = pending[i];
      const res = await sendOne(m);
      if (res.ok) okCount += 1;
      setSendProgress({ done: i + 1, total: pending.length });
      if (i < pending.length - 1) await new Promise((r) => setTimeout(r, settings.sendDelaySec * 1000));
    }
    setBusy(null);
    logLine(okCount === pending.length ? "ok" : "warn", `تم إرسال ${okCount} من ${pending.length} رسالة.`);
  };

  const syncReplies = async () => {
    const b = bridge();
    if (!b) return;
    const sent = outreach.filter((m) => m.status === "sent");
    if (!sent.length) return;
    setBusy("sync");
    let updated = 0;
    for (const m of sent) {
      const res = await b.wa.replies({ phone: m.phone });
      if (res.ok && res.data?.last) {
        const cls = classifyReply(res.data.last, settings);
        patchOutreach(m.id, { reply: cls, replyText: res.data.last, replyAt: Date.now() });
        updated += 1;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    setBusy(null);
    logLine("ok", `تمت مزامنة ${updated} رد من واتساب.`);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="رسائل مجهزة" value={stats.total} />
        <Stat label="أُرسلت" value={stats.sent} tone="ok" />
        <Stat label="فشلت" value={stats.failed} tone="bad" />
        <Stat label="موافقون" value={stats.approved} tone="ok" />
        <Stat label="رافضون" value={stats.rejected} tone="bad" />
        <Stat label="طلب تأجيل" value={stats.postpone} tone="warn" />
      </div>

      <Card>
        <SectionTitle hint={`${all.filter((c) => c.hasDrugs === "available").length} استمارة بها دواء`}>
          ٤. التواصل والنتيجة
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={prepare} disabled={busy === "build"}>
            <MessageCircle className="h-4 w-4" /> تجهيز الرسائل
          </Button>
          <Button onClick={() => void sendAll()} disabled={busy === "send" || !outreach.length}>
            <Send className="h-4 w-4" /> {busy === "send" ? "بيُرسل…" : "إرسال كل الرسائل"}
          </Button>
          {busy === "send" ? (
            <Button variant="danger" onClick={() => (stopRef.current = true)}>
              إيقاف الإرسال
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => void syncReplies()} disabled={busy === "sync" || !stats.sent}>
            <RefreshCw className={cn("h-4 w-4", busy === "sync" && "animate-spin")} /> مزامنة الردود
          </Button>
          <Button variant="ghost" onClick={() => exportApproved(all, outreach)}>
            <Download className="h-4 w-4" /> إكسل الموافقين
          </Button>
          <Button variant="ghost" onClick={() => exportWithDrugs(all)}>
            <Download className="h-4 w-4" /> إكسل بها دواء
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              exportSessionReport({
                cases: all,
                failed,
                samples,
                sessionMs: session.startedAt ? (session.endedAt ?? Date.now()) - session.startedAt : 0,
              })
            }
          >
            <Download className="h-4 w-4" /> تقرير التشغيل
          </Button>
          <Button variant="muted" onClick={() => setScreen("decision")}>
            رجوع للقرار
          </Button>
        </div>

        {busy === "send" ? (
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between text-xs text-white/50">
              <span>إرسال واتساب… {sendProgress.done}/{sendProgress.total}</span>
              <span>{Math.round((sendProgress.done / Math.max(1, sendProgress.total)) * 100)}%</span>
            </div>
            <Progress value={(sendProgress.done / Math.max(1, sendProgress.total)) * 100} />
          </div>
        ) : null}
      </Card>

      <Card className="p-0">
        <div className="border-b border-white/10 px-4 py-3">
          <SectionTitle hint="اضغط على الرد لتعديله يدويًا">الرسائل والردود</SectionTitle>
        </div>
        {outreach.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="لسه مفيش رسائل"
              body="اضغط «تجهيز الرسائل» بعد ما تحدد الاستمارات اللي بها دواء وتأكد الشهري لكل ساب. الرسالة بتتبعت مرة واحدة لكل ساب لكل نوع."
            />
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {outreach.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-white">{m.name}</span>
                    <Badge tone={m.kind === "drugs" ? "ok" : "info"}>{KIND_LABEL[m.kind]}</Badge>
                    <Badge
                      tone={m.status === "sent" ? "ok" : m.status === "failed" ? "bad" : m.status === "sending" ? "warn" : "neutral"}
                    >
                      {m.status === "sent" ? "أُرسلت" : m.status === "sending" ? "بتُرسل" : m.status === "failed" ? "فشلت" : "في الانتظار"}
                    </Badge>
                    <Badge
                      tone={
                        m.reply === "approved"
                          ? "ok"
                          : m.reply === "rejected"
                            ? "bad"
                            : m.reply === "postpone"
                              ? "warn"
                              : "neutral"
                      }
                    >
                      {REPLY_LABEL[m.reply]}
                    </Badge>
                  </div>
                  <div className="truncate text-[11px] text-white/40" dir="ltr">
                    {m.phone} • ساب {m.sab} • {nowTime(m.at)}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-white/50">{m.text}</div>
                  {m.replyText ? (
                    <div className="mt-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white/60">
                      رد العميل: {m.replyText}
                    </div>
                  ) : null}
                  {m.error ? <div className="mt-1 text-[11px] text-rose-300">{m.error}</div> : null}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      ["approved", ThumbsUp, "ok"],
                      ["rejected", ThumbsDown, "bad"],
                      ["postpone", Timer, "warn"],
                      ["pending", UserRound, "neutral"],
                    ] as const
                  ).map(([key, Icon, tone]) => (
                    <button
                      key={key}
                      onClick={() => patchOutreach(m.id, { reply: key, replyAt: Date.now() })}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition",
                        m.reply === key
                          ? tone === "ok"
                            ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                            : tone === "bad"
                              ? "border-rose-400/50 bg-rose-500/20 text-rose-200"
                              : tone === "warn"
                                ? "border-amber-400/50 bg-amber-500/20 text-amber-200"
                                : "border-white/30 bg-white/10 text-white"
                          : "border-white/10 text-white/50 hover:bg-white/5",
                      )}
                      title={REPLY_LABEL[key]}
                    >
                      <Icon className="h-3 w-3" /> {REPLY_LABEL[key]}
                    </button>
                  ))}
                  {m.status !== "sent" ? (
                    <Button size="sm" variant="ghost" onClick={() => void sendOne(m)}>
                      <Send className="h-3 w-3" /> إرسال
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => void bridge()?.wa.openChat({ phone: m.phone, text: m.text })}>
                    فتح المحادثة
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {approvedSabs.size ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCheck className="h-4 w-4" />
            {approvedSabs.size} عميل وافق على الصرف — إكسل الموافقين جاهز للتصدير.
          </div>
          <Button size="sm" variant="ghost" onClick={() => exportApproved(all, outreach)}>
            <Download className="h-3.5 w-3.5" /> تصدير
          </Button>
        </div>
      ) : null}

      {monthlyRows.filter((m) => (m.confirmed ?? m.computed) === "available").length ? (
        <div className="text-[11px] text-white/35">
          ملاحظة: سابات الشهري المتاح:{" "}
          {monthlyRows
            .filter((m) => (m.confirmed ?? m.computed) === "available")
            .map((m) => m.sab)
            .slice(0, 12)
            .join("، ")}
          {monthlyRows.filter((m) => (m.confirmed ?? m.computed) === "available").length > 12 ? " …" : ""}
        </div>
      ) : null}
    </div>
  );
}
