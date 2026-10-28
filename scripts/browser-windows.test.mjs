/**
 * نوافذ الأتمتة = متصفحات حقيقية معزولة، ومتصفح واحد بيمشي الساب كله.
 *
 * الفحص ده بيحمي ٤ حاجات بناها المستخدم طلبها حرفيًا:
 *   ١) كل نافذة متصفح حقيقي بشريط عنوان وأزرار تنقّل فوق المحتوى.
 *   ٢) كل نافذة ليها جلسة (partition) مستقلة — مفيش معلومات بتتسرّب بينها.
 *   ٣) الشغل على **محتوى** الصفحة (WebContentsView) مش على قشرة النافذة.
 *   ٤) الساب بيكمل على نفس المتصفح لكل استماراته، وبعدها بيتحرر.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const main = read("electron/main.cjs");
const engine = read("src/lib/engine.ts");
const chromePreload = read("electron/browser-chrome-preload.cjs");
const chromeHtml = read("electron/browser-chrome.html");

test("النافذة فيها شريط متصفح فوق محتوى حقيقي (WebContentsView)", () => {
  assert.match(main, /new WebContentsView\(/, "لازم المحتوى يبقى WebContentsView");
  assert.match(main, /contentView\.addChildView\(view\)/, "المحتوى لازم يتركّب جوه النافذة");
  assert.match(main, /preload:\s*CHROME_PRELOAD/, "شريط المتصفح له preload خاص");
  assert.match(main, /loadFile\(CHROME_HTML\)/, "شريط المتصفح بيتحمّل فعليًا");
  assert.match(main, /CHROME_HEIGHT/, "ارتفاع الشريط مستخدم في تخطيط المحتوى");
  // المحتوى بيتحط تحت الشريط — ولو الشريط ما اتحمّلش بياخد النافذة كلها
  assert.match(main, /const top = win\.__rpChromeOk \? CHROME_HEIGHT : 0/);
  assert.match(main, /setBounds\(\{\s*x:\s*0,\s*y:\s*top/, "المحتوى بيتحط تحت الشريط مش فوقه");
});

test("أزرار الشريط بتنفّذ أوامر حقيقية على المحتوى", () => {
  for (const action of ["back", "forward", "reload", "watch"]) {
    assert.ok(chromeHtml.includes(`"${action}"`), `الشريط مش بيبعت إجراء ${action}`);
  }
  assert.match(chromePreload, /ipcRenderer\.send\("nd:chrome-action"/);
  assert.match(main, /ipcMain\.on\("nd:chrome-action"/);
  const handler = main.slice(main.indexOf('ipcMain.on("nd:chrome-action"'));
  const body = handler.slice(0, handler.indexOf("\n});"));
  assert.match(body, /nh\.goBack\(\)|page\.goBack\(\)/, "زرار الرجوع لازم ينفّذ رجوع فعلي");
  assert.match(body, /nh\.goForward\(\)|page\.goForward\(\)/, "زرار التقدم لازم ينفّذ تقدم فعلي");
  assert.match(body, /page\.reload\(\)/, "زرار التحديث لازم يعمل reload فعلي");
  assert.match(body, /setAlwaysOnTop\(/, "زرار التثبيت لازم يثبّت النافذة فوق فعلًا");
});

test("شورت كت المتصفح شغالة والمحتوى هو اللي مستجيب لها", () => {
  const start = main.indexOf("function wireChrome(win)");
  assert.ok(start > 0, "مش لاقي wireChrome");
  const block = main.slice(start, main.indexOf("function layoutContent(win)", start));
  assert.match(block, /content\.on\("before-input-event"/, "لازم الشورت كت تتقرا من محتوى الصفحة نفسه");
  assert.match(block, /key === "F5"/);
  assert.match(block, /input\.control \|\| input\.meta/, "Ctrl+R لازم تكون مدعومة");
  assert.match(block, /key === "ArrowLeft"/);
  assert.match(block, /key === "ArrowRight"/);
  assert.match(block, /event\.preventDefault\(\)/, "لازم نمنع الصفحة من استهلاك الاختصار");
  assert.match(block, /content\.reload\(\)/, "F5 لازم يعمل reload حقيقي");
});

test("كل نوافذ الأتمتة ليها جلسات منفصلة", () => {
  assert.match(main, /const candidate = `persist:nd-\$\{this\.name\}-/, "كل نافذة لازم تأخد partition خاص");
  // نسخ الهوية بس — كوكي الجلسة بيفضل مستقل لكل نافذة
  assert.match(main, /SESSION_COOKIE_RE/, "لازم فلتر يفصل كوكي الهوية عن كوكي الجلسة");
  assert.match(main, /session\.fromPartition\(ND_PARTITION\)/, "مصدر الهوية جلسة الدخول الأساسية");
  assert.match(main, /cookies\.set\(/, "نسخ الكوكيز لازم يتحقق فعلًا");
});

test("الأتمتة بتشتغل على محتوى الصفحة مش على قشرة النافذة", () => {
  // نافذة الواجهة نفسها (createMainWindow) مش نافذة أتمتة — برّه الفحص
  const start = main.indexOf("function createMainWindow(");
  assert.ok(start > 0, "مش لاقي createMainWindow");
  let depth = 0;
  let end = start;
  for (let i = main.indexOf("{", start); i < main.length; i += 1) {
    if (main[i] === "{") depth += 1;
    else if (main[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const automation = main.slice(0, start) + main.slice(end);

  // الأخطاء دي بتخلي كل الخطوات تروح لشريط المتصفح بدل الصفحة
  const banned = [
    /(?<![A-Za-z])win\.webContents\.capturePage\(/,
    /(?<![A-Za-z])win\.webContents\.setWindowOpenHandler\(/,
    /(?<![A-Za-z])win\.webContents\.loadURL\(/,
    /(?<![A-Za-z])win\.webContents\.executeJavaScript\(/,
    /(?<![A-Za-z])win\.webContents\.session\b/,
    /(?<![A-Za-z])win\.loadURL\(/,
  ];
  const hits = banned.filter((re) => re.test(automation)).map(String);
  assert.deepEqual(hits, [], `أتمتة بتشتغل على قشرة النافذة بدل الصفحة: ${hits.join(", ")}`);
  assert.match(main, /function contentOf\(win\)/, "لازم مسار واحد للوصول لمحتوى الصفحة");
  assert.match(main, /const wc = \(win\) => contentOf\(win\)/);
});

test("متصفح واحد بيمشي الساب كله وبعدها بيتحرر", () => {
  assert.match(main, /win\.__rpSab = String\(sab\)/, "البحث لازم يربط الساب بالمتصفح");
  // الحجز بالـlease: البحث بيحجز، والصور بتكمل على نفس النافذة المحجوزة
  assert.match(main, /function leasedWindowForSab\(/, "الصور بتكمل على نفس متصفح الساب");
  const imgHandler = main.slice(main.indexOf('ipcMain.handle("nd:form-image"'));
  assert.match(imgHandler.slice(0, 900), /workers\.withWindow\(leased/, "الصور بتكمل على نفس متصفح الساب");
  assert.match(main, /ipcMain\.handle\("nd:release-sab"/, "لازم تحرير المتصفح بعد خلاص الساب");
  assert.match(main, /if \(win\.__rpSab && !win\.__rpSabDone\) return;/, "ممنوع تقفيل متصفح في نص شغل ساب");
  assert.match(engine, /releaseSab\(\{ sab: patient\.sab \}\)/, "المحرّك لازم يحرر المتصفح بعد استمارات الساب");
});

test("لا حذف لأي استمارة من غير ما البرنامج نفسه يفتح الروشتة", () => {
  const guard = main.indexOf("if (!openedByUs) {");
  assert.ok(guard > 0, "لازم شرط: مفيش إرجاع لو إحنا اللي فتحناش الروشتة");
  const after = main.slice(guard, guard + 900);
  assert.match(after, /deleteState = "skipped-no-open"/);
  assert.match(main, /cancelPendingDeletes\(/, "إلغاء المستخدم لازم يلغي الإرجاعات المعلّقة");
  assert.match(engine, /cancelDeletes\(\{ reason: "المستخدم أوقف التشغيل" \}\)/, "زر الإيقاف لازم يلغي الإرجاعات");
});

test("صورة الروشتة بتتجاب من نفس جلسة النافذة (مش جلسة تانية)", () => {
  // النافذة المنبثقة للروشتة لازم تورث partition النافذة اللي فتحتها
  const arm = main.slice(main.indexOf("function armPopupCapture"));
  const popup = arm.slice(0, arm.indexOf("const grab ="));
  assert.match(popup, /webPreferences\.partition = win\.__rpPartition \|\| ND_PARTITION/, "النافذة المنبثقة لازم تورث جلسة النافذة");
  assert.doesNotMatch(popup, /overrideBrowserWindowOptions: hiddenWindowOptions\(\{ show: false \}\)\s*,?\s*\n\s*\}\s*;/, "ممنوع ترجع للجلسة المشتركة");

  // جلب الصورة من الشبكة بنفس جلسة النافذة
  const fetchSource = main.slice(main.indexOf("async function fetchSource"));
  const fetchBody = fetchSource.slice(0, fetchSource.indexOf("async function fetchImageViaSession"));
  assert.match(fetchBody, /wc\(win\)\?\.session/, "جلب الشبكة لازم يستخدم جلسة النافذة نفسها");
  assert.doesNotMatch(fetchBody, /const ses = session\.fromPartition\(ND_PARTITION\);/, "جلسة الدخول المشتركة مش صالحة لجلب صورة ساب");

  // فتح رابط الروشتة: بنفس الـpartition بتاع النافذة المصدر
  const cap = main.slice(main.indexOf("async function captureFromUrl"));
  const capBody = cap.slice(0, cap.indexOf("// الاستمارة الواحدة"));
  assert.match(capBody, /sourceWin\.__rpPartition/, "رابط الروشتة بيتفتح بجلسة النافذة المصدر");
  assert.match(capBody, /fetchImageViaSession\(sourceWin/, "أول محاولة: جلب بنفس الجلسة قبل فتح أي نافذة");
  assert.match(main, /captureFromUrl\(abs, wc\(win\)\.getURL\(\), ref, win\)/, "لازم تمرير النافذة المصدر");
});

test("فشل صورة الروشتة بيرجّع دليل مكتوب (صفحة + لقطة)", () => {
  const start = main.indexOf("async function processForm(");
  const body = main.slice(start, main.indexOf("async function ", start + 10));
  assert.match(body, /saveWindowEvidence\(win, `image-/, "فشل الصورة لازم يحفظ دليل");
  assert.match(body, /الدليل: \$\{Object\.values\(evidence\)/, "مسار الدليل لازم يظهر في رسالة الفشل");
});

test("النافذة على أي صفحة نايس دير من غير SearchCode بتفتح صفحة البحث (مش دخول جديد)", () => {
  const start = main.indexOf("async function ensureSearchPage(");
  assert.ok(start > 0, "مش لاقي ensureSearchPage");
  const body = main.slice(start, main.indexOf("async function ", start + 10));
  // ممنوع شرط «لو مش على نايس دير» اللي كان بيخلي النافذة تفضل على لوحة التحكم
  assert.doesNotMatch(body, /!\(state\.url \|\| \"\"\)\.includes\(\"nicedeer\"\)/, "الشرط القديم لسه موجود");
  assert.match(body, /await safeLoad\(win, SEARCH_URL\)/, "لازم تحميل صفحة البحث فعليًا");
  // الدخول آخر حل، وبعد التأكد إن الصفحة فعلاً مش بتفتح
  const loadAt = body.indexOf("await safeLoad(win, SEARCH_URL)");
  const loginAt = body.indexOf("loginIntoIsolatedWindow");
  assert.ok(loginAt > loadAt, "الدخول لازم يبقى بعد محاولة فتح صفحة البحث");
});

test("الجرد بيقرا كل صفوف الجدولين (مش أول صفحة بس)", () => {
  const snippets = read("electron/snippets.cjs");
  const start = snippets.indexOf("const PARSE_FN_SRC");
  const body = snippets.slice(start, snippets.indexOf("const PARSE_RESULTS_SCRIPT", start));
  assert.match(body, /const rpRows = \(table\)/, "لازم قارئ صفوف موحّد");
  assert.match(body, /page\.len\(-1\)/, "لازم عرض كل الصفوف قبل القراءة (DataTables بيفصّل صفحات)");
  assert.match(body, /rows\(\{ search: 'applied' \}\)\.nodes\(\)/, "القراءة من DataTables API بتشمل كل الصفحات");
  assert.match(body, /for \(const tr of rpRows\(t1\)\)/, "جدول Pre-Approvals بيستخدم قارئ كل الصفوف");
  assert.match(body, /for \(const tr of rpRows\(t2\)\)/, "جدول Claims بيستخدم قارئ كل الصفوف");
});

test("كل ساب محجوز على متصفح واحد من البحث لآخر استمارة", () => {
  assert.match(main, /const sabWindowLease = new Map\(\)/, "لازم جدول حجز ساب ← متصفح");
  assert.match(main, /function leaseWindowForSab\(/, "حجز المتصفح للساب");
  assert.match(main, /function leasedWindowForSab\(/, "قراءة المتصفح المحجوز");
  assert.match(main, /function releaseWindowLease\(/, "تحرير المتصفح بعد الساب");

  // البحث بيحجز، والصورة بتكمل على نفس المتصفح المحجوز
  const search = main.slice(main.indexOf("async function runSearchOn"));
  assert.match(search.slice(0, 2000), /leaseWindowForSab\(sab, win\)/, "البحث لازم يحجز المتصفح للساب");
  const image = main.slice(main.indexOf("async function runImageOn"));
  assert.match(image.slice(0, 900), /leaseWindowForSab\(payload\.sab, win\)/, "الصورة بتكمل على متصفح الساب");
  const handler = main.slice(main.indexOf('ipcMain.handle("nd:form-image"'));
  assert.match(handler.slice(0, 900), /workers\.withWindow\(leased/, "لازم التشغيل على نفس النافذة المحجوزة");
  assert.match(handler.slice(0, 900), /leasedWindowForSab\(sab\)/);

  // ممنوع تسليم نافذة محجوزة لساب تاني
  const acquire = main.slice(main.indexOf("async acquire("));
  assert.match(acquire.slice(0, 800), /!w\.__rpLease/, "الحوض ممنوع يسلّم نافذة محجوزة");
  assert.match(main, /ipcMain\.handle\("nd:release-sab"/, "لازم قناة تحرير المتصفح");
});

test("لو شريط المتصفح ما اتحمّلش مفيش شريط أبيض فاضي", () => {
  assert.match(main, /__rpChromeOk/, "لازم معرفة حالة تحميل الشريط");
  const layout = main.slice(main.indexOf("function layoutContent(win)"));
  assert.match(layout.slice(0, 900), /const top = win\.__rpChromeOk \? CHROME_HEIGHT : 0/, "المحتوى ياخد النافذة كلها لو الشريط مش محمّل");
});

test("الإرجاع بيتأكد من الدخول في نافذته قبل ما يدوّر على #btn-DeleteClaim", () => {
  const start = main.indexOf("async function runDeleteJob");
  assert.ok(start > 0, "مش لاقي runDeleteJob");
  const body = main.slice(start, start + 3000);
  const ensureAt = body.indexOf('await ensureSession(win, credentials)');
  const loadAt = body.indexOf("await safeLoad(win, candidate");
  assert.ok(ensureAt > 0, "نافذة الإرجاع لازم تتأكد من الجلسة");
  assert.ok(loadAt > 0, "لازم تحميل صفحة المطالبة");
  assert.ok(ensureAt < loadAt, "ضمان الدخول لازم يحصل قبل تحميل صفحة الإرجاع");
  assert.match(body, /return "login"/, "من غير جلسة مفيش ضغطة حذف — الحالة تتقال");
  assert.match(main, /نافذة الإرجاع مش داخلة بحساب/, "سبب الفشل لازم يظهر للمستخدم");
});

test("مفيش نافذتين حيّتين على نفس جلسة المتصفح (partition)", () => {
  const create = main.slice(main.indexOf("  create() {"), main.indexOf("  /** تشغيل على نافذة **محددة**"));
  assert.match(create, /const taken = new Set\(this\.windows\.map\(\(w\) => w && w\.__rpPartition\)/);
  assert.match(create, /if \(!taken\.has\(candidate\)\)/);
  assert.match(create, /persist:nd-\$\{this\.name\}-x\$\{this\.extraPartitions\}/, "لو الاثنا عشر مشغولين: جلسة جديدة");
});

test("قفل البرنامج بيلغي أي إرجاع معلّق (مفيش حذف بعد الإلغاء)", () => {
  const quit = main.slice(main.indexOf('app.on("before-quit"'));
  assert.match(quit.slice(0, 300), /cancelPendingDeletes\(/);
});

test("المتصفح بيتحرر من الساب حتى لو الساب مالوش استمارات أو اتلغى", () => {
  const start = engine.indexOf("private async pipelinePhase");
  assert.ok(start > 0);
  const block = engine.slice(start, start + 3000);
  const finallyAt = block.indexOf("} finally {");
  const releaseAt = block.indexOf("releaseSab({ sab: patient.sab })");
  assert.ok(finallyAt > 0, "التحرير لازم يكون في finally");
  assert.ok(releaseAt > finallyAt, "releaseSab لازم يكون جوه finally");
});

test("روابط الإرجاع لازم تكون صفحات حقيقية (مش javascript:)", () => {
  const body = main.slice(main.indexOf("async function processForm"));
  assert.match(body, /\/\^javascript:\/i\.test\(raw\)/, "لازم نرفض روابط javascript: في طابور الإرجاع");
});
