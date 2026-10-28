// فحص إعدادات التغليف قبل بناء المثبّت.
//
// السبب: أي مفتاح غلط في electron-builder.yml بيخلي البناء يفشل بعد دقايق على
// جهاز Windows، فبنتأكد منه هنا في ثانية على أي جهاز.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import yaml from "js-yaml";

const require = createRequire(import.meta.url);
const problems = [];
const notes = [];

let scheme;
try {
  scheme = require("app-builder-lib/scheme.json");
} catch {
  console.error("مش لاقي app-builder-lib — شغّل npm install الأول.");
  process.exit(1);
}

const rootProps = new Set(Object.keys(scheme.properties || {}));
const fuseProps = new Set(Object.keys(scheme.definitions.FuseOptionsV1.properties));
const nsisProps = new Set(Object.keys(scheme.definitions.NsisOptions?.properties || {}));

const cfg = yaml.load(readFileSync("electron-builder.yml", "utf8"));

// ١) المفاتيح الجذرية
for (const key of Object.keys(cfg)) {
  if (!rootProps.has(key)) problems.push(`مفتاح غير معروف في electron-builder.yml: ${key}`);
}

// ٢) مفاتيح الحماية (fuses)
for (const key of Object.keys(cfg.electronFuses || {})) {
  if (!fuseProps.has(key)) problems.push(`مفتاح fuses غير معروف: ${key}`);
}
if (cfg.electronFuses?.runAsNode !== false)
  problems.push("runAsNode لازم false — وإلا أي حد يشغّل البرنامج كـ Node");
if (cfg.electronFuses?.onlyLoadAppFromAsar !== true)
  problems.push("onlyLoadAppFromAsar لازم true — يمنع تحميل كود من برّة الأرشيف");
if (cfg.electronFuses?.enableNodeOptionsEnvironmentVariable !== false)
  problems.push("enableNodeOptionsEnvironmentVariable لازم false — يمنع حقن NODE_OPTIONS");
if (cfg.electronFuses?.enableNodeCliInspectArguments !== false)
  problems.push("enableNodeCliInspectArguments لازم false — يمنع --inspect");

// ٣) المثبّت
for (const key of Object.keys(cfg.nsis || {})) {
  if (!nsisProps.has(key)) problems.push(`مفتاح nsis غير معروف: ${key}`);
}
if (cfg.nsis?.include && !existsSync("build/installer.nsh"))
  problems.push("nsis.include مكتوب لكن build/installer.nsh مش موجود");
if (cfg.nsis?.deleteAppDataOnUninstall)
  notes.push("deleteAppDataOnUninstall مفعّل — بيانات المستخدم هتتمسح مع إلغاء التثبيت");

// ٤) الملفات اللي البناء بيعتمد عليها
for (const file of ["build/installer.nsh", "build/icon.png", "electron/main.cjs", "electron/preload.cjs"]) {
  if (!existsSync(file)) problems.push(`ملف مطلوب للبناء مش موجود: ${file}`);
}

// ٥) مجلد build لازم يكون مرفوع على git (وإلا البناء على CI مش هيلاقي الإعدادات)
const ignore = readFileSync(".gitignore", "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);
if (ignore.some((l) => l === "build" || l === "build/" || l === "/build" || l === "/build/"))
  problems.push("مجلد build/ مستثنى في .gitignore — البناء مش هيلاقي الأيقونة وإعدادات المثبّت");

// ٦) الأيقونة لازم PNG ومقاسها 256 بكسل أو أكتر (شرط Windows)
if (existsSync("build/icon.png")) {
  const png = readFileSync("build/icon.png");
  const isPng = png.subarray(1, 4).toString() === "PNG";
  if (!isPng) problems.push("build/icon.png مش PNG صحيح");
  else {
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    if (w < 256 || h < 256) problems.push(`أيقونة البرنامج ${w}×${h} — لازم 256×256 على الأقل`);
    else notes.push(`الأيقونة ${w}×${h} ✓`);
  }
}

// ٧) الأرشيف لازم يكون مفعّل والـ dist مشمول
if (cfg.asar !== true) problems.push("asar لازم true — بدونها الكود بيبقى ملفات مفتوحة قابلة للتعديل");
if (!(cfg.files || []).some((f) => String(f).includes("dist"))) problems.push("قائمة files مش شاملة dist/**");

// ٨) ملفات الباتش لازم تبقى CRLF — وإلا Windows cmd بيقطّع السطور ويطلع أخطاء غريبة
for (const file of ["build-exe.bat", "start.bat"]) {
  if (!existsSync(file)) continue;
  const raw = readFileSync(file);
  const text = raw.toString("latin1");
  const loneLf = (text.match(/(?<!\r)\n/g) || []).length;
  if (loneLf > 0) problems.push(`${file}: ${loneLf} سطر بـ LF — لازم CRLF وإلا cmd هيطلع "'rrorlevel' is not recognized"`);
  const nonAscii = [...raw].filter((b) => b > 127).length;
  if (nonAscii > 0) problems.push(`${file}: فيه ${nonAscii} بايت غير ASCII — cmd.exe مش بيفهم العربي كويس`);
}

// رقم نسخة ثابت في extraMetadata بيلغّي نسخة package.json: اسم الملفات بيطلع
// ١.٠.٠ والتحديث التلقائي بيقارن غلط. النسخة مصدرها package.json وبس.
{
  const extra = cfg.extraMetadata || {};
  if (extra.version && String(extra.version) !== String(JSON.parse(readFileSync("package.json", "utf8")).version)) {
    problems.push(`extraMetadata.version = ${extra.version} — لازم تتشال، النسخة بتتاخد من package.json`);
  }
}

if (problems.length) {
  console.error("مشاكل في إعدادات التغليف:");
  for (const p of problems) console.error(" - " + p);
  process.exit(1);
}

for (const n of notes) console.log(" - " + n);
console.log(
  `إعدادات التغليف سليمة ✓ (${Object.keys(cfg).length} مفتاح، ${Object.keys(cfg.electronFuses || {}).length} مفتاح حماية)`,
);
