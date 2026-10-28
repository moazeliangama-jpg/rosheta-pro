/**
 * ٦٧) كشف انقطاع النت.
 *
 * الفكرة: لو النت قطع في نص الجلسة، البرنامج **مش** بيفضل يحاول ويحرق المحاولات
 * ويعلّم استمارات كأنها فشلت. بيستنى الاتصال يرجع ويكمّل من نفس المكان،
 * ولو طال الانقطاع بيوقّف بهدوء ويقول للمستخدم السبب.
 */

/** هل الجهاز متصل؟ (في المتصفح/إلكترون navigator.onLine موجود دايمًا) */
export function isOnline(): boolean {
  try {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine !== false;
  } catch {
    return true;
  }
}

export interface WaitOptions {
  /** أقصى مدة استنى فيها (افتراضي ١٠ دقايق) */
  timeoutMs?: number;
  /** كل قد إيه نسأل تاني */
  pollMs?: number;
  /** بيتنادى أول ما نلاقي الاتصال واقف */
  onWait?: (elapsedMs: number) => void;
  signal?: { cancelled: boolean };
}

/**
 * بيستنى لحد ما الاتصال يرجع.
 * بيرجع true لو رجع، وfalse لو المهلة خلصت أو الجلسة اتلغت.
 */
export async function waitForOnline(opts: WaitOptions = {}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const pollMs = opts.pollMs ?? 1000;
  if (isOnline()) return true;

  let waited = 0;
  let notified = false;
  while (waited < timeoutMs) {
    if (opts.signal?.cancelled) return false;
    if (!notified) {
      notified = true;
      opts.onWait?.(0);
    }
    await new Promise((r) => setTimeout(r, pollMs));
    waited += pollMs;
    if (isOnline()) return true;
    if (opts.onWait && waited % (pollMs * 15) === 0) opts.onWait?.(waited);
  }
  return isOnline();
}

/** رسالة الفشل الموحّدة لما النت يقطع */
export const OFFLINE_MESSAGE = "النت واقف — البرنامج استنى رجوع الاتصال وما رجعش. الشغل محفوظ، شغّل تاني لما النت يرجع.";
