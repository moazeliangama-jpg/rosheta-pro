// يجمّع ملفات الاختبار بـ esbuild ثم يشغّلها بـ node --test
import { readdirSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const outDir = join(root, "scripts", ".tests");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".test.ts")) files.push(p);
  }
};
walk(join(root, "src"));

for (const file of files) {
  const name = file.replace(/\\/g, "/").split("src/").pop().replace(/\.ts$/, "").replace(/[\\/]/g, "-");
  await build({
    entryPoints: [file],
    outfile: join(outDir, `${name}.mjs`),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["node:*"],
    logLevel: "warning",
  });
}
console.log(`تم تجهيز ${files.length} ملف اختبار`);
