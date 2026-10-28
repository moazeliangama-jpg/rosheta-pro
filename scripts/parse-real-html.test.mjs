/**
 * اختبار حقيقي على نفس HTML اللي بيطلع من نايس دير (مأخوذ من طريقة الصرف المعتمدة).
 * بيتأكد إن قراءة الجدولين، الأرقام المرجعية، التواريخ، الأنواع، ورقم التليفون شغالة.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const S = require("../electron/snippets.cjs");
const { parseDateToISO } = require("../electron/nice-utils.cjs");

const HTML = readFileSync(new URL("./fixtures/search-results.html", import.meta.url), "utf8");

function makeDom(html = HTML) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: "outside-only" });
  return dom.window;
}

test("قراءة الجدولين: 3 استمارات بأرقامها المرجعية", () => {
  const win = makeDom();
  const res = win.eval(S.PARSE_RESULTS_SCRIPT);
  assert.ok(res, "السكربت رجّع نتيجة");
  assert.equal(res.forms.length, 4);

  const [pre, pre2, c1, c2] = res.forms;
  assert.equal(pre.reference, "320644");
  assert.equal(pre.source, "pre-approval");
  assert.equal(pre.date, "21/Oct/2026");
  assert.equal(pre.type, "PreApprovals");
  assert.match(pre.onclick, /CreatePreApprovalEprescription/);

  assert.equal(pre2.reference, "100646678");
  assert.equal(pre2.date, "25/Oct/2026");
  assert.equal(pre2.code, "P648042");

  assert.equal(c1.reference, "1900047");
  assert.equal(c1.source, "claim");
  assert.equal(c1.date, "31/05/2026");
  assert.equal(c1.claimType, "Claim With Code");
  assert.equal(c1.code, "P563732");
  assert.match(c1.href, /OpenClaim\?ParKey=/);

  assert.equal(c2.reference, "1904180");
  assert.equal(c2.date, "02/06/2026");
});

test("رقم التليفون بيتقرأ من .NDClaimIDResult", () => {
  const win = makeDom();
  const res = win.eval(S.PARSE_RESULTS_SCRIPT);
  assert.equal(res.phone, "01143373456");
});

test("التواريخ بتتحول ISO صح للاتنين (Pre-Approval و Claim)", () => {
  assert.equal(parseDateToISO("21/Oct/2026"), "2026-10-21");
  assert.equal(parseDateToISO("31/05/2026"), "2026-05-31");
  assert.equal(parseDateToISO("02/06/2026"), "2026-06-02");
});

test("الضغط على الرقم المرجعي بيختار الصف الصح في الجدول الصح", () => {
  const win = makeDom();
  const clicked = [];
  win.document.querySelectorAll("a.hyperLink").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      clicked.push(a.textContent.trim());
    });
    a.scrollIntoView = () => {};
  });

  win.eval(S.clickReferenceScript("1900047"));
  assert.equal(clicked.length, 1);
  assert.equal(clicked[0], "1900047");

  // رقم غير موجود
  const before = clicked.length;
  win.eval(S.clickReferenceScript("999999"));
  assert.equal(clicked.length, before);
});

test("استمارة شهرية بتتعرف من عمود النوع", () => {
  const win = makeDom(HTML.replace("Claim With Code", "Monthly Claim"));
  const res = win.eval(S.PARSE_RESULTS_SCRIPT);
  const claim = res.forms.find((f) => f.source === "claim");
  assert.match(claim.claimType, /Monthly/);
});
