import type { SaveResult } from "./excel";
import { bridge } from "./provider";
import { toast } from "./toast";

/**
 * بلاغ التصدير الحقيقي.
 *
 * مفيش «تم التصدير» من غير دليل: لو الملف اتكتب على القرص بنقول اسمه ومسار
 * مجلده، ولو الحفظ فشل بنقول السبب. لو البرنامج شغال في المتصفح (تنزيل عادي)
 * بنقولها صريحة إن الحفظ غير مؤكد.
 */
export function reportSave(res: SaveResult & { count?: number }, label: string, onOpenFolder?: () => void) {
  if (!res || !res.ok) {
    toast.error(`تعذر ${label}: ${res?.error ?? "سبب غير معروف"}`);
    return false;
  }

  const rows = typeof res.count === "number" ? ` (${res.count} صف)` : "";

  if (res.unverified) {
    toast.warn(`${label}${rows} — نزل من المتصفح، مش اتأكدنا من مكانه على القرص.`);
    return true;
  }

  const open = onOpenFolder ?? (() => void bridge()?.openExportFolder());
  toast.ok(`${label}${rows} — اتحفظ: ${res.name ?? res.file}`, {
    action: { label: "افتح المجلد", run: open },
  });
  return true;
}
