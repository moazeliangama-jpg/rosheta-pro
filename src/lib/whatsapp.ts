import type { CaseRecord, MonthlyCheck, OutreachMessage, Settings } from "./types";
import { normalizePhone, uid } from "./utils";

export type ReplyClass = OutreachMessage["reply"];

const parseKeywords = (raw: string) =>
  String(raw || "")
    .split(/[,،\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * تصنيف رد العميل حسب الكلمات اللي المستخدم حددها في الإعداد.
 * الترتيب مهم: التأجيل قبل السلبي، لأن «مش دلوقتي» فيه كلمة «مش».
 */
export function classifyReply(text: string, settings: Pick<Settings, "replyPositive" | "replyNegative" | "replyPostpone">): ReplyClass {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return "pending";

  const postpone = parseKeywords(settings.replyPostpone);
  const negative = parseKeywords(settings.replyNegative);
  const positive = parseKeywords(settings.replyPositive);

  // «مش موافق» و«لا موافق» فيهم كلمة «موافق» — لازم النفي يتغلب على الإيجاب
  const negation = /(^|\s)(لا|مش|غير|مش\s+موافق|not)(\s|$)/.test(t);
  const positives = positive.filter((k) => k && !negative.includes(k));

  if (postpone.some((k) => t.includes(k))) return "postpone";
  if (negative.some((k) => t.includes(k))) return "rejected";
  if (positives.some((k) => t.includes(k))) return negation ? "rejected" : "approved";
  return "pending";
}

const fillTemplate = (template: string, name: string, extra: Record<string, string> = {}) => {
  const first = (name || "").trim().split(/\s+/)[0] || "";
  return String(template || "")
    .replace(/\{name\}/g, first)
    .replace(/\{fullName\}/g, name || "")
    .replace(/\{sab\}/g, extra.sab ?? "")
    .replace(/\{count\}/g, extra.count ?? "");
};

/**
 * يبني رسائل الواتساب الحقيقية:
 * - رسالة «بها دواء» لكل ساب عنده استمارة واحدة على الأقل محددة «بها دواء».
 * - رسالة «الشهري متاح» لكل ساب أكد المستخدم إن الشهري متاح له.
 * الرسالة بتتبعت مرة واحدة لكل ساب ولكل نوع.
 */
export function buildOutreachQueue(
  cases: CaseRecord[],
  monthly: Record<string, MonthlyCheck>,
  settings: Settings,
  existing: OutreachMessage[] = [],
): OutreachMessage[] {
  const sentKeys = new Set(existing.map((m) => `${m.sab}::${m.kind}`));
  const bySab = new Map<string, CaseRecord[]>();
  for (const c of cases) {
    if (!bySab.has(c.sab)) bySab.set(c.sab, []);
    bySab.get(c.sab)!.push(c);
  }

  // سابات ليها شهري متاح وممكن مالها استمارات داخل المدة (أو اتشغلت لوحدها)
  for (const [sab, check] of Object.entries(monthly)) {
    if (bySab.has(sab)) continue;
    bySab.set(sab, [
      {
        id: `monthly-${sab}`,
        sab,
        patientName: check.patientName,
        phone: check.phone,
        workplace: check.workplace,
        payerId: "",
        payerName: "",
        source: "claim",
        reference: check.lastMonthlyRef,
        type: "Monthly",
        claimType: "",
        code: "",
        href: "",
        formDate: check.lastMonthlyDate,
        formDateISO: check.lastMonthlyDate,
        monthly: true,
        valid: true,
        validityReason: "",
        deleted: false,
        deleteState: "skipped",
        rx: { status: "pending", attempts: 0, updatedAt: 0 },
        hasDrugs: null,
        createdAt: 0,
        updatedAt: 0,
      } as CaseRecord,
    ]);
  }

  const queue: OutreachMessage[] = [];

  for (const [sab, list] of bySab) {
    const first = list[0];
    const phone = normalizePhone(first.phone);
    if (!phone) continue;

    const drugs = list.filter((c) => c.hasDrugs === "available");
    if (drugs.length && !sentKeys.has(`${sab}::drugs`)) {
      queue.push({
        id: uid("msg"),
        sab,
        name: first.patientName,
        phone,
        kind: "drugs",
        text: fillTemplate(settings.messageDrugs, first.patientName, { sab, count: String(drugs.length) }),
        status: "queued",
        at: Date.now(),
        reply: "pending",
      });
    }

    const check = monthly[sab];
    const monthlyOk = check && (check.confirmed ?? check.computed) === "available";
    if (monthlyOk && !sentKeys.has(`${sab}::monthly`)) {
      queue.push({
        id: uid("msg"),
        sab,
        name: first.patientName,
        phone,
        kind: "monthly",
        text: fillTemplate(settings.messageMonthly, first.patientName, { sab }),
        status: "queued",
        at: Date.now(),
        reply: "pending",
      });
    }
  }

  return queue;
}

/** إحصاء الردود */
export function replyStats(outreach: OutreachMessage[]) {
  return {
    total: outreach.length,
    sent: outreach.filter((m) => m.status === "sent").length,
    failed: outreach.filter((m) => m.status === "failed").length,
    approved: outreach.filter((m) => m.reply === "approved").length,
    rejected: outreach.filter((m) => m.reply === "rejected").length,
    postpone: outreach.filter((m) => m.reply === "postpone").length,
    pending: outreach.filter((m) => m.reply === "pending").length,
  };
}
