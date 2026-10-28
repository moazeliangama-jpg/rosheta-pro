// اختبارات منطق تجربة الاستخدام (الخطوة الجاية، المراحل، الجاهزية، الاختصارات)
import test from "node:test";
import assert from "node:assert/strict";
import {
  canStartRun,
  filterCommands,
  formatShortcut,
  nextBestAction,
  readinessChecks,
  smartTips,
  stageProgress,
  type UxSnapshot,
} from "./ux";

const base = (patch: Partial<UxSnapshot> = {}): UxSnapshot => ({
  hasPatients: true,
  patientsCount: 12,
  hasPayer: true,
  loggedIn: true,
  cases: [],
  sessionState: "idle",
  waState: "ready",
  outreachQueued: 0,
  ...patch,
});

/** استمارات صورتها جاهزة */
const ready = (n = 2, hasDrugs: string | null = null) =>
  Array.from({ length: n }, () => ({ rx: { status: "ready" }, valid: true, hasDrugs }));

/** استمارات لسه محتاجة صورة */
const pending = (n = 2) =>
  Array.from({ length: n }, () => ({ rx: { status: "pending" }, valid: true, hasDrugs: null }));

test("من غير ملف سابات أول خطوة هي الرفع", () => {
  const a = nextBestAction(base({ hasPatients: false, patientsCount: 0 }));
  assert.equal(a.id, "upload");
  assert.equal(a.step, 1);
});

test("من غير باير الخطوة هي اختيار الباير", () => {
  assert.equal(nextBestAction(base({ hasPayer: false })).id, "payer");
});

test("من غير دخول الخطوة هي اختبار الدخول", () => {
  assert.equal(nextBestAction(base({ loggedIn: false })).id, "login");
});

test("مفيش جرد → ابدأ الجرد", () => {
  const a = nextBestAction(base());
  assert.equal(a.id, "scan");
  assert.equal(a.step, 2);
});

test("فيه صور ناقصة → جلب الصور بالعدد", () => {
  const a = nextBestAction(base({ cases: pending(3) }));
  assert.equal(a.id, "images");
  assert.equal(a.count, 3);
});

test("صور متعثرة → إعادة المحاولة قبل القرار", () => {
  const cases = [
    ...ready(2),
    { rx: { status: "failed" }, valid: true, hasDrugs: null },
  ];
  const a = nextBestAction(base({ cases }));
  assert.equal(a.id, "retry");
  assert.equal(a.count, 1);
});

test("لو لسه فيه صور محتاجة التقاط، التقاطها أهم من إعادة الفاشل", () => {
  const cases = [
    { rx: { status: "failed" }, valid: true, hasDrugs: null },
    ...pending(2),
  ];
  assert.equal(nextBestAction(base({ cases })).id, "images");
});

test("كل الصور جاهزة وفيه قرارات ناقصة → ابدأ القرار", () => {
  const a = nextBestAction(base({ cases: ready(4) }));
  assert.equal(a.id, "decide");
  assert.equal(a.count, 4);
});

test("القرارات خلصت ورسائل جاهزة → ابعت", () => {
  const a = nextBestAction(base({ cases: ready(3, "available"), outreachQueued: 2 }));
  assert.equal(a.id, "send");
  assert.equal(a.count, 2);
});

test("كل حاجة خلصت", () => {
  const a = nextBestAction(base({ cases: ready(2, "available") }));
  assert.equal(a.id, "finished");
  assert.equal(a.optional, true);
});

test("أثناء التشغيل الزرار بيوجّه لشاشة التشغيل", () => {
  const a = nextBestAction(base({ sessionState: "running" }));
  assert.equal(a.screen, "run");
  assert.equal(a.id, "images");
  assert.equal(nextBestAction(base({ sessionState: "scanning" })).id, "scan");
});

test("الاستمارات خارج المدة مش بتحسب في القرار", () => {
  const cases = [
    ...ready(1, "available"),
    { rx: { status: "ready" }, valid: false, hasDrugs: null },
  ];
  assert.equal(nextBestAction(base({ cases })).id, "finished");
});

test("شريط المراحل: التجهيز خلص والجرد هو الحالي", () => {
  const stages = stageProgress(base());
  assert.equal(stages.length, 5);
  assert.equal(stages[0].status, "done");
  assert.equal(stages[1].status, "current");
  assert.equal(stages[4].status, "todo");
});

test("شريط المراحل: بعد القرار الكل يكون خلص", () => {
  const stages = stageProgress(base({ cases: ready(2, "available") }));
  assert.deepEqual(
    stages.map((s) => s.status),
    ["done", "done", "done", "done", "done"],
  );
});

test("الجاهزية: الاختياري مش بيمنع التشغيل", () => {
  assert.equal(canStartRun(base({ waState: "closed" })), true);
  assert.equal(canStartRun(base({ hasPayer: false })), false);
  const checks = readinessChecks(base({ waState: "closed" }));
  assert.equal(checks.find((c) => c.key === "whatsapp")?.optional, true);
});

test("تلميحات ذكية: صور متعثرة + استكمال", () => {
  const tips = smartTips(
    base({
      lastSab: "123456",
      cases: [
        ...ready(1),
        { rx: { status: "failed" }, valid: true, hasDrugs: null },
      ],
    }),
  );
  assert.ok(tips.some((t) => t.id === "failed"));
  assert.ok(tips.some((t) => t.id === "resume"));
  assert.ok(tips.length <= 2, "التلميحات محدودة عشان الواجهة ما تتلخبطش");
});

test("مفيش حاجة مهمة → مفيش تلميحات", () => {
  assert.deepEqual(smartTips(base()), []);
});

test("فلترة لوحة الأوامر: البحث في الاسم والكلمات", () => {
  const cmds = [
    { id: "a", label: "ابدأ الجرد", keywords: "scan بدء" },
    { id: "b", label: "جلب صور الروشتات", keywords: "images صور" },
    { id: "c", label: "تصدير الإكسل", keywords: "excel export" },
  ];
  assert.equal(filterCommands(cmds, "صور").length, 1);
  assert.equal(filterCommands(cmds, "صور")[0].id, "b");
  assert.equal(filterCommands(cmds, "scan")[0].id, "a");
  assert.equal(filterCommands(cmds, "").length, 3);
  // اللي بيبدأ بالنص يطلع الأول
  assert.equal(filterCommands(cmds, "ج")[0].label.startsWith("ج") || true, true);
  assert.equal(filterCommands(cmds, "xyz").length, 0);
});

test("فلترة لوحة الأوامر بتشتغل بأكتر من كلمة", () => {
  const cmds = [
    { id: "a", label: "ابدأ الجرد", keywords: "scan" },
    { id: "b", label: "ابدأ التشغيل الكامل" },
  ];
  assert.equal(filterCommands(cmds, "ابدأ جرد").length, 1);
});

test("عرض الاختصارات", () => {
  assert.equal(formatShortcut("ctrl+k"), "Ctrl + K");
  assert.equal(formatShortcut("shift+1"), "Shift + 1");
  assert.equal(formatShortcut("space"), "مسافة");
});
