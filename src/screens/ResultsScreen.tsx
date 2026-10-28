import { useMemo, useState } from "react";
import { CheckCheck, Download, MessageCircle, Send, ThumbsDown, ThumbsUp, UserX } from "lucide-react";
import { useAppStore } from "../lib/store";
import { orderedCases } from "../lib/engine";
import { exportApproved, exportAvailable, exportSessionReport } from "../lib/excel";
import { Badge, Button, Card, EmptyState, SectionTitle, Stat } from "../components/ui";
import { normalizePhone, nowTime, uid } from "../lib/utils";
import { cn } from "../lib/utils";

export function ResultsScreen({ onSend }: { onSend: () => void }) {
  const cases = useAppStore((s) => s.cases);
  const caseOrder = useAppStore((s) => s.caseOrder);
  const outreach = useAppStore((s) => s.outreach);
  const addOutreach = useAppStore((s) => s.addOutreach);
  const patchOutreach = useAppStore((s) => s.patchOutreach);
  const settings = useAppStore((s) => s.settings);
  const session = useAppStore((s) => s.session);
  const failed = useAppStore((s) => s.failed);
  const samples = useAppStore((s) => s.samples);
  const logLine = useAppStore((s) => s.logLine);
  const setScreen = useAppStore((s) => s.setScreen);

  const [busy, setBusy] = useState(false);

  const all = useMemo(() => orderedCases(caseOrder, cases), [caseOrder, cases]);
  const available = useMemo(
    () => all.filter((c) => c.drugs === "available" || c.monthly === "available"),
    [all],
  );

  const approved = outreach.filter((m) => m.reply === "approved");

  const startOutreach = async () => {
    if (!available.length) {
      logLine("warn", "مفيش استمارات متاحة للصرف — حدد القرارات الأول.");
      return;
    }
    setBusy(true);
    const bySab = new Map<string, string>();
    for (const c of available) bySab.set(c.sab, c.patientName);

    const items = [...bySab.entries()].map(([sab, name]) => {
      const c = available.find((x) => x.sab === sab)!;
      const text = settings.messageTemplate.replace(/\{name\}/g, name.split(" ")[0] ?? name);
      return {
        id: uid("msg"),
        sab,
        name,
        phone: normalizePhone(c.phone),
        text,
        status: "queued" as const,
        at: Date.now(),
        reply: "pending" as const,
      };
    });
    addOutreach(items);

    // إرسال متتابع محاكى — في نسخة سطح المكتب بيضغط زر الإرسال في نافذة الواتساب
    for (const item of items) {
      patchOutreach(item.id, { status: "sending" });
      await new Promise((r) => setTimeout(r, Math.max(300, settings.sendDelaySec * 120)));
      patchOutreach(item.id, { status: "sent" });
      await new Promise((r) => setTimeout(r, 120));
    }
    setBusy(false);
    logLine("ok", `تم إرسال ${items.length} رسالة واتساب.`);
    onSend();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="متاح للصرف" value={available.length} tone="ok" />
        <Stat label="رسائل مرسلة" value={outreach.filter((m) => m.status === "sent").length} />
        <Stat label="موافقون" value={approved.length} tone="ok" />
        <Stat label="رافضون / بلا رد" value={outreach.filter((m) => m.reply === "rejected" || m.reply === "no-answer").length} tone="bad" />
      </div>

      <Card>
        <SectionTitle hint={`${available.length} استمارة`}>٤. النتيجة — الموافقون على الصرف</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void startOutreach()} disabled={busy || !available.length}>
            <Send className="h-4 w-4" /> {busy ? "جارٍ الإرسال…" : "اعتماد وإرسال واتساب"}
          </Button>
          <Button variant="ghost" onClick={() => exportAvailable(all)}>
            <Download className="h-4 w-4" /> إكسل المتاحين
          </Button>
          <Button variant="ghost" onClick={() => exportApproved(outreach)}>
            <Download className="h-4 w-4" /> إكسل الموافقين
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
            <Download className="h-4 w-4" /> تقرير الجلسة
          </Button>
          <Button variant="muted" onClick={() => setScreen("decision")}>
            رجوع للقرار
          </Button>
        </div>
      </Card>

      <Card className="p-0">
        <div className="border-b border-white/10 px-4 py-3">
          <SectionTitle hint="اضغط على الرد لتغييره">الردود</SectionTitle>
        </div>
        {outreach.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="لسه مفيش رسائل"
              body="اضغط «اعتماد وإرسال واتساب» بعد ما تحدد الاستمارات المتاحة. الردود بتتصنف: موافق / رافض / بلا رد."
            />
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {outreach.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-white">{m.name}</span>
                    <Badge tone={m.status === "sent" ? "ok" : m.status === "failed" ? "bad" : "warn"}>
                      {m.status === "sent" ? "أُرسلت" : m.status === "sending" ? "بتُرسل" : m.status === "failed" ? "فشلت" : "في الانتظار"}
                    </Badge>
                  </div>
                  <div className="truncate text-[11px] text-white/40" dir="ltr">
                    {m.phone} • {nowTime(m.at)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {(
                    [
                      ["approved", "موافق", ThumbsUp, "ok"],
                      ["rejected", "رافض", ThumbsDown, "bad"],
                      ["no-answer", "بلا رد", UserX, "warn"],
                      ["pending", "معلّق", MessageCircle, "neutral"],
                    ] as const
                  ).map(([key, label, Icon, tone]) => (
                    <button
                      key={key}
                      onClick={() => patchOutreach(m.id, { reply: key })}
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
                    >
                      <Icon className="h-3 w-3" /> {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {approved.length ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <CheckCheck className="h-4 w-4" />
          {approved.length} عميل وافق على الصرف — جاهزين للتصدير.
        </div>
      ) : null}
    </div>
  );
}
