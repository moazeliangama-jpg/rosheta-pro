import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOutreachQueue,
  classifyReply,
  isSameReply,
  jitteredDelay,
  selectSendable,
  sentToday,
  validatePhone,
} from "./whatsapp.ts";
import { dateKey } from "./utils.ts";
import { defaultSettings } from "./settings.ts";
import type { CaseRecord, MonthlyCheck, OutreachMessage } from "./types.ts";

const settings = {
  ...defaultSettings,
  messageDrugs: "أهلاً {name}، عندك {count} استمارة بها أدوية",
  messageMonthly: "أهلاً {name}، الشهري متاح",
};

const caseBase: CaseRecord = {
  id: "1",
  sab: "555",
  patientName: "أحمد سيد",
  phone: "01001234567",
  workplace: "جهة",
  payerId: "1",
  payerName: "الأهلي",
  source: "claim",
  reference: "1900047",
  type: "Claim With Code",
  claimType: "Claim With Code",
  code: "P563732",
  href: "/Apps/NewPharmacy/Claim/OpenClaim?ParKey=x",
  formDate: "26/Oct/2026",
  formDateISO: "2026-10-26",
  monthly: false,
  valid: true,
  validityReason: "خلال 6 أيام",
  deleted: false,
  deleteState: "done",
  rx: { status: "ready", dataUrl: "data:x", attempts: 0, updatedAt: 0 },
  hasDrugs: "available",
  createdAt: 0,
  updatedAt: 0,
};

const monthlyCheck: MonthlyCheck = {
  sab: "555",
  patientName: "أحمد سيد",
  phone: "01001234567",
  workplace: "جهة",
  lastMonthlyDate: "2026-10-01",
  lastMonthlyRef: "123",
  daysSince: 27,
  computed: "available",
  reason: "",
  confirmed: null,
  updatedAt: 0,
};

test("تصنيف الردود: إيجابي", () => {
  assert.equal(classifyReply("ايوه موافق", settings), "approved");
  assert.equal(classifyReply("تمام", settings), "approved");
});

test("تصنيف الردود: سلبي", () => {
  assert.equal(classifyReply("لا مش موافق", settings), "rejected");
});

test("تصنيف الردود: طلب تأجيل له الأولوية", () => {
  assert.equal(classifyReply("لا مش دلوقتي، بعدين", settings), "postpone");
});

test("رد غير معروف يفضل معلّق", () => {
  assert.equal(classifyReply("مين حضرتك؟", settings), "pending");
});

test("رسالة بها دواء بتتجمع لكل ساب مرة واحدة وتستخدم البيانات الحقيقية", () => {
  const cases: CaseRecord[] = [
    caseBase,
    { ...caseBase, id: "2", reference: "1904180" },
  ];
  const queue = buildOutreachQueue(cases, {}, settings);
  const drugs = queue.filter((m) => m.kind === "drugs");
  assert.equal(drugs.length, 1);
  assert.equal(drugs[0].phone, "201001234567");
  assert.match(drugs[0].text, /أحمد/);
  assert.match(drugs[0].text, /2 استمارة/);
});

test("رسالة الشهري بتتبعت لو المستخدم أكد إن الشهري متاح", () => {
  const queue = buildOutreachQueue([], { "555": { ...monthlyCheck, confirmed: "available" } }, settings);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, "monthly");
});

test("رسالة الشهري مش بتتبعت لو المستخدم أكد إنه غير متاح", () => {
  const queue = buildOutreachQueue([], { "555": { ...monthlyCheck, confirmed: "unavailable" } }, settings);
  assert.equal(queue.length, 0);
});

test("مفيش تكرار للرسائل المرسلة قبل كده", () => {
  const existing = [
    {
      id: "m1",
      sab: "555",
      name: "أحمد",
      phone: "201001234567",
      kind: "drugs" as const,
      text: "x",
      status: "sent" as const,
      at: 0,
      reply: "pending" as const,
    },
  ];
  const queue = buildOutreachQueue([caseBase], {}, settings, existing);
  assert.equal(queue.length, 0);
});

test("الرقم بيتظبط لصيغة واتساب دولية والغلط بيتمنع", () => {
  assert.deepEqual(validatePhone("01143373456"), { ok: true, phone: "201143373456", reason: "" });
  assert.equal(validatePhone("+20 114 337 3456").phone, "201143373456");
  assert.equal(validatePhone("1143373456").ok, true);
  const bad = validatePhone("123");
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /غير صالح/);
  assert.equal(validatePhone("").ok, false);
});

test("فاصل الإرسال بعشوائية حوالين القيمة", () => {
  assert.equal(jitteredDelay(8, 0, () => 0.5), 8000);
  const low = jitteredDelay(10, 30, () => 0);
  const high = jitteredDelay(10, 30, () => 0.999);
  assert.ok(low >= 7000 && low <= 7200, `أقل: ${low}`);
  assert.ok(high >= 12800 && high <= 13000, `أعلى: ${high}`);
  assert.ok(jitteredDelay(1, 90, () => 0) >= 1000, "مش أقل من ثانية");
});

test("الحد اليومي بيوقف الإرسال بعد العدد المحدد", () => {
  const base = (id: string, status: OutreachMessage["status"], at: number): OutreachMessage => ({
    id,
    sab: "100",
    name: "x",
    phone: "201000000000",
    kind: "drugs",
    text: "t",
    status,
    at,
    reply: "pending",
  });
  const now = Date.now();
  const list = [
    base("1", "sent", now),
    base("2", "sent", now),
    base("3", "queued", 0),
    base("4", "queued", 0),
    base("5", "queued", 0),
  ];
  const { list: allowed, blocked } = selectSendable(list, 4, dateKey(new Date(now)));
  assert.equal(sentToday(list, dateKey(new Date(now))), 2);
  assert.equal(allowed.length, 2);
  assert.equal(blocked, 1);
});

test("الحد اليومي بيتحسب على اليوم الحالي بس", () => {
  const old = { at: Date.now() - 3 * 86400000 };
  const m = {
    id: "1",
    sab: "100",
    name: "x",
    phone: "201000000000",
    kind: "drugs" as const,
    text: "t",
    status: "sent" as const,
    at: old.at,
    reply: "pending" as const,
  };
  assert.equal(sentToday([m], dateKey()), 0);
});

test("نفس الرد مش بيتصنّف تاني", () => {
  const m = {
    id: "1",
    sab: "100",
    name: "x",
    phone: "201000000000",
    kind: "drugs" as const,
    text: "t",
    status: "sent" as const,
    at: 1,
    reply: "approved" as const,
    replyText: "موافق",
  };
  assert.equal(isSameReply(m, "موافق"), true);
  assert.equal(isSameReply(m, "تمام"), false);
});
