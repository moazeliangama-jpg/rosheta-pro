/**
 * اختبار سكربتات البناء لـ Windows.
 *
 * الحالة اللي خلّت الاختبار ده موجود: ملف build-exe.bat كان محفوظ بسطور LF
 * وبحروف عربي، فـ cmd.exe كان بيقطّع السطور ويطلع أخطاء زي:
 *   'rlevel' is not recognized as an internal or external command
 * الاختبار بيمنع رجوع المشكلة دي تاني.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bats = ["build-exe.bat", "start.bat"];

for (const file of bats) {
  test(`${file}: سطور CRLF (شرط cmd.exe)`, () => {
    const text = readFileSync(file, "latin1");
    const loneLf = (text.match(/(?<!\r)\n/g) || []).length;
    assert.equal(loneLf, 0, `${file} فيه ${loneLf} سطر بـ LF — لازم CRLF`);
    assert.ok(text.includes("\r\n"), `${file} مفيهوش CRLF خالص`);
  });

  test(`${file}: ASCII بالكامل ومفيش BOM`, () => {
    const raw = readFileSync(file);
    const bad = [...raw].filter((b) => b > 127).length;
    assert.equal(bad, 0, `${file} فيه ${bad} بايت غير ASCII`);
    assert.notEqual(raw[0], 0xef, `${file} بيبدأ بـ BOM`);
  });

  test(`${file}: بيقفل نفسه بـ exit /b ومفيهوش goto لمكانش موجود`, () => {
    const text = readFileSync(file, "latin1");
    assert.match(text, /exit \/b 0/);
    const labels = new Set([...text.matchAll(/^:(\w+)/gm)].map((m) => m[1]));
    for (const m of text.matchAll(/goto (\w+)/g)) {
      assert.ok(labels.has(m[1]), `${file}: goto ${m[1]} لكن الليبل مش موجود`);
    }
  });
}

test("build-exe.bat بيشغّل فحص التغليف والبناء والتغليف بالترتيب", () => {
  const text = readFileSync("build-exe.bat", "latin1");
  const order = ["npm run check:packaging", "npm run build", "electron-builder"];
  let cursor = -1;
  for (const step of order) {
    const at = text.indexOf(step);
    assert.ok(at > cursor, `الخطوة «${step}» مش موجودة أو مش في مكانها`);
    cursor = at;
  }
});
