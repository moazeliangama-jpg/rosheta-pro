import test from "node:test";
import assert from "node:assert/strict";
import { buildOutreachQueue, classifyReply } from "./whatsapp.ts";
import { defaultSettings } from "./settings.ts";
import type { CaseRecord, MonthlyCheck } from "./types.ts";

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
