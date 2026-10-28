// فحص إعدادات التغليف قبل ما نبني المثبّت على Windows.
// السبب: أي مفتاح غلط في electron-builder.yml بيخلي البناء يفشل بعد دقايق على CI،
// فبنتأكد منه هنا في ثانية على أي جهاز.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import yaml from "js-yaml";

const require = createRequire(import.meta.url);
const problems = [];
const notes = [];

const scheme = require("app-builder-lib/scheme.json");
const rootProps = new Set(Object.keys(scheme.properties || {}));
const fuseProps = new Set(Object.keys(scheme.definitions.FuseOptionsV1.properties));
const nsisProps = new Set(Object.keys(scheme.definitions.NsisOptions.properties));

const cfg = yaml.load(readFileSync("electron-builder.yml", "utf8"));

// ١) المفاتيح الجذرية
for (const key of Object.keys(cfg)) {
  if (!rootProps.has(key)) problems.push(`مفتاح غير معروف في electron-builder.yml: ${key}`);
}

// ٢) مفاتيح الحماية (fuses)
for (const key of Object.keys(cfg.electronFuses || {})) {
  if (!fuseProps.has(key)) problems.push(`مفتاح fuses غير معروف: ${key}`);
}
if (cfg.electronFuses?.runAsNode !== false) problems.push("runAsNode لازم false — وإلا أي حد يشغّل البرنامج كـ Node");
if (cfg.electronFuses?.onlyLoadAppFromAsar !== true) problems.push("onlyLoadAppFromAsar لازم true — يمنع تحميل كود من برة الأرشيف");
if (cfg.electronFuses?.enableNodeOptionsEnvironmentVariable !== false)
  problems.push("enableNodeOptionsEnvironmentVariable لازم false — يمنع حقن NODE_OPTIONS");

// ٣) المثبّت
for (const key of Object.keys(cfg.nsis || {})) {
  if (!nsisProps.has(key)) problems.push(`مفتاح nsis غير معروف: ${key}`);
}
if (cfg.nsis?.include && !existsSync("build/installer.nsh"))
  problems.push("nsis.include مكتوب لكن build/installer.nsh مش موجود");
if (cfg.nsis?.deleteAppDataOnUninstall) notes.push("deleteAppDataOnUninstall مفعّل — بيانات المستخدم هتتمسح مع إلغاء التثبيت");

// ٤) الملفات اللي البناء بيعتمد عليها لازم تكون موجودة ومش مستثناة من git
for (const file of ["build/installer.nsh", "build/icon.png", "electron/main.cjs", "electron/preload.cjs"]) {
  if (!existsSync(file)) problems.push(`ملف مطلوب للبناء مش موجود: ${file}`);
}
const ignore = readFileSync(".gitignore", "utf8").split(/\r?\n/).map((l) => l.trim());
if (ignore.includes("build/") || ignore.includes("build"))
  problems.push("مجلد build/ مستثنى في .gitignore — البناء على CI مش هيلاقي الأيقونة وإعدادات المثبّت");

// ٥) الأيقونة لازم 256 بكسل أو أكتر (شرط Windows)
if (existsSync("build/icon.png")) {
  const png = readFileSync("build/icon.png");
  const isPng = png.subarray(1, 4).toString() === "PNG";
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (!isPng) problems.push("build/icon.png مش PNG صحيح");
  if (w < 256 || h < 256) problems.push(`أيقونة البرنامج ${w}×${h} — لازم 256×256 على الأقل`);
  else notes.push(`الأيقونة ${w}×${h} ✓`);
}

// ٦) الأرشيف لازم يكون مفعّل والـ node_modules مستثنى (كل حاجة متجمّعة في dist)
if (cfg.asar !== true) problems.push("asar لازم true — بدونها الكود بيبقى ملفات مفتوحة قابلة للتعديل");
if (!(cfg.files || []).some((f) => String(f).includes("dist"))) problems.push("قائمة files مش شاملة dist/**");

if (problems.length) {
  console.error("مشاكل في إعدادات التغليف:");
  for (const p of problems) console.error(" - " + p);
  process.exit(1);
}

for (const n of notes) console.log(" - " + n);
console.log(`إعدادات التغليف سليمة ✓ (${Object.keys(cfg).length} مفتاح، ${Object.keys(cfg.electronFuses || {}).length} مفتاح حماية)`);
