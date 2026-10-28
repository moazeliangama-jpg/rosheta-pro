/**
 * «كل حاجة في البرنامج بتأدّي مهام حقيقية».
 *
 * الفحص ده بيمنع أي سطح وهمي إنه يتسرّب للبرنامج:
 *   ١) أي إعداد في `Settings` لازم يبقى مستخدم في كود الواجهة/المحرّك،
 *      مش مجرد حقل بيتحفظ ومش بيأثّر على أي حاجة.
 *   ٢) أي دالة مكشوفة للواجهة من `preload` لازم تكون متنادية فعلًا،
 *      وإلا تبقى زرار/قناة ميتة.
 *   ٣) أي معالج IPC في `main` لازم يبقى له مستدعي، وإلا يبقى كود ميت
 *      (وأيضًا مساحة هجوم زيادة مش محتاجة).
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

/** كود الواجهة = كل اللي بيتنفذ فعلًا (مش التعريفات) */
const uiSrc = srcFiles
  .filter((f) => !["src/lib/types.ts", "src/lib/settings.ts", "src/lib/provider.ts"].includes(rel(f)))
  .map((f) => read(rel(f)))
  .join("\n");

const main = read("electron/main.cjs");
const preload = read("electron/preload.cjs");

test("كل إعداد في Settings مستخدم في مهمة حقيقية", () => {
  const types = read("src/lib/types.ts");
  const start = types.indexOf("export interface Settings {");
  assert.ok(start > 0, "مش لاقي واجهة Settings");
  const block = types.slice(start, types.indexOf("\n}", start));
  const keys = [...block.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
  assert.ok(keys.length > 20, `عدد الإعدادات قليل: ${keys.length}`);
  const dead = keys.filter((key) => !new RegExp(`\\b${key}\\b`).test(uiSrc));
  assert.deepEqual(dead, [], `إعدادات مش بتأدّي أي مهمة: ${dead.join(", ")}`);
});

test("كل دالة جسر مكشوفة للواجهة لسه متنادية (مفيش قناة ميتة)", () => {
  const body = preload.slice(preload.indexOf("exposeInMainWorld"));
  const keys = new Set();
  const containers = new Set();
  for (const line of body.split("\n")) {
    const fn = line.match(/^ {2}(\w+):\s*(\(|function)/);
    if (fn) keys.add(fn[1]);
    const obj = line.match(/^ {2}(\w+):\s*\{/);
    if (obj) containers.add(obj[1]);
  }
  // ثوابت مش دوال
  keys.delete("platform");
  keys.delete("version");
  // كل ما جوه كائن متداخل
  for (const name of containers) {
    const start = body.indexOf(`  ${name}: {`);
    if (start < 0) continue;
    const end = body.indexOf("\n  },", start);
    const slice = body.slice(start, end < 0 ? undefined : end);
    for (const m of slice.matchAll(/^ {4}(\w+):\s*\(/gm)) keys.add(`${name}.${m[1]}`);
  }
  assert.ok(keys.size > 20, `عدد دوال الجسر قليل: ${keys.size}`);
  const dead = [...keys].filter((name) => {
    const [head, tail] = name.split(".");
    if (!tail) return !new RegExp(`\\b${head}\\b`).test(uiSrc);
    return !new RegExp(`\\b${head}\\?\\.${tail}\\b|\\b${head}\\.${tail}\\b`).test(uiSrc);
  });
  assert.deepEqual(dead, [], `دوال جسر مش متنادية من الواجهة: ${dead.join(", ")}`);
});

test("كل معالج IPC في main له مستدعي في preloadات البرنامج", () => {
  const pres = ["electron/preload.cjs", "electron/nd-window-preload.cjs", "electron/browser-chrome-preload.cjs"].map(read);
  const handled = new Set([...main.matchAll(/ipcMain\.(?:handle|on)\("([^"]+)"/g)].map((m) => m[1]));
  const called = new Set(pres.flatMap((src) => [...src.matchAll(/ipcRenderer\.(?:invoke|send)\("([^"]+)"/g)].map((m) => m[1])));
  // قنوات بتنبعث من داخل صفحة نايس دير نفسها
  const fromPage = new Set(["nd:page-dialog"]);
  const orphans = [...handled].filter((channel) => !called.has(channel) && !fromPage.has(channel));
  assert.deepEqual(orphans, [], `معالجات IPC من غير مستدعي: ${orphans.join(", ")}`);
});
