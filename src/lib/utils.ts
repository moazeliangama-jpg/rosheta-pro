import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function uid(prefix = "id") {
  // crypto.randomUUID أقوى من Math.random وبيقلل احتمال التصادم في الجلسات الطويلة
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : `${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
  return `${prefix}_${rand}`;
}

export const arNum = (n: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 1 }).format(n);

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function rand(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function nowTime(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function elapsedLabel(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${two(h)}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** يحوّل أي رابط صورة إلى dataURL — مستخدم في الويب وفي الإلكترون */
export async function toDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const res = await fetch(src, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return await blobToDataUrl(blob);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("فشل قراءة الصورة"));
    reader.readAsDataURL(blob);
  });
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/**
 * تنظيف رقم الساب: بيشيل المسافات والشرطات والحروف المخفية،
 * ويحوّل الأرقام العربية/الفارسية لأرقام إنجليزية.
 * الساب المتسخ كان بيسبب بحث فاضي أو «غير موجود» وهو موجود فعلًا.
 */
export function normalizeSab(raw: unknown) {
  let out = "";
  for (const ch of String(raw ?? "")) {
    const ar = AR_DIGITS.indexOf(ch);
    const fa = FA_DIGITS.indexOf(ch);
    if (ar >= 0) out += String(ar);
    else if (fa >= 0) out += String(fa);
    else if (ch >= "0" && ch <= "9") out += ch;
  }
  return out;
}

export function normalizePhone(raw: string) {
  const digits = String(raw ?? "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");
  if (!digits) return "";
  if (digits.startsWith("20")) return digits;
  if (digits.startsWith("0")) return `20${digits.slice(1)}`;
  // رقم محلي بدون صفر (من نايس دير بييجي كده أحيانًا)
  if (digits.length === 10) return `20${digits}`;
  return digits;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeName(s: string) {
  return String(s ?? "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60);
}
