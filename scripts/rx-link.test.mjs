/**
 * سلسلة الروشتة الحقيقية: من الرقم المرجعي لحد رابط الملف في مرحلة القرار.
 *
 * المستخدم وصفها خطوة بخطوة:
 *   الرقم المرجعي → نافذة `PrescriptionImgs` → **Manage Documents**
 *   → أيقونة التنزيل (`i.Ndcolor.fa.fa-download`) → تاب جديد فيه
 *   `https://storage.googleapis.com/nicedeer/Eprescreption/...jpg`
 *   → الرابط يتخزن ويتعرض في القرار، ولما يتفتح يتقفل بعد ٣ ثواني.
 *
 * وكمان: كل متصفح بيسجّل دخوله بنفسه (يوزر + باسورد + Log in) — مش نسخ كوكيز.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const main = read("electron/main.cjs");
const snippets = read("electron/snippets.cjs");
const engine = read("src/lib/engine.ts");
const store = read("src/lib/store.ts");
const types = read("src/lib/types.ts");
const viewer = read("src/components/RxViewer.tsx");
const decision = read("src/screens/DecisionScreen.tsx");

test("سكربتات المستندات موجودة وبتضغط على اللي في الموقع فعلًا", () => {
  assert.match(snippets, /CLICK_MANAGE_DOCS_SCRIPT/, "سكربت Manage Documents");
  assert.match(snippets, /ManageDocument/i, "بيتعرف على onclick=\"ManageDocument()\"");
  assert.match(snippets, /CLICK_DOWNLOAD_DOC_SCRIPT/, "سكربت التنزيل");
  assert.match(snippets, /fa-download/, "أيقونة التنزيل الحقيقية");
  assert.match(snippets, /DOC_LINK_SCRIPT/, "سكربت قراءة الرابط");
  assert.match(snippets, /storage\\?\\.googleapis/, "بيعرف رابط storage.googleapis.com");
});

test("استخراج الرابط بيلتقط تاب جديد أو تنزيل حقيقي", () => {
  const fn = main.slice(main.indexOf("async function extractPrescriptionUrl"));
  assert.ok(fn.length > 500, "مش لاقي extractPrescriptionUrl");
  const body = fn.slice(0, 4000);
  assert.match(body, /setWindowOpenHandler/, "تاب/نافذة جديدة");
  assert.match(body, /will-navigate/, "تنقّل في نفس الصفحة");
  assert.match(body, /will-download/, "تنزيل فعلي");
  assert.match(body, /item\.getURL\(\)/, "رابط الملف من التنزيل");
  assert.match(body, /S\.CLICK_MANAGE_DOCS_SCRIPT/, "بيضغط Manage Documents");
  assert.match(body, /S\.CLICK_DOWNLOAD_DOC_SCRIPT/, "بيضغط التنزيل");
});

test("الرابط بيرجع مع نتيجة الاستمارة ويتخزن", () => {
  assert.match(main, /rxUrl: rxUrl \|\| ""/, "النتيجة فيها الرابط");
  assert.match(main, /const docUrl = await extractPrescriptionUrl\(child\)/, "الرابط بيتلقط قبل قفل النافذة");
  assert.match(engine, /setImage\(c\.id, res\.data\.dataUrl, res\.data\.method, \(res\.data as \{ rxUrl\?: string \}\)\.rxUrl/);
  assert.match(types, /url\?: string;/, "الرابط محفوظ في حالة الصورة");
  assert.match(store, /url: url \|\| prev\.rx\.url/, "الرابط بيفضل لو الصورة اتجابت تاني");
});

test("مرحلة القرار بتعرض لينك الروشتة وبتقفل بعد ٣ ثواني", () => {
  assert.match(viewer, /export function RxLinkButton/, "زرار لينك الروشتة");
  assert.match(viewer, /const remaining = 3 - Math\.floor/, "عدّاد ٣ ثواني");
  assert.match(viewer, /setOpen\(false\)/, "بيتقفل تلقائيًا");
  assert.match(decision, /<RxLinkButton c=\{c\} \/>/, "معروض في شاشة القرار");
});

test("كل متصفح بيسجّل دخوله بنفسه (يوزر + باسورد + Log in)", () => {
  assert.match(main, /async function loginInWindow/, "دخول لكل نافذة");
  assert.match(main, /const windowLoginPromises = new Map\(\)/, "قفل لكل نافذة");
  assert.match(main, /runLoginSteps\(win, creds/, "نفس خطوات الدخول الحقيقية");
  const isolated = main.slice(main.indexOf("async function loginIntoIsolatedWindow"));
  assert.ok(
    isolated.indexOf("await loginInWindow(win, credentials)") < isolated.indexOf("await copyAuthCookies(win)"),
    "الدخول في نفس المتصفح قبل أي نسخ كوكيز",
  );
  assert.match(main, /#UserName/, "خانة اليوزر");
  assert.match(main, /#passwordInput/, "خانة الباسورد");
  assert.match(main, /#loginBTN/, "زرار Log in");
});

test("كل المتصفحات بتفتح مع طلب الجرد (مش في وضع معيّن بس)", () => {
  const start = engine.indexOf("const warm = await b.warmup(this.workers);");
  assert.ok(start > 0, "التسخين لازم يشتغل دايمًا");
  const around = engine.slice(Math.max(0, start - 400), start);
  assert.doesNotMatch(around, /if \(s0\.turboMode\) \{/, "مش مربوط بالوضع المرعب");
});

test("بنستنى صفحة الروشتة تفتح فعلًا (مش ٦٠٠ مللي)", () => {
  assert.match(main, /async function waitForClaimPage/, "انتظار حقيقي للصفحة");
  const start = main.indexOf("async function waitForClaimPage");
  assert.match(main.slice(start, start + 900), /timeoutMs = 14000/, "مهلة كافية لتحميل الصفحة");
  const proc = main.slice(main.indexOf("async function processForm"));
  assert.match(proc, /waitForClaimPage\(win, \{ from: resultsUrl/, "مسار نفس النافذة بيستنى التنقّل");
  assert.doesNotMatch(proc, /Date\.now\(\) - started > 600/, "ممنوع الرجوع لمهلة ٦٠٠ مللي");
});

test("صفحة المطالبة بتتحسب روشتة (OpenClaim و PrescriptionImgs)", () => {
  const start = main.indexOf("const isClaimPage");
  const body = main.slice(start, start + 400);
  assert.match(body, /Beneficiary\\\/Search\/i\.test\(text\)\) return false/, "صفحة البحث مش روشتة");
  assert.match(body, /Account\\\/Login\/i\.test\(text\)\) return false/, "صفحة الدخول مش روشتة");
  assert.match(body, /return true;/, "أي صفحة تانية على نايس دير = روشتة/مطالبة");
  const proc = main.slice(main.indexOf("async function processForm"));
  assert.match(proc, /isClaimPage\(wc\(win\)\.getURL\(\)\)/, "المودال/الصفحة اللي جوه نفس النافذة بتتحسب");
});

test("نافذة الروشتة بتفضل ظاهرة لحظة بعد الالتقاط", () => {
  const start = main.indexOf("const onChild = (child) =>");
  const body = main.slice(start, start + 3000);
  assert.match(body, /setTimeout\(\(\) => \{[\s\S]{0,160}child\.destroy\(\)/, "بتتقفل بعد مهلة مش فورًا");
  assert.match(body, /2500/, "لحظتين عشان المستخدم يشوف الروشتة");
});

test("فشل الصورة بيسجّل الصفحة اللي كانت مفتوحة والتفاصيل", () => {
  assert.match(main, /الصفحة وقت الفشل:/, "السجل بيقول الصفحة كانت إيه");
  assert.match(main, /saveWindowEvidence\(win, `image-/, "دليل مكتوب (صفحة + لقطة)");
});

test("فشل التقاط النافذة المنبثقة مابيعلّقش الشغل ٢٦ ثانية", () => {
  const start = main.indexOf("const onChild = (child) =>");
  const body = main.slice(start, start + 3500);
  assert.match(body, /if \(!captured\) settle\(null\)/, "لازم يبلّغ بالفشل فورًا");
});
