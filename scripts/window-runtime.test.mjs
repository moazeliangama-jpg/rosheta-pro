/**
 * اختبار سلوك النوافذ الحقيقي: «ليه النافذة فتحت ومفيش خطوة اتعملت؟»
 *
 * بيغطي التلات أسباب اللي كانت بتوقف الأتمتة في نافذة مفتوحة في الخلفية:
 *  ١) انتظار معتمد على requestAnimationFrame (مابيشتغلش في نافذة مخفية/مغطاة).
 *  ٢) صفحة رجعت لفورم الدخول (جلسة انتهت) وكان الرد مهلة فاضية.
 *  ٣) صورة الروشتة بتفتح جوه مودال في نفس الصفحة، فماكانش فيه مسار بيلقطها.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const S = require("../electron/snippets.cjs");

const makeDom = (html) => new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });

const run = async (win, script) => {
  // السكربتات بتتبني كتعبير async IIFE — لازم تتنفّذ جوه سياق الصفحة نفسها
  // (new Function بتشتغل في سياق Node، وساعتها window/document مش موجودين)
  return await win.eval(script);
};

test("الانتظار بيتعمل بمؤقت مش بـ requestAnimationFrame (نافذة مخفية مابتدّيش فريمات)", () => {
  for (const src of [S.fastSearchScript({ sab: "1" }), S.captureNewImageScript({ timeoutMs: 500 })]) {
    assert.ok(src.includes("setTimeout(tick"), "الانتظار لازم يستخدم setTimeout");
    // المهم إن rAF مش **بيتنادى**: مجرد ذكره في تعليق مش مشكلة
    assert.ok(!/requestAnimationFrame\s*\(/.test(src), "مفيش اعتماد على rAF في الانتظار");
  }
});

test("صفحة رجعت لتسجيل الدخول: البحث بيرجّع NEED_LOGIN بدل مهلة فاضية", async () => {
  const dom = makeDom(`<!doctype html><html><body>
    <input id="UserName" /><input id="passwordInput" type="password" /><button id="loginBTN"></button>
  </body></html>`);
  const res = await run(dom.window, S.fastSearchScript({ sab: "123", timeoutMs: 500 }));
  assert.equal(res.ok, false);
  assert.equal(res.error, "NEED_LOGIN");
  assert.match(res.message, /الجلسة/);
});

test("الضغط على الرقم المرجعي بيسجّل الصور الموجودة قبله", async () => {
  const dom = makeDom(`<!doctype html><html><body>
    <table id="Table"><tbody>
      <tr><td><a class="hyperLink" href="#">5550001</a></td></tr>
    </tbody></table>
    <table id="Table2"><tbody></tbody></table>
    <img src="https://nicedeer.net/logo.png" />
  </body></html>`);
  const win = dom.window;
  const link = win.document.querySelector("a.hyperLink");
  let clicked = 0;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    clicked += 1;
  });
  const table = await run(win, S.clickReferenceScript("5550001"));
  assert.equal(table, "#Table");
  assert.equal(clicked, 1);
  assert.deepEqual([...win.__rpImgsBefore], ["https://nicedeer.net/logo.png"]);
});

test("صورة جديدة في مودال بعد الضغط: بتتلقط كـsrcUrl لو الـcanvas محمي", async () => {
  const dom = makeDom(`<!doctype html><html><body>
    <div class="modal show"><img id="rx" src="https://nicedeer.net/PrescriptionImgs/GetImage?x=1" /></div>
  </body></html>`);
  const win = dom.window;
  win.__rpImgsBefore = [];
  const img = win.document.querySelector("#rx");
  Object.defineProperty(img, "naturalWidth", { value: 900 });
  Object.defineProperty(img, "naturalHeight", { value: 1200 });
  Object.defineProperty(img, "complete", { value: true });
  const res = await run(win, S.captureNewImageScript({ timeoutMs: 1500 }));
  assert.equal(res.failed, undefined, `متوقع صورة، النتيجة: ${JSON.stringify(res)}`);
  assert.match(String(res.srcUrl || res.dataUrl), /PrescriptionImgs/);
});

test("لوجو قديم قبل الضغط مش بيتحسب روشتة", async () => {
  const dom = makeDom(`<!doctype html><html><body>
    <img id="logo" src="https://nicedeer.net/logo.png" />
  </body></html>`);
  const win = dom.window;
  win.__rpImgsBefore = ["https://nicedeer.net/logo.png"];
  const img = win.document.querySelector("#logo");
  Object.defineProperty(img, "naturalWidth", { value: 600 });
  Object.defineProperty(img, "naturalHeight", { value: 600 });
  Object.defineProperty(img, "complete", { value: true });
  const res = await run(win, S.captureNewImageScript({ timeoutMs: 800 }));
  assert.equal(res.failed, true);
  assert.equal(res.reason, "no-new-image");
});
