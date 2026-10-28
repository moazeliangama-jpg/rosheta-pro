// «كل حاجة في البرنامج بتأدّي مهمة حقيقية» — فحص آلي بيمنع أي سطح ميت:
//  ١) كل إعداد في `Settings` لازم يكون مستخدم في مكان حقيقي (مش متخزّن وبس).
//  ٢) كل دالة في جسر `preload` لازم تكون متنادية من الواجهة (مش قناة ميتة).
//  ٣) كل قناة في العملية الرئيسية لازم تكون متاحة في الجسر (مش معالج يتيم).
import { test } from "node:test";
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

const rel = (file) => path.relative(root, file).replace(/\\/g, "/");
const srcExcludingTypes = srcFiles.filter((f) => !rel(f).startsWith("src/lib/types.ts") && !rel(f).startsWith("src/lib/settings.ts"));

const settingsBlock = (() => {
  const src = read("src/lib/types.ts");
  const start = src.indexOf("export interface Settings {");
  return src.slice(start, src.indexOf("}", start));
})();

test("كل إعداد في Settings مستخدم في مهمة حقيقية (مفيش إعداد متخزّن وبس)", () => {
  const keys = [...settingsBlock.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
  assert.ok(keys.length > 20, `عدد الإعدادات قليل بشكل غير متوقع: ${keys.length}`);
  const unused = keys.filter((key) => {
    const re = new RegExp(`\\b${key}\\b`);
    return !srcExcludingTypes.some((file) => re.test(fs.readFileSync(file, "utf8")));
  });
  assert.deepEqual(unused, [], `إعدادات مش بتعمل حاجة: ${unused.join(", ")}`);
});

test("كل دالة في الجسر متنادية من الواجهة (مفيش قناة ميتة)", () => {
  const preload = read("electron/preload.cjs");
  const names = new Set();
  // دوال المستوى الأول: `name: (…) =>`
  for (const m of preload.matchAll(/^\s{2}(\w+):\s*(?:\(|\(?payload)/gm)) names.add(m[1]);
  // الكائنات المتداخلة: `group: { … }`
  for (const block of preload.matchAll(/^\s{2}(\w+):\s*\{([\s\S]*?)^\s{2}\}/gm)) {
    for (const fn of block[2].matchAll(/^\s{4}(\w+):\s*\(/gm)) names.add(`${block[1]}.${fn[1]}`);
  }
  // خصائص ثابتة (مش دوال) مسموح بيها
  const constants = new Set(["platform", "version"]);
  const all = srcFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const dead = [...names].filter((name) => {
    if (constants.has(name)) return false;
    const [head, tail] = name.split(".");
    return tail ? !new RegExp(`\\b${head}\\?\\.${tail}\\b|\\.${head}\\.${tail}\\(`).test(all) : !new RegExp(`\\b${head}\\(\\{?|\\?\\?\\.${head}\\(`).test(all) && !new RegExp(`\\.${head}\\b`).test(all);
  });
  assert.deepEqual(dead, [], `دوال جسر مش متنادية من الواجهة: ${dead.join(", ")}`);
});

test("كل معالج IPC متاح من الجسر (مفيش معالج يتيم)", () => {
  const main = read("electron/main.cjs");
  const preload = read("electron/preload.cjs");
  const handlers = new Set([...main.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)].map((m) => m[1]));
  const invoked = new Set([...preload.matchAll(/ipcRenderer\.invoke\(\s*"([^"]+)"/g)].map((m) => m[1]));
  const orphans = [...handlers].filter((ch) => !invoked.has(ch)).sort();
  assert.deepEqual(orphans, [], `قنوات معمولة في main ومش متاحة للواجهة: ${orphans.join(", ")}`);
});
