/**
 * ٦٠) نسخة احتياطية يومية تلقائية.
 *
 * الفكرة: أول تشغيل في اليوم، البرنامج بيحفظ نسخة من الحالة (القرارات + السابات +
 * الشهري) في مجلد `backups` جوه بيانات البرنامج، ويحتفظ بآخر ٧ نسخ بس.
 * النسخة دي بتنجّي شغل اليوم لو الجهاز/البرنامج حصل له حاجة.
 */
import { buildBundle, type Bundle } from "./bundle";
import { dateKey } from "./utils";
import { bridge } from "./provider";
import { useAppStore } from "./store";

const LAST_KEY = "roshetta:lastBackup";

export const BACKUP_KEEP = 7;

/** اسم النسخة: مرتب بالتاريخ عشان الترتيب يبقى طبيعي في المجلد */
export function backupName(when = new Date()): string {
  return `rosheta-backup-${dateKey(when)}.json`;
}

/** هل محتاجين نسخة النهاردة؟ (لو اتعملت خلاص، لأ) */
export function shouldBackup(stored: string | null, today = dateKey()): boolean {
  return stored !== today;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function writeStored(day: string) {
  try {
    localStorage.setItem(LAST_KEY, day);
  } catch {
    /* التخزين مقفول — مش مشكلة، النسخة بتتعمل كل تشغيل */
  }
}

/** بناء النسخة من الحالة الحالية (من غير صور — عشان الحجم يفضل صغير) */
export function currentBundle(): Bundle | null {
  const s = useAppStore.getState();
  if (!s.patients.length && !Object.keys(s.cases).length) return null;
  return buildBundle({
    settings: s.settings,
    patients: s.patients,
    cases: Object.values(s.cases),
    monthly: Object.values(s.monthly),
    outreach: s.outreach,
    seenForms: s.seenForms,
    hourly: s.hourly,
  });
}

/**
 * بيتنادى أول ما البرنامج يفتح. بيرجع ملخص العملية أو null لو مش محتاج/مش ممكن.
 * في نسخة المتصفح مفيش مجلد بيانات، فالنسخة بتتخطى بهدوء.
 */
export async function runDailyBackup(now = new Date()): Promise<{ day: string; bytes: number } | null> {
  const b = bridge();
  if (!b || typeof b.backup !== "function") return null;
  const day = dateKey(now);
  if (!shouldBackup(readStored(), day)) return null;

  const bundle = currentBundle();
  if (!bundle) return null;

  const json = JSON.stringify(bundle);
  let res;
  try {
    res = await b.backup({ name: backupName(now), json });
  } catch {
    return null; // النسخة الاحتياطية مش حاجة توقف البرنامج
  }
  if (!res.ok) return null;

  writeStored(day);
  return { day, bytes: json.length };
}
