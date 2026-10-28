/**
 * «كل حاجة في البرنامج بتأدّي مهمة حقيقية» — فحص آلي بيمنع أي سطح ميت:
 *
 *   ١) كل إعداد في `Settings` لازم يكون مستخدم في كود الواجهة فعلًا
 *      (إعداد بيتحفظ ومش بيأثر على أي حاجة = وعد كاذب للمستخدم).
 *   ٢) كل دالة معلنة في واجهة الجسر `RoshettaBridge` لازم تكون **متطبّقة فعلًا**
 *      في `preload.cjs` (وإلا الواجهة بتنادي `undefined is not a function`).
 *   ٣) كل دالة مكشوفة في `preload` لازم تكون متنادية من الواجهة (مفيش قناة ميتة).
 *   ٤) كل قناة IPC في `main` ليها طرفين (معالج + استدعاء).
 *
 * الفحص ده اتولد من طلب مباشر: «عاوز كل حاجة في البرنامج بتأدّي مهام حقيقية».
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const srcFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) srcFiles.push(full);
  }
};
walk(path.join(root, "src"));

const rel = (f) => path.relative(root, f).replace(/\\/g, "/");
const allSrc = srcFiles.map((f) => read(rel(f))).join("\n");
const uiSrc = srcFiles
  .filter((f) => !["src/lib/types.ts", "src/lib/settings.ts", "src/lib/provider.ts"].includes(rel(f)))
  .map((f) => read(rel(f)))
  .join("\n");

/** قوايم دوال جوه كائن JS (preload) أو واجهة TS (provider) */
function members(block, getters = ["(", "function"]) {
  const top = new Set();
  const groups = new Set();
  for (const line of block.split("\n")) {
    const topMatch = line.match(/^ {2}(\w+):\s*(\(|function)/);
    if (topMatch && getters.includes(topMatch[2])) top.add(topMatch[1]);
    const groupMatch = line.match(/^ {2}(\w+):\s*\{/);
    if (groupMatch) groups.add(groupMatch[1]);
  }
  return { top, groups };
}

function nestedMembers(block, groups, closeToken) {
  const out = new Set();
  for (const g of groups) {
    const start = block.indexOf(`  ${g}: {`);
    if (start < 0) continue;
    const end = block.indexOf(closeToken, start);
    const slice = block.slice(start, end < 0 ? undefined : end);
    for (const m of slice.matchAll(/^ {4}(\w+):\s*\(/gm)) out.add(`${g}.${m[1]}`);
  }
  return out;
}

test("كل إعداد في Settings مستخدم في مهمة حقيقية", () => {
  const types = read("src/lib/types.ts");
  const start = types.indexOf("export interface Settings {");
  assert.ok(start > 0, "مش لاقي واجهة Settings في types.ts");
  const block = types.slice(start, types.indexOf("\n}", start));
  const keys = [...block.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
  assert.ok(keys.length > 25, `عدد الإعدادات قليل بشكل غير متوقع: ${keys.length}`);
  const dead = keys.filter((key) => !new RegExp(`\\b${key}\\b`).test(uiSrc));
  assert.deepEqual(dead, [], `إعدادات مش بتأدّي أي مهمة: ${dead.join(", ")}`);
});

test("كل دالة في واجهة الجسر متطبّقة في preload (مفيش دالة وهمية)", () => {
  const prov = read("src/lib/provider.ts");
  const start = prov.indexOf("export interface RoshettaBridge {");
  assert.ok(start > 0);
  const block = prov.slice(start, prov.indexOf("\n}\n", start));
  const { top, groups } = members(block);
  const declared = new Set([...top, ...nestedMembers(block, groups, "\n  };")]);

  const pre = read("electron/preload.cjs");
  const body = pre.slice(pre.indexOf("exposeInMainWorld"));
  const pMeta = members(body);
  const implemented = new Set([...pMeta.top, ...nestedMembers(body, pMeta.groups, "\n  },")]);

  const missing = [...declared].filter((n) => !implemented.has(n));
  assert.deepEqual(missing, [], `دوال معلنة في الواجهة ومش متطبّقة في preload: ${missing.join(", ")}`);
  assert.ok(declared.size > 25, `عدد دوال الجسر قليل بشكل غير متوقع: ${declared.size}`);
});

test("كل دالة في preload متنادية من الواجهة (مفيش قناة ميتة)", () => {
  const pre = read("electron/preload.cjs");
  const body = pre.slice(pre.indexOf("exposeInMainWorld"));
  const { top, groups } = members(body);
  const exposed = [...top, ...nestedMembers(body, groups, "\n  },")];
  const constants = new Set(["platform", "version"]);
  const dead = exposed.filter((name) => {
    if (constants.has(name)) return false;
    const [head, tail] = name.split(".");
    if (!tail) return !new RegExp(`\\b${head}\\b`).test(uiSrc);
    return !new RegExp(`\\b${head}(\\?\\.|\\.)${tail}\\b`).test(uiSrc);
  });
  assert.deepEqual(dead, [], `دوال جسر مش متنادية من الواجهة: ${dead.join(", ")}`);
});

test("كل قناة IPC ليها طرفين: معالج في main واستدعاء في preload", () => {
  const main = read("electron/main.cjs");
  const pre = read("electron/preload.cjs");
  const handled = new Set([...main.matchAll(/ipcMain\.(?:handle|on)\("([^"]+)"/g)].map((m) => m[1]));
  const called = new Set([...pre.matchAll(/ipcRenderer\.(?:invoke|send)\("([^"]+)"/g)].map((m) => m[1]));
  // قناة بتتبعت من نافذة نايس دير نفسها (preload تاني) مش من واجهة البرنامج
  const windowOnly = new Set(["nd:page-dialog"]);
  assert.deepEqual([...called].filter((c) => !handled.has(c)), [], "قنوات في preload ملهاش معالج في main");
  assert.deepEqual([...handled].filter((c) => !called.has(c) && !windowOnly.has(c)), [], "معالجات في main محدش بيناديها");
});
