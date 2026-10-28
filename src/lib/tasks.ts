import type { CaseRecord } from "./types";

export interface Task {
  sab: string;
  items: CaseRecord[];
}

/**
 * تقسيم الاستمارات على نوافذ الشغل:
 * - لو عدد السابات أكبر من عدد النوافذ: كل ساب بياخد نافذة (بحث واحد لكل ساب).
 * - لو السابات أقل: بنقسّم استمارات الساب على أكتر من نافذة عشان نستغل النوافذ كلها.
 */
export function buildTasks(cases: CaseRecord[], workers: number): Task[] {
  const bySab = new Map<string, CaseRecord[]>();
  for (const c of cases) {
    if (!bySab.has(c.sab)) bySab.set(c.sab, []);
    bySab.get(c.sab)!.push(c);
  }
  const groups = [...bySab.values()].sort((a, b) => b.length - a.length);

  if (groups.length >= workers) {
    return groups.map((g) => ({ sab: g[0].sab, items: g }));
  }

  const perGroup = Math.max(1, Math.floor(workers / Math.max(1, groups.length)));
  const tasks: Task[] = [];
  for (const g of groups) {
    if (perGroup <= 1 || g.length === 1) {
      tasks.push({ sab: g[0].sab, items: g });
      continue;
    }
    const chunks = Math.min(g.length, perGroup);
    const size = Math.ceil(g.length / chunks);
    for (let i = 0; i < g.length; i += size) {
      tasks.push({ sab: g[0].sab, items: g.slice(i, i + size) });
    }
  }
  // الأطول الأول عشان النوافذ ما تفضلش فاضلة في الآخر
  return tasks.sort((a, b) => b.items.length - a.items.length);
}

