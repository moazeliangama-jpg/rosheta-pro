// فحص تطابق قنوات الـIPC بين الجسر (preload) والعملية الرئيسية (main).
// أي قناة في الواجهة من غير معالج = استدعاء بيرجع undefined في صمت،
// وده بالظبط اللي بيخلّي أزرار «شكلها بتشتغل» وما بتعملش حاجة.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preload = fs.readFileSync(path.join(root, "electron/preload.cjs"), "utf8");
const main = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const channels = (source, regex) => {
  const out = new Set();
  for (const match of source.matchAll(regex)) out.add(match[1]);
  return out;
};

const invoked = channels(preload, /ipcRenderer\.invoke\(\s*"([^"]+)"/g);
const handled = channels(main, /ipcMain\.handle\(\s*"([^"]+)"/g);

test("preload: كل قناة مستخدمة لها معالج في main", () => {
  assert.ok(invoked.size >= 40, `عدد القنوات قليل بشكل غير متوقع: ${invoked.size}`);
  const missing = [...invoked].filter((c) => !handled.has(c)).sort();
  assert.deepEqual(missing, [], `قنوات من غير معالج: ${missing.join(", ")}`);
});

test("main: مفيش معالج مكرر لنفس القناة", () => {
  const all = [...main.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const dupes = all.filter((c, i) => all.indexOf(c) !== i);
  assert.deepEqual([...new Set(dupes)], [], `قنوات مكررة: ${[...new Set(dupes)].join(", ")}`);
});

test("نسخة الجسر مطابقة لنسخة المشروع", () => {
  const version = preload.match(/version:\s*"([^"]+)"/)?.[1];
  assert.equal(version, pkg.version);
});

test("قنوات الدخول الجديدة موجودة", () => {
  for (const ch of ["nd:login", "nd:open-login-window", "nd:set-window-mode", "nd:login-trace"]) {
    assert.ok(handled.has(ch), `القناة ${ch} مش معالجة في main`);
    assert.ok(invoked.has(ch), `القناة ${ch} مش متاحة في preload`);
  }
});
