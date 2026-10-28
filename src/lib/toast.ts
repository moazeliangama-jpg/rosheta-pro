/**
 * إشعارات خفيفة (Toasts) — بديل الرسائل المخفية في الـ log.
 *
 * الفكرة: أي عملية بتحصل (حفظ، نسخ، تصدير، تراجع) لازم المستخدم يشوف
 * تأكيد صغير في نفس المكان اللي بصّ عليه، ويختفي لوحده. مفيش نافذة توقف الشغل.
 */
import { useSyncExternalStore } from "react";
import { uid } from "./utils";

export type ToastTone = "ok" | "warn" | "error" | "info";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  text: string;
  /** إجراء اختياري جوه الإشعار (مثل «تراجع») */
  action?: ToastAction;
  at: number;
  /** مدة العرض بالمللي — ٠ = يفضل لحد ما يتقفل */
  ttl: number;
}

type Listener = () => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const MAX_TOASTS = 3;

function emit() {
  for (const l of listeners) l();
}

function scheduleDismiss(id: string, ttl: number) {
  if (ttl <= 0) return;
  const timer = setTimeout(() => dismissToast(id), ttl);
  timers.set(id, timer);
}

export function pushToast(
  tone: ToastTone,
  text: string,
  opts: { action?: ToastAction; ttl?: number } = {},
): string {
  const id = uid("toast");
  const ttl = opts.ttl ?? (opts.action ? 6000 : 3200);
  const item: ToastItem = { id, tone, text, action: opts.action, at: Date.now(), ttl };
  // الأحدث فوق، والحد الأقصى ٣ عشان الشاشة ما تتغطاش
  items = [item, ...items].slice(0, MAX_TOASTS);
  emit();
  scheduleDismiss(id, ttl);
  return id;
}

export function dismissToast(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const before = items.length;
  items = items.filter((t) => t.id !== id);
  if (items.length !== before) emit();
}

export function clearToasts() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  items = [];
  emit();
}

/** اختصارات جاهزة — بتحافظ على شكل رسالة موحّد */
export const toast = {
  ok: (text: string, opts?: { action?: ToastAction; ttl?: number }) => pushToast("ok", text, opts),
  warn: (text: string, opts?: { action?: ToastAction; ttl?: number }) => pushToast("warn", text, opts),
  error: (text: string, opts?: { action?: ToastAction; ttl?: number }) => pushToast("error", text, opts),
  info: (text: string, opts?: { action?: ToastAction; ttl?: number }) => pushToast("info", text, opts),
};

/** قراءة مباشرة بدون React (للاختبارات ولأي كود غير واجهة) */
export function getToasts(): ToastItem[] {
  return items;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => items;

/** كل الإشعارات الحالية — بيتحدّث تلقائيًا في الواجهة */
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** نسخ نص للحافظة مع إشعار — بديل مقبول لو الـ API مش متاح */
export async function copyText(text: string, label = "اتنسخ"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.ok(`${label}: ${text}`);
    return true;
  } catch {
    toast.warn("المتصفح مش سامح بالنسخ — انسخه يدوي.");
    return false;
  }
}
