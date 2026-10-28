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
  assert.match(main, /setBounds\(\{\s*x:\s*0,\s*y:\s*CHROME_HEIGHT/, "المحتوى بيتحط تحت الشريط مش فوقه");
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

test("كل نوافذ الأتمتة ليها جلسات منفصلة", () => {
  assert.match(main, /const partition = `persist:nd-\$\{this\.name\}-\$\{/, "كل نافذة لازم تأخد partition خاص");
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
  assert.match(main, /workers\.withPref\(\s*\(win\) => win\.__rpSab === sab/, "الصور بتكمل على نفس متصفح الساب");
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
