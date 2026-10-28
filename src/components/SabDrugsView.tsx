import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, FileSpreadsheet, Pill } from "lucide-react";
import { Button, Card, EmptyState } from "./ui";
import { groupCasesBySab, type SabGroup } from "../lib/decisions";
import type { CaseRecord } from "../lib/types";
import { cn } from "../lib/utils";

type ExcelModule = typeof import("../lib/excel");
const excel = () => import("../lib/excel") as Promise<ExcelModule>;

/**
 * ١٠٥) «استمارات الساب اللى فيها الأدوية» — كل ساب بالقرارات اللي فيها دواء،
 * بأرقامها المرجعية، ومن هنا نصدّر شيت الساب ده لوحده.
 */
export function SabDrugsView({
  cases,
  query = "",
  onOpen,
}: {
  cases: Record<string, CaseRecord>;
  query?: string;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const all = groupCasesBySab(cases);
    const q = query.trim();
    return all
      .filter((g) => g.withDrugs > 0)
      .filter((g) => !q || `${g.name} ${g.sab} ${g.phone}`.includes(q))
      .map((g) => ({
        ...g,
        rows: Object.values(cases)
          .filter((c) => c.sab === g.sab && c.hasDrugs === "available")
          .sort((a, b) => (a.formDateISO || "").localeCompare(b.formDateISO || "")),
      }));
  }, [cases, query]);

  const totalForms = groups.reduce((n, g) => n + g.rows.length, 0);

  const toggle = (sab: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(sab)) next.delete(sab);
      else next.add(sab);
      return next;
    });

  const exportSab = (g: SabGroup & { rows: CaseRecord[] }) => {
    void excel().then((x) => x.exportWithDrugs(g.rows));
  };

  if (!groups.length) {
    return (
      <div className="p-4">
        <EmptyState
          title="مفيش ساب عليه قرار «بها دواء» لسه"
          body="احسم استمارات الأول؛ كل ساب فيه استمارة واحدة بها دواء هيظهر هنا بأرقامه."
        />
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/45">
        <span>
          {groups.length} ساب بها دواء • {totalForms} استمارة
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void excel().then((x) => x.exportWithDrugs(groups.flatMap((g) => g.rows)))
          }
        >
          <FileSpreadsheet className="h-3.5 w-3.5" /> تصدير الكل
        </Button>
      </div>

      <div className="space-y-2">
        {groups.map((g) => {
          const expanded = open.has(g.sab);
          return (
            <Card key={g.sab} className="overflow-hidden p-0">
              <button
                onClick={() => toggle(g.sab)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-right transition hover:bg-white/[0.03]"
              >
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 text-white/35 transition", expanded && "rotate-180")}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm font-semibold text-white">{g.name || "بدون اسم"}</span>
                    <span className="tabular-nums text-[11px] text-teal-300">{g.sab}</span>
                    <span className="text-[11px] text-white/35" dir="ltr">
                      {g.phone}
                    </span>
                  </div>
                </div>
                <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300">
                  <Pill className="h-3.5 w-3.5" /> {g.rows.length} بها دواء
                </span>
                <span className="rounded-lg bg-black/25 px-2 py-1 text-[11px] text-white/45">
                  من {g.total}
                </span>
              </button>

              {expanded ? (
                <div className="border-t border-white/10 bg-black/20 px-3 py-2">
                  <table className="w-full text-right text-[11px]">
                    <thead className="text-white/40">
                      <tr>
                        <th className="py-1 font-normal">الرقم المرجعي</th>
                        <th className="py-1 font-normal">النوع</th>
                        <th className="py-1 font-normal">التاريخ</th>
                        <th className="py-1 font-normal">شهري</th>
                        <th className="py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((c) => (
                        <tr key={c.id} className="border-t border-white/5">
                          <td className="py-1.5 tabular-nums text-white/85">{c.reference || "—"}</td>
                          <td className="py-1.5 text-white/55">
                            {c.source === "pre-approval" ? "Pre-Approval" : "E-Prescription"}
                          </td>
                          <td className="py-1.5 tabular-nums text-white/50" dir="ltr">
                            {c.formDate}
                          </td>
                          <td className="py-1.5 text-white/50">{c.monthly ? "نعم" : "لا"}</td>
                          <td className="py-1.5 text-left">
                            <button
                              onClick={() => onOpen(c.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/70 hover:border-teal-400/50 hover:text-white"
                            >
                              <ChevronLeft className="h-3 w-3" /> الروشتة
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => exportSab(g)}>
                      <FileSpreadsheet className="h-3.5 w-3.5" /> شيت الساب ده
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
