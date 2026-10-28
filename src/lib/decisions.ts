/**
 * منطق القرارات — مفصول عن الواجهة عشان يتاختبر ويتأكد إنه مظبوط.
 *
 * ١٠٥) القرار الجماعي: كل استمارات الساب بتاخد نفس القرار (بها دواء / بدون دواء).
 * ١٠٦) التراجع: بنحفظ القرار القديم لكل استمارة، والتراجع بيرجّع آخر قرار بس.
 */
import type { CaseRecord, Verdict } from "./types";

export interface DecisionEntry {
  id: string;
  sab: string;
  prev: Verdict;
  at: number;
}

export interface SabGroup {
  sab: string;
  name: string;
  phone: string;
  total: number;
  decided: number;
  withDrugs: number;
  withoutDrugs: number;
  ids: string[];
}

/** تجميع الاستمارات حسب الساب (الداخل في المدة بس) */
export function groupCasesBySab(
  input: CaseRecord[] | Record<string, CaseRecord>,
  onlyValid = true,
): SabGroup[] {
  const map = new Map<string, SabGroup>();
  for (const c of Array.isArray(input) ? input : Object.values(input)) {
    if (onlyValid && !c.valid) continue;
    let g = map.get(c.sab);
    if (!g) {
      g = {
        sab: c.sab,
        name: c.patientName,
        phone: c.phone,
        total: 0,
        decided: 0,
        withDrugs: 0,
        withoutDrugs: 0,
        ids: [],
      };
      map.set(c.sab, g);
    }
    g.total += 1;
    g.ids.push(c.id);
    if (c.hasDrugs === "available") {
      g.withDrugs += 1;
      g.decided += 1;
    } else if (c.hasDrugs === "unavailable") {
      g.withoutDrugs += 1;
      g.decided += 1;
    }
  }
  // الأقل حسمًا الأول — اللي لسه فيه شغل يبقى فوق
  const pending = (g: SabGroup) => g.total - g.decided;
  return [...map.values()].sort((a, b) => pending(b) - pending(a) || b.total - a.total);
}

/** قرار واحد على استمارة — بيرجع التغيير + القيد اللي يتحفظ للتراجع */
export function applyDecision(
  cases: Record<string, CaseRecord>,
  id: string,
  value: Verdict,
  at = Date.now(),
): { cases: Record<string, CaseRecord>; entry: DecisionEntry | null } {
  const prev = cases[id];
  if (!prev || prev.hasDrugs === value) return { cases, entry: null };
  return {
    cases: { ...cases, [id]: { ...prev, hasDrugs: value, updatedAt: at } },
    entry: { id, sab: prev.sab, prev: prev.hasDrugs, at },
  };
}

/** قرار جماعي لكل استمارات الساب */
export function applySabDecision(
  cases: Record<string, CaseRecord>,
  sab: string,
  value: Verdict,
  at = Date.now(),
): { cases: Record<string, CaseRecord>; entries: DecisionEntry[] } {
  const entries: DecisionEntry[] = [];
  let next = cases;
  for (const c of Object.values(cases)) {
    if (c.sab !== sab || c.hasDrugs === value) continue;
    const res = applyDecision(next, c.id, value, at);
    next = res.cases;
    if (res.entry) entries.push(res.entry);
  }
  return { cases: next, entries };
}

/** تراجع: بيرجّع القرار القديم للاستمارة */
export function undoDecision(
  cases: Record<string, CaseRecord>,
  entry: DecisionEntry,
  at = Date.now(),
): Record<string, CaseRecord> {
  const current = cases[entry.id];
  if (!current) return cases;
  return { ...cases, [entry.id]: { ...current, hasDrugs: entry.prev, updatedAt: at } };
}
