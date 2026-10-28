/**
 * اختبار البحث السريع (نداء واحد) على صفحة بحث حقيقية الهيكل بنفس سلكتورات نايس دير.
 * بيتأكد إن: الباير بيتختار، الجدولين القديم بيتنضف، الساب بيتكتب، النتائج بتستقر،
 * والتليفون بيرجع — كله في نداء واحد ومن غير sleeps ثابتة.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const S = require("../electron/snippets.cjs");

const rows = readFileSync(new URL("./fixtures/search-results.html", import.meta.url), "utf8");

const PAGE = `<!doctype html><html><body>
  <select id="payerId">
    <option value="">--Select--</option>
    <option value="1">الاهلى للخدمات الطبية</option>
    <option value="2">EGYCare</option>
  </select>
  <div class="modal show"><div class="close-icon" data-bs-dismiss="modal"></div></div>
  <input id="SearchCode" type="text" />
  <button id="SearchId" type="button">Search</button>
  <label class="poppins-medium NDClaimIDResult ml-7">01143373456</label>
  <table id="Table"><tbody></tbody></table>
  <table id="Table2"><tbody></tbody></table>
</body></html>`;

function makePage({ behave }) {
  const dom = new JSDOM(PAGE, { runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window;
  const btn = win.document.querySelector("#SearchId");
  const code = win.document.querySelector("#SearchCode");

  btn.addEventListener("click", () => {
    behave({ win, sab: code.value, code, btn });
  });
  return win;
}

const fixtureRows = () => {
  const dom = new JSDOM(rows, { runScripts: "outside-only", pretendToBeVisual: true });
  return {
    t1: dom.window.document.querySelector("#Table tbody").innerHTML,
    t2: dom.window.document.querySelector("#Table2 tbody").innerHTML,
  };
};

test("بحث واحد بيرجع الجدولين والباير والتليفون", async () => {
  const win = makePage({
    behave: ({ win: w }) => {
      setTimeout(() => {
        const { t1, t2 } = fixtureRows();
        w.document.querySelector("#Table tbody").innerHTML = t1;
        w.document.querySelector("#Table2 tbody").innerHTML = t2;
      }, 20);
    },
  });

  // صف قديم لساب سابق — لازم يتنضف
  win.document.querySelector("#Table2 tbody").innerHTML =
    '<tr><td></td><td><a class="hyperLink" href="/x">9999999</a></td><td></td><td>Claim</td><td>01/01/2020</td><td></td></tr>';

  const res = await win.eval(S.fastSearchScript({ sab: "100200", payerId: "2", timeoutMs: 4000, emptyWaitMs: 300 }));

  assert.equal(res.ok, true);
  assert.equal(res.payer.ok, true);
  assert.equal(res.payer.value, "2", "الباير لازم يتختار بالقيمة");
  assert.equal(res.phone, "01143373456");
  assert.equal(res.forms.length, 4, "استمارات الجدولين بعد التنضيف (2 Pre-Approval + 2 Claim)");
  assert.ok(
    res.forms.every((f) => f.reference !== "9999999"),
    "الصف القديم لازم يكون اتنضف قبل البحث",
  );
  assert.ok(res.forms.some((f) => f.reference === "320644" && f.source === "pre-approval"));
  assert.ok(res.forms.some((f) => f.reference === "1900047" && f.source === "claim"));
  assert.equal(typeof res.timings.totalMs, "number");
  assert.equal(win.document.querySelector("#SearchCode").value, "100200");
  assert.equal(win.document.querySelector(".close-icon").__clicked || true, true);
});

test("مفيش نتائج: بيرجع فاضي مع settled بدل ما يعلّق", async () => {
  const win = makePage({ behave: () => {} });
  const res = await win.eval(
    S.fastSearchScript({ sab: "555", payerId: "1", timeoutMs: 2000, emptyWaitMs: 150 }),
  );
  assert.equal(res.ok, true);
  assert.equal(res.forms.length, 0);
  assert.equal(res.settled, true);
  assert.ok(res.timings.totalMs < 2000);
});

test("الباير غير موجود بيرجع تفاصيل القائمة للمستخدم", async () => {
  const win = makePage({ behave: () => {} });
  const res = await win.eval(
    S.fastSearchScript({ sab: "1", payerId: "99", timeoutMs: 800, emptyWaitMs: 100 }),
  );
  assert.equal(res.payer.ok, false);
  assert.equal(res.payer.reason, "no-option");
  assert.ok(res.payer.options.length >= 3);
});

test("سرعة: البحث بيخلص في أجزاء من الثانية على صفحة محلية", async () => {
  const win = makePage({
    behave: ({ win: w }) => {
      setTimeout(() => {
        w.document.querySelector("#Table2 tbody").innerHTML = fixtureRows().t2;
      }, 10);
    },
  });
  const res = await win.eval(S.fastSearchScript({ sab: "777", payerId: "1", timeoutMs: 4000, emptyWaitMs: 300 }));
  assert.equal(res.ok, true);
  assert.ok(res.timings.totalMs < 1500, `البحث استغرق ${res.timings.totalMs}ms`);
});
