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

/** الصور بتتحفظ مع وقت الالتقاط عشان نقدر نمسح القديم تلقائيًا */
interface StoredImage {
  dataUrl: string;
  at: number;
}

/** الصورة أقدم من المدة المسموحة؟ (بتحسب على الساعة الحقيقية) */
export function isExpired(at: number, days = 30, now = Date.now()) {
  if (!at) return false;
  return now - at > days * 24 * 60 * 60 * 1000;
}

export async function saveImage(id: string, dataUrl: string) {
  try {
    const value: StoredImage = { dataUrl, at: Date.now() };
    await withStore("readwrite", (s) => s.put(value, id));
  } catch (err) {
    console.warn("تعذر حفظ صورة الروشتة محليًا", err);
  }
}

export async function loadImage(id: string): Promise<string | null> {
  try {
    const v = await withStore<string | StoredImage | undefined>("readonly", (s) => s.get(id));
    if (!v) return null;
    if (typeof v === "string") return v;
    return v.dataUrl ?? null;
  } catch {
    return null;
  }
}

/** هل الصورة موجودة فعلًا في التخزين؟ (بدون تحميلها كاملة للحالة) */
export async function hasImage(id: string): Promise<boolean> {
  try {
    const db = await openDb();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count(id);
      req.onsuccess = () => resolve((req.result || 0) > 0);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * ٥٤) حذف الصور الأقدم من ٣٠ يوم: مجلد الإكسل والصور بيكبر مع كل جلسة،
 * وتخزين صورة كل روشتة للأبد بيملّي الجهاز بلا داعي — الصورة بتخلص صلاحيتها أصلًا.
 * الصور القديمة (المحفوظة كنص من نسخة أقدم) بتفضل زي ما هي.
 */
export async function pruneImages(days = 30, now = Date.now()): Promise<number> {
  try {
    const db = await openDb();
    return await new Promise<number>((resolve) => {
      let removed = 0;
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const value = cursor.value as StoredImage | string;
        if (typeof value === "object" && value && isExpired(value.at, days, now)) {
          cursor.delete();
          removed += 1;
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => resolve(removed);
    });
  } catch {
    return 0;
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
