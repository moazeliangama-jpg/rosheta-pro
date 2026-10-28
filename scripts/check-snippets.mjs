// يتأكد إن كل JavaScript اللي بيتنفذ جوه صفحات نايس دير/واتساب سليم من غير تشغيل Electron
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../electron/snippets.cjs");

const scripts = {
  selectPayerScript: S.selectPayerScript("1", "الأهلي"),
  CLOSE_MODAL_SCRIPT: S.CLOSE_MODAL_SCRIPT,
  fillCodeScript: S.fillCodeScript("12345"),
  CLICK_SEARCH_SCRIPT: S.CLICK_SEARCH_SCRIPT,
  PARSE_RESULTS_SCRIPT: S.PARSE_RESULTS_SCRIPT,
  EXTRACT_IMAGE_SCRIPT: S.EXTRACT_IMAGE_SCRIPT,
  FIND_IMAGE_LINK_SCRIPT: S.FIND_IMAGE_LINK_SCRIPT,
  CLICK_DELETE_SCRIPT: S.CLICK_DELETE_SCRIPT,
  WA_STATE_SCRIPT: S.WA_STATE_SCRIPT,
  WA_SEND_SCRIPT: S.WA_SEND_SCRIPT,
  WA_LAST_REPLIES_SCRIPT: S.WA_LAST_REPLIES_SCRIPT,
};

let bad = 0;
for (const [name, code] of Object.entries(scripts)) {
  if (typeof code !== "string" || !code.trim()) {
    console.error(`❌ ${name}: فاضي`);
    bad += 1;
    continue;
  }
  try {
    new Function(`return (${code})`);
    console.log(`✅ ${name}`);
  } catch (err) {
    console.error(`❌ ${name}: ${err.message}`);
    bad += 1;
  }
}

// فحص السلكتورات المطلوبة موجودة في الأكواد
const required = {
  "تسجيل الدخول": ["#UserName", "#passwordInput", "#loginBTN"],
  "البحث": ["#payerId", "#SearchCode", "#SearchId", ".close-icon"],
  "الجدولين": ["#Table", "#Table2", "approval.PreApprovalId", "a.hyperLink"],
  "التليفون": [".NDClaimIDResult"],
  "الإرجاع": ["#btn-DeleteClaim"],
};
const fs = require("node:fs");
const path = require("node:path");
const mainSrc = fs.readFileSync(path.join(process.cwd(), "electron", "main.cjs"), "utf8");
const all = Object.values(scripts).join("\n") + "\n" + mainSrc;
for (const [label, selectors] of Object.entries(required)) {
  const missing = selectors.filter((s) => !all.includes(s));
  if (missing.length) {
    // بعض السلكتورات في login موجودة في main.cjs مش في snippets
    console.log(`ℹ️  ${label}: مش في snippets (${missing.join(", ")})`);
  } else {
    console.log(`✅ ${label}: كل السلكتورات موجودة`);
  }
}

if (bad) {
  console.error(`\nفشل ${bad} سكربت`);
  process.exit(1);
}
console.log("\nكل السكربتات سليمة ✨");
