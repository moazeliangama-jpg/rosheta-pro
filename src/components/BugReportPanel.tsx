import { useCallback, useEffect, useState } from "react";
import { Bug, FolderOpen, Send, ShieldCheck, TriangleAlert, WifiOff } from "lucide-react";
import { bridge, hasDesktopBridge } from "../lib/provider";
import type { BridgeResult } from "../lib/types";
import { Badge, Button, Card, SectionTitle, Toggle } from "./ui";
import { useAppStore } from "../lib/store";
import { toast } from "../lib/toast";

interface BugInfo {
  enabled: boolean;
  reason: string;
  repo: string;
  tokenVar: string;
  hint?: string;
  sentToday: number;
  maxPerDay: number;
  pending: number;
  lastSentAt: number;
  lastSentUrl: string;
  dir: string;
}

/**
 * بطاقة «الإبلاغ التلقائي» — بتقول الحقيقة: شغّال ولا محتاج توكن،
 * وكام بلاغ اتبعت، وكام مستني في الطابور. كلها قراءة من العملية الرئيسية.
 */
export function BugReportPanel() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const [info, setInfo] = useState<BugInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const b = bridge();
    if (!b) return;
    const res: BridgeResult<BugInfo> = await b.bugReport.info();
    if (res.ok && res.data) setInfo(res.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flush = async () => {
    const b = bridge();
    if (!b) return;
    setBusy(true);
    const res = await b.bugReport.flush();
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "تعذّر إرسال الطابور");
      return;
    }
    const sent = res.data?.sent ?? 0;
    if (sent) toast.ok(`اتبعت ${sent} بلاغ من الطابور.`);
    else toast.info("مفيش بلاغات اتبعتت — يا إما مفيش طابور أو التوكن مش متعرّف.");
    void refresh();
  };

  const openFolder = async () => {
    const b = bridge();
    if (!b) return;
    const res = await b.maintenance({ action: "open-bug-reports" });
    if (!res.ok) toast.error(res.error || "تعذّر فتح المجلد");
  };

  const enabled = info?.enabled ?? false;

  return (
    <Card>
      <SectionTitle hint="من غير أي بيانات مرضى — النص بيتنقّح قبل الإرسال">الإبلاغ التلقائي عن الأخطاء</SectionTitle>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={enabled ? "ok" : "warn"}>
          {enabled ? <ShieldCheck className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
          {enabled ? "مفعّل" : info?.reason === "missing-token" ? "محتاج توكن" : "مقفول"}
        </Badge>
        {info ? <Badge tone="info">{info.repo}</Badge> : null}
        {info && info.pending > 0 ? <Badge tone="warn">{info.pending} في الطابور</Badge> : null}
        {info ? (
          <span className="text-[11px] text-white/40">
            {info.sentToday}/{info.maxPerDay} بلاغ النهاردة
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-white/45">
        {enabled
          ? "أي خطأ غير متوقع بيتحوّل لبلاغ GitHub فيه الإصدار والنظام والوقت والـstack. نفس الخطأ مايتكررش في ٢٤ ساعة."
          : "البرنامج بيسجّل البلاغات محليًا وبس. عشان تتبعت تلقائي على GitHub، عرّف متغير بيئة "}
        {!enabled ? (
          <code className="rounded bg-black/40 px-1 text-[10px] text-teal-200" dir="ltr">
            {info?.tokenVar || "ROSHTA_GITHUB_TOKEN"}
          </code>
        ) : null}
        {!enabled ? " بتوكن فيه صلاحية Issues: write." : ""}
      </p>

      {!enabled && info?.reason === "missing-token" ? (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] text-white/40">
          <WifiOff className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            على ويندوز: <code className="text-teal-200" dir="ltr">setx ROSHTA_GITHUB_TOKEN "ghp_…"</code> ثم أعد فتح
            البرنامج. التفاصيل في <code className="text-teal-200" dir="ltr">BUG_REPORTING.md</code>.
          </span>
        </p>
      ) : null}

      <div className="mt-3">
        <Toggle
          checked={settings.errorReporting !== false}
          onChange={(v) => setSettings({ errorReporting: v })}
          label="إرسال البلاغات تلقائيًا"
          hint="لو قفلته، الخطأ بيتسجل على الجهاز بس ومش بيتبعت لحاجة"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => void flush()} disabled={!hasDesktopBridge() || busy || !enabled}>
          <Send className="h-3.5 w-3.5" /> {busy ? "بيحاول…" : "أرسل الطابور دلوقتي"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void openFolder()} disabled={!hasDesktopBridge()}>
          <FolderOpen className="h-3.5 w-3.5" /> مجلد البلاغات
        </Button>
        <span className="text-[10px] text-white/25">
          <Bug className="mb-0.5 mr-1 inline h-3 w-3" /> البلاغات بتتحفظ محليًا دايمًا حتى لو الإرسال مقفول
        </span>
      </div>

      {info?.lastSentUrl ? (
        <p className="mt-2 truncate text-[11px] text-emerald-300/70" dir="ltr">
          {info.lastSentUrl}
        </p>
      ) : null}
    </Card>
  );
}
