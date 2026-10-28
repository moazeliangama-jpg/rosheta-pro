import { loadImage } from "./imageStore";

/**
 * كاش صور في الذاكرة بحجم محدود.
 *
 * ليه؟ لأن البرنامج بيجرد مئات الروشتات. لو حملنا كل صورة (dataURL) في حالة
 * React، الذاكرة والحفظ في localStorage بيتقلوا جدًا ولسة الصور محتاجة تفضل
 * موجودة. هنا بنقرأ من IndexedDB عند الحاجة فقط، وبنسيب آخر ٨٠ صورة بس في الذاكرة.
 */

const MAX_CACHE = 80;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function touch(id: string, value: string) {
  cache.delete(id);
  cache.set(id, value);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function getCachedImage(id: string): string | null {
  const value = cache.get(id);
  if (!value) return null;
  touch(id, value);
  return value;
}

export function putCachedImage(id: string, dataUrl: string) {
  if (!dataUrl) return;
  touch(id, dataUrl);
}

/** يجيب الصورة من الكاش أو من IndexedDB (بدون تكرار الطلبات المتزامنة) */
export async function getImage(id: string): Promise<string | null> {
  const cached = getCachedImage(id);
  if (cached) return cached;

  const inflight = pending.get(id);
  if (inflight) return inflight;

  const task = (async () => {
    const dataUrl = await loadImage(id);
    if (dataUrl) touch(id, dataUrl);
    return dataUrl;
  })();

  pending.set(id, task);
  try {
    return await task;
  } finally {
    pending.delete(id);
  }
}

export function evictImage(id: string) {
  cache.delete(id);
}

export function cacheSize() {
  return cache.size;
}
