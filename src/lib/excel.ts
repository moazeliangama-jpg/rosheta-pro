import * as XLSX from "xlsx";
import type { CaseRecord, FailedRecord, OutreachMessage, PatientRow, FormRow, SpeedSample } from "./types";
import { arNum, dateKey, downloadBlob, safeName } from "./utils";

/** يقرأ شيت Excel كصفوف عامة */
export async function readWorkbook(file: File): Promise<{ patients: PatientRow[]; forms: FormRow[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const patients: PatientRow[] = [];
  const forms: FormRow[] = [];

  const pickSheet = (names: string[]) =>
    wb.SheetNames.find((n) => names.some((x) => n.trim().includes(x))) ?? wb.SheetNames[0];

  const patientSheet = wb.Sheets[pickSheet(["ساب", "مرض", "patient", "أسماء"])];
  const formSheet = wb.Sheets[pickSheet(["استمار", "form", "روشت"])];

  if (patientSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(patientSheet, { defval: "" });
    for (const r of rows) {
      const sab = str(r["الساب"] ?? r["sab"] ?? r["SAB"] ?? r["Sub"] ?? r["رقم الساب"]);
      if (!sab) continue;
      patients.push({
        sab,
        name: str(r["الاسم"] ?? r["اسم المريض"] ?? r["name"] ?? r["Name"]),
        phone: str(r["التليفون"] ?? r["الهاتف"] ?? r["phone"] ?? r["mobile"]),
        workplace: str(r["مكان العمل"] ?? r["العمل"] ?? r["workplace"]),
        buyer: str(r["الباير"] ?? r["buyer"]),
      });
    }
  }

  if (formSheet && formSheet !== patientSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(formSheet, { defval: "" });
    for (const r of rows) {
      const sab = str(r["الساب"] ?? r["sab"] ?? r["Sub"]);
      const formId = str(r["رقم الاستمارة"] ?? r["الاستمارة"] ?? r["form"] ?? r["ID"]);
      if (!sab || !formId) continue;
      const type = str(r["النوع"] ?? r["نوع الاستمارة"] ?? r["type"]);
      forms.push({
        formId,
        sab,
        formType: type,
        formLabel: `استمارة ${formId}`,
        date: dateStr(r["التاريخ"] ?? r["تاريخ"] ?? r["date"]),
        isMonthly: /شهر|month/i.test(type),
      });
    }
  }

  return { patients, forms };
}

function str(v: unknown) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function dateStr(v: unknown) {
  if (v instanceof Date) return dateKey(v);
  const s = str(v);
  return s;
}

export function exportFailed(failed: FailedRecord[], meta: Record<string, string | number>) {
  const wb = XLSX.utils.book_new();
  const rows = failed.map((f) => ({
    الساب: f.sab,
    الاسم: f.patientName,
    "مكان العمل": f.workplace,
    الخطوة: f.step,
    الاستمارة: f.form,
    السبب: f.reason,
    الوقت: new Date(f.at).toLocaleString("ar-EG"),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "سابات متعثرة");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([meta]), "ملخص الجلسة");
  write(wb, `روشتة-برو-سابات-متعثرة-${dateKey()}.xlsx`);
}

export function exportAvailable(cases: CaseRecord[]) {
  const bySab = new Map<string, CaseRecord[]>();
  for (const c of cases) {
    if (c.drugs !== "available" && c.monthly !== "available") continue;
    if (!bySab.has(c.sab)) bySab.set(c.sab, []);
    bySab.get(c.sab)!.push(c);
  }
  const rows = [...bySab.values()].map((list) => {
    const first = list[0];
    return {
      الاسم: first.patientName,
      الساب: first.sab,
      "رقم التليفون": first.phone,
      "نوع الاستمارات": [...new Set(list.map((c) => c.formType))].join("، "),
      "عدد الاستمارات": list.length,
      الحساب: "",
    };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "الموافقون على الصرف");
  write(wb, `روشتة-برو-المتاحون-${dateKey()}.xlsx`);
}

export function exportApproved(outreach: OutreachMessage[]) {
  const rows = outreach
    .filter((m) => m.reply === "approved")
    .map((m) => ({
      الاسم: m.name,
      الساب: m.sab,
      التليفون: m.phone,
      "الرد": m.replyText ?? "",
      الوقت: new Date(m.at).toLocaleString("ar-EG"),
    }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "الموافقون");
  write(wb, `روشتة-برو-الموافقون-${dateKey()}.xlsx`);
}

export function exportSessionReport(input: {
  cases: CaseRecord[];
  failed: FailedRecord[];
  samples: SpeedSample[];
  sessionMs: number;
}) {
  const wb = XLSX.utils.book_new();
  const rows = input.cases.map((c) => ({
    الساب: c.sab,
    الاسم: c.patientName,
    التليفون: c.phone,
    "مكان العمل": c.workplace,
    الاستمارة: c.formLabel,
    النوع: c.formType,
    التاريخ: c.formDate,
    "حالة الصورة": c.rx.status === "ready" ? "جاهزة" : c.rx.status === "failed" ? "متعثرة" : "قيد الجلب",
    "حالة الأدوية": c.drugs ?? "لم يُحدد",
    "الشهري": c.isMonthly ? (c.monthly ?? "لم يُحدد") : "لا ينطبق",
    "ملاحظة الشهري": c.monthlyReason,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "الاستمارات");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      input.failed.map((f) => ({
        الساب: f.sab,
        الاسم: f.patientName,
        الخطوة: f.step,
        السبب: f.reason,
        الوقت: new Date(f.at).toLocaleString("ar-EG"),
      })),
    ),
    "المتعثرون",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        "مدة الجلسة": `${arNum(Math.round(input.sessionMs / 60000))} دقيقة`,
        "عدد العينات": input.samples.length,
        "أقصى نوافذ": input.samples.length ? Math.max(...input.samples.map((s) => s.workers)) : 0,
      },
    ]),
    "ملخص",
  );
  write(wb, `روشتة-برو-تقرير-الجلسة-${dateKey()}.xlsx`);
}

/** حفظ صورة روشتة واحدة على الجهاز */
export function downloadImage(dataUrl: string, filename: string) {
  if (dataUrl.startsWith("data:")) {
    const [head, body] = dataUrl.split(",");
    const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/png";
    const isB64 = /;base64/.test(head);
    const bytes = isB64 ? Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(body));
    downloadBlob(new Blob([bytes], { type: mime }), `${safeName(filename)}.${mime.includes("svg") ? "svg" : "png"}`);
    return;
  }
  downloadBlob(new Blob([dataUrl]), `${safeName(filename)}.png`);
}

function write(wb: XLSX.WorkBook, filename: string) {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}
