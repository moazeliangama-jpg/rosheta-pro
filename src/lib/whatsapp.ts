import type { CaseRecord, MonthlyCheck, OutreachMessage, Settings } from "./types";
import { dateKey, normalizePhone, uid } from "./utils";

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
  // «اتبعت خلاص» = sent بس. الرسالة اللي فشلت لازم تتعاد في الجولة الجاية،
  // وإلا الساب اللي اتبعتله مرة وفشلت يفضل من غير رسالة للأبد.
  const sentKeys = new Set(
    existing.filter((m) => m.status === "sent").map((m) => `${m.sab}::${m.kind}`),
  );
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

// ---------------------------------------------------------------------------
// أمان الإرسال: أرقام سليمة، فاصل عشوائي، وحد يومي
// ---------------------------------------------------------------------------

/**
 * ٨٦) تجهيز الرقم قبل الإرسال: +20 والأرقام المحلية والإنجليزية كلها بتتحول
 * لصيغة واحدة، والرقم الغلط بيتمنع قبل ما يفتح واتساب أصلًا.
 */
export function validatePhone(raw: string): { ok: boolean; phone: string; reason: string } {
  const phone = normalizePhone(raw);
  if (!phone) return { ok: false, phone: "", reason: "مفيش رقم تليفون" };
  // رقم مصري دولي: 20 + 10 أرقام
  if (!/^20\d{10}$/.test(phone)) {
    return { ok: false, phone, reason: `رقم غير صالح للواتساب (${phone}) — لازم ١١ رقم محلي` };
  }
  return { ok: true, phone, reason: "" };
}

/**
 * ٨٥) فاصل الإرسال بعشوائية ±: فاصل ثابت تمامًا نمط آلي واضح،
 * والعشوائية الصغيرة بتقلل خطر الحظر من غير ما تطوّل الجلسة.
 */
export function jitteredDelay(sec: number, jitterPct: number, random: () => number = Math.random) {
  const base = Math.max(1, sec) * 1000;
  const pct = Math.max(0, Math.min(80, jitterPct)) / 100;
  const factor = 1 + (random() * 2 - 1) * pct;
  return Math.max(1000, Math.round(base * factor));
}

/** ٩٢) عدد الرسائل المُرسلة في يوم معيّن */
export function sentToday(outreach: OutreachMessage[], day: string) {
  return outreach.filter((m) => m.status === "sent" && m.at && dateKey(new Date(m.at)) === day).length;
}

/** الرسائل المسموح إرسالها النهاردة بعد تطبيق الحد اليومي */
export function selectSendable(
  outreach: OutreachMessage[],
  limit: number,
  day: string,
): { list: OutreachMessage[]; blocked: number } {
  const pending = outreach.filter((m) => m.status === "queued" || m.status === "failed");
  const used = sentToday(outreach, day);
  const room = Math.max(0, limit - used);
  return { list: pending.slice(0, room), blocked: Math.max(0, pending.length - room) };
}

/** ٨٩) الرد اتقرأ قبل كده بنفس النص؟ مش بنعيد تصنيفه ونحدّث الحالة بلا داعي */
export function isSameReply(m: OutreachMessage, text: string) {
  return Boolean(m.replyText) && m.replyText === text;
}
