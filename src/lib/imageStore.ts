/**
 * مخزن صور الروشتات — IndexedDB.
 *
 * ليه مش localStorage؟ لأن الصور بتوصل 200–800 كيلوبايت للروشتة،
 * وحطها في localStorage بيخلي الحفظ يفشل بصمت (QuotaExceeded) وبتضيع كل الحالات.
 * هنا الصور منفصلة عن الحالة، والحالة تفضل صغيرة وحفظها مؤكد.
 */

const DB_NAME = "rosheta-pro";
const STORE = "rx-images";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB غير متاح"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("فشل فتح قاعدة الصور"));
  });
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("فشل عملية على قاعدة الصور"));
  });
}

export async function saveImage(id: string, dataUrl: string) {
  try {
    await withStore("readwrite", (s) => s.put(dataUrl, id));
  } catch (err) {
    console.warn("تعذر حفظ صورة الروشتة محليًا", err);
  }
}

export async function loadImage(id: string): Promise<string | null> {
  try {
    const v = await withStore<string | undefined>("readonly", (s) => s.get(id));
    return v ?? null;
  } catch {
    return null;
  }
}

export async function deleteImage(id: string) {
  try {
    await withStore("readwrite", (s) => s.delete(id));
  } catch {
    /* تجاهل */
  }
}

export async function clearImages() {
  try {
    await withStore("readwrite", (s) => s.clear());
  } catch {
    /* تجاهل */
  }
}
