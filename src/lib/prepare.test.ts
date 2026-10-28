import test from "node:test";
import assert from "node:assert/strict";
import { normalizePatients, prepareNote, preparePatients } from "./prepare.ts";
import { normalizeSab } from "./utils.ts";

const p = (sab: string, name = "", workplace = "") => ({ sab, name, phone: "", workplace });

test("تنظيف الساب: مسافات وأرقام عربية وشرطات", () => {
  assert.equal(normalizeSab(" ١٠٠٢٠٠ "), "100200");
  assert.equal(normalizeSab("100-200"), "100200");
  assert.equal(normalizeSab("100 200"), "100200");
  assert.equal(normalizeSab("۱۰۰۲۰۰"), "100200");
  assert.equal(normalizeSab("abc"), "");
});

test("السطور اللي مش فيها رقم ساب صحيح بتتشال", () => {
  const { list, invalid } = normalizePatients([p("100200"), p(""), p("abc"), p("12")]);
  assert.deepEqual(list.map((x) => x.sab), ["100200"]);
  assert.equal(invalid, 3);
});

test("المكرر بيتشال حتى لو مكتوب بأرقام عربية", () => {
  const { list, stats } = preparePatients([p("100200", "أ"), p("١٠٠٢٠٠", "ب")], { day: "2026-10-28" });
  assert.equal(list.length, 1);
  assert.equal(stats.duplicates, 1);
  assert.equal(list[0].name, "أ", "أول ظهور هو اللي بيفضل");
});

test("الساب المتجرد النهاردة بيتخطى، وامبارح بيتجرد تاني", () => {
  const cache = {
    "100200": { day: "2026-10-28", forms: 4 },
    "100300": { day: "2026-10-27", forms: 4 },
  };
  const { list, stats } = preparePatients([p("100200"), p("100300")], { day: "2026-10-28", cache });
  assert.deepEqual(list.map((x) => x.sab), ["100300"]);
  assert.equal(stats.cached, 1);
});

test("«غير موجود» النهاردة بيتخطى، والجرد الجديد بيتجاهل الكاش", () => {
  const cache = { "100200": { day: "2026-10-28", forms: 0, missing: true } };
  assert.equal(preparePatients([p("100200")], { day: "2026-10-28", cache }).list.length, 0);
  assert.equal(preparePatients([p("100200")], { day: "2026-10-28", cache, force: true }).list.length, 1);
});

test("الأثقل الأول: السابات اللي استماراتها كتير تبدأ بدري", () => {
  const cache = {
    "100001": { day: "2026-10-27", forms: 9 },
    "100002": { day: "2026-10-27", forms: 2 },
  };
  const { list } = preparePatients([p("100002"), p("100003"), p("100001")], { day: "2026-10-28", cache });
  assert.deepEqual(list.map((x) => x.sab), ["100001", "100002", "100003"]);
});

test("الساب اللي استماراته كتير النهاردة بيتخطى (مش بيتكرر)", () => {
  const cache = { "100001": { day: "2026-10-28", forms: 9 } };
  const { list, stats } = preparePatients([p("100001"), p("100002")], { day: "2026-10-28", cache });
  assert.deepEqual(list.map((x) => x.sab), ["100002"]);
  assert.equal(stats.cached, 1);
});

test("الاستكمال بعد الوقفة: بيكمل من اللي بعده", () => {
  const { list, stats } = preparePatients([p("100001"), p("100002"), p("100003"), p("100004")], {
    day: "2026-10-28",
    resumeAfter: "100002",
  });
  assert.deepEqual(list.map((x) => x.sab), ["100003", "100004"]);
  assert.equal(stats.resumed, 2);
});

test("سطر التوضيح بيقول إيه اللي اتخطى", () => {
  const note = prepareNote({ total: 10, duplicates: 2, invalid: 1, cached: 1, missing: 1, resumed: 0 });
  assert.match(note, /مكرر/);
  assert.match(note, /غير موجود/);
  assert.match(note, /الشغل على 5 ساب/);
});

test("نقطة استكمال مش موجودة في الملف — بنشتغل على القائمة كلها (مش بنتخطى الكل)", () => {
  const patients = [
    { sab: "111", name: "أ", phone: "", workplace: "و" },
    { sab: "222", name: "ب", phone: "", workplace: "و" },
  ];
  const res = preparePatients(patients, { day: "2026-10-28", resumeAfter: "999" });
  assert.equal(res.list.length, 2, "القائمة اتخطّت كلها بسبب نقطة استكمال قديمة");
  assert.equal(res.stats.resumed, 0);
});

test("نقطة الاستكمال الموجودة بتتخطى اللي قبلها بس", () => {
  const patients = [
    { sab: "111", name: "أ", phone: "", workplace: "و" },
    { sab: "222", name: "ب", phone: "", workplace: "و" },
    { sab: "333", name: "ج", phone: "", workplace: "و" },
  ];
  const res = preparePatients(patients, { day: "2026-10-28", resumeAfter: "222" });
  assert.equal(res.list.length, 1);
  assert.equal(res.list[0].sab, "333");
});
