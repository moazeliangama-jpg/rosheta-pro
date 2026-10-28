import type { CaseRecord, NiceDeerProvider, ProviderSearchResult, Settings } from "./types";
import { demoPrescriptionImage } from "./demo";
import { clamp, rand, sleep } from "./utils";

/** واجهة الجسر بين الواجهة وإلكترون (preload.cjs) */
declare global {
  interface Window {
    roshetta?: {
      version: string;
      searchSub: (payload: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      fetchFormImage: (payload: Record<string, unknown>) => Promise<{ ok: boolean; dataUrl?: string; deleted?: boolean; error?: string }>;
      closeWindows: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      onLog?: (cb: (msg: string) => void) => void;
    };
    api?: {
      searchSub: (payload: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      fetchFormImage: (payload: Record<string, unknown>) => Promise<{ ok: boolean; dataUrl?: string; deleted?: boolean; error?: string }>;
      closeWindows: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

const bridge = () => window.roshetta ?? window.api ?? null;

export const hasDesktopBridge = () => Boolean(bridge());

/**
 * المزوّد الحقيقي: يكلّم النوافذ المخفية عبر جسر الإلكترون.
 * أي خطأ من الجسر بيطلع كـ throw، والمحرك بيعيد المحاولة ٣ مرات
 * وبعدها بيسجل الحالة في «السابات المتعثرة» مع سبب واضح.
 */
export class DesktopProvider implements NiceDeerProvider {
  readonly name = "nice-deer-desktop";

  async searchSub(input: { sab: string; buyer: string; workplace: string; fast: boolean }): Promise<ProviderSearchResult> {
    const api = bridge();
    if (!api) throw new Error("جسر سطح المكتب غير متاح");
    const res = await api.searchSub({ ...input });
    if (!res?.ok) throw new Error(res?.error || "فشل البحث في نايس دير");
    return res.data as ProviderSearchResult;
  }

  async fetchFormImage(input: {
    sab: string;
    formId: string;
    buyer: string;
    fast: boolean;
    preventDelete: boolean;
  }): Promise<{ dataUrl: string; deleted: boolean }> {
    const api = bridge();
    if (!api) throw new Error("جسر سطح المكتب غير متاح");
    const res = await api.fetchFormImage({ ...input });
    if (!res?.ok || !res.dataUrl) throw new Error(res?.error || "لم تُرجَع صورة للاستمارة");
    return { dataUrl: res.dataUrl, deleted: Boolean(res.deleted) };
  }

  async closeAll() {
    await bridge()?.closeWindows();
  }
}

const failedSabs = new Set<string>();
const flakyForms = new Set<string>();

/**
 * المزوّد التجريبي: بيحاكي نفس سلوك السيستم بالظبط،
 * بما في ذلك حالات الفشل — عشان نتأكد إن شاشة القرار بتعرض رسالة واضحة
 * وإن «إعادة المحاولة» بتشتغل، بدل ما الصورة تطلع فاضية بدون سبب.
 */
export class DemoProvider implements NiceDeerProvider {
  readonly name = "demo";
  constructor(private settings: () => Settings) {}

  async searchSub(input: { sab: string }): Promise<ProviderSearchResult> {
    await sleep(rand(120, 380));
    if (failedSabs.has(input.sab)) throw new Error("جدول الاستمارات لم يظهر بعد البحث");
    return {
      patient: { sab: input.sab, name: "", phone: "", workplace: "" },
      forms: [],
    };
  }

  async fetchFormImage(input: { sab: string; formId: string; preventDelete: boolean }): Promise<{ dataUrl: string; deleted: boolean }> {
    const { fastMode } = this.settings();
    await sleep(fastMode ? rand(260, 620) : 5000);

    // فشل دائم في ~4% من الاستمارات، وفشل أول محاولة في ~10%
    if (!flakyForms.size && Math.random() < 0.05) flakyForms.add(input.formId);
    if (flakyForms.has(input.formId)) throw new Error("صورة الاستمارة لم تُحمّل خلال المهلة");

    return { dataUrl: "", deleted: false };
  }

  async closeAll() {
    await sleep(60);
  }
}

/** يبني الصورة التجريبية من بيانات الحالة نفسها (مش من عشوائي في كل مرة) */
export function demoImageFor(c: CaseRecord) {
  return demoPrescriptionImage({
    name: c.patientName,
    sab: c.sab,
    formLabel: c.formLabel,
    date: c.formDate,
    workplace: c.workplace,
  });
}

export function providerFor(settings: Settings): NiceDeerProvider & { demoImageFor?: (c: CaseRecord) => string } {
  if (settings.demoMode || !hasDesktopBridge()) {
    const p = new DemoProvider(() => settings) as DemoProvider & { demoImageFor?: (c: CaseRecord) => string };
    p.demoImageFor = demoImageFor;
    return p;
  }
  return new DesktopProvider();
}

export function estimateWorkers(choice: Settings["workerChoice"], adaptive: number | null) {
  if (choice === "auto") return clamp(adaptive ?? 4, 2, 10);
  return clamp(Number(choice), 2, 10);
}
