import { useRef, useState } from "react";
import { Briefcase, Download, Save, Trash2, Upload } from "lucide-react";
import { useAppStore } from "../lib/store";
import { bridge } from "../lib/provider";
import { getCachedImage } from "../lib/imageCache";
import { loadImage } from "../lib/imageStore";
import { BUNDLE_APP, buildBundle, bundleFileName, bundleSummary, parseBundle } from "../lib/bundle";
import { downloadBlob } from "../lib/utils";
import { Badge, Button, Card, SectionTitle } from "./ui";

/**
 * ١٢٤) مواقع عمل وإعدادات جاهزة + ١٢٥) تصدير/استيراد الحالة الكاملة.
 * كل ده محلي: مفيش أي رفع لأي خدمة.
 */
export function WorkspacePanel() {
  const settings = useAppStore((s) => s.settings);
  const profiles = useAppStore((s) => s.profiles);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const applyProfile = useAppStore((s) => s.applyProfile);
  const deleteProfile = useAppStore((s) => s.deleteProfile);
  const patients = useAppStore((s) => s.patients);
  const cases = useAppStore((s) => s.cases);
  const monthly = useAppStore((s) => s.monthly);
  const outreach = useAppStore((s) => s.outreach);
  const seenForms = useAppStore((s) => s.seenForms);
  const hourly = useAppStore((s) => s.hourly);
  const importBundle = useAppStore((s) => s.importBundle);
  const logLine = useAppStore((s) => s.logLine);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [withImages, setWithImages] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const names = Object.keys(profiles);

  const doSave = () => {
    const clean = name.trim();
    if (!clean) {
      logLine("warn", "اكتب اسم للإعداد قبل الحفظ (مثلًا: فرع المنصورة).");
      return;
    }
    saveProfile(clean);
    setName("");
    logLine("ok", `تم حفظ إعداد «${clean}».`);
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const images: Record<string, string> = {};
      if (withImages) {
        for (const c of Object.values(cases)) {
          if (c.rx.status !== "ready") continue;
          const dataUrl = getCachedImage(c.id) || (await loadImage(c.id));
          if (dataUrl) images[c.id] = dataUrl;
        }
      }
      const bundle = buildBundle({
        settings,
        patients,
        cases: Object.values(cases),
        monthly: Object.values(monthly),
        outreach,
        seenForms,
        hourly,
        images: withImages ? images : undefined,
      });
      downloadBlob(new Blob([JSON.stringify(bundle)], { type: "application/json" }), bundleFileName());
      logLine("ok", `تم تصدير نسخة كاملة (${bundleSummary(bundle).cases} استمارة${withImages ? ` + ${Object.keys(images).length} صورة` : ""}).`);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const parsed = parseBundle(await file.text());
      if (!parsed.ok || !parsed.bundle) {
        logLine("error", parsed.error || "الملف غير صالح");
        return;
      }
      const summary = bundleSummary(parsed.bundle);
      if (!window.confirm(`استيراد ${summary.cases} استمارة (${summary.decided} محسومة)؟ الحالة الحالية هتتستبدل.`)) {
        return;
      }
      importBundle(parsed.bundle);
      // الصور بترجع للتخزين المحلي لو كانت جوه الملف
      const images = parsed.bundle.images ?? {};
      const store = useAppStore.getState();
      let restored = 0;
      for (const [id, dataUrl] of Object.entries(images)) {
        if (!dataUrl) continue;
        store.setImage(id, dataUrl, "imported");
        restored += 1;
      }
      logLine("ok", `تم استيراد ${summary.cases} استمارة${restored ? ` و${restored} صورة` : ""}.`);
      const b = bridge();
      void b?.log({ level: "info", msg: `import bundle: ${summary.cases} cases, ${restored} images` });
    } catch (err) {
      logLine("error", `فشل الاستيراد: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card>
      <SectionTitle hint={`${names.length} إعداد محفوظ`}>مواقع العمل والنسخ الاحتياطي</SectionTitle>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[180px] flex-1">
          <span className="mb-1.5 block text-xs text-white/60">حفظ الإعداد الحالي باسم</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSave()}
            placeholder="مثلًا: فرع المنصورة"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-teal-400/60 focus:outline-none"
          />
        </label>
        <Button variant="ghost" onClick={doSave} disabled={!name.trim()}>
          <Save className="h-4 w-4" /> حفظ إعداد
        </Button>
      </div>

      {names.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {names.map((n) => {
            const p = profiles[n];
            const active = p.workplace === settings.workplace && p.payerId === settings.payerId;
            return (
              <span
                key={n}
                className={
                  "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] " +
                  (active ? "border-teal-400/40 bg-teal-500/10 text-teal-200" : "border-white/10 text-white/60")
                }
              >
                <button
                  onClick={() => {
                    applyProfile(n);
                    logLine("ok", `تم تفعيل إعداد «${n}» — ${p.payerName || "بدون باير"} / ${p.workplace || "كل الأماكن"}.`);
                  }}
                  className="inline-flex items-center gap-1 hover:text-white"
                >
                  <Briefcase className="h-3 w-3" /> {n}
                </button>
                <button onClick={() => deleteProfile(n)} className="text-white/30 hover:text-rose-300" aria-label="حذف">
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-white/35">
          مفيش إعدادات محفوظة. احفظ إعداد كل فرع/باير وبدّل بينهم بضغطة بدل ما تعيد الكتابة كل مرة.
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <Button variant="ghost" onClick={() => void doExport()} disabled={busy || !Object.keys(cases).length}>
          <Download className="h-4 w-4" /> تصدير نسخة كاملة
        </Button>
        <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="h-4 w-4" /> استيراد نسخة
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
          }}
        />
        <label className="inline-flex items-center gap-1.5 text-[11px] text-white/50">
          <input
            type="checkbox"
            checked={withImages}
            onChange={(e) => setWithImages(e.target.checked)}
            className="h-3.5 w-3.5 accent-teal-500"
          />
          مع الصور (ملف أكبر)
        </label>
        <Badge tone="neutral">{BUNDLE_APP}</Badge>
        <span className="text-[10px] text-white/30">كلمة سر نايس دير مش بتتصدّر أبدًا.</span>
      </div>
    </Card>
  );
}
