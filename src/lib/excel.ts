import * as XLSX from "xlsx";
import type {
  CaseRecord,
  FailedRecord,
  MonthlyCheck,
  OutreachMessage,
  PatientRow,
  SpeedSample,
  StepSample,
} from "./types";
import { STEP_LABEL, bottleneck, slowestSabs, stepsToCsv, summarize } from "./metrics";
import { dateKey, deleteLabel, downloadBlob, normalizeSab, safeName } from "./utils";
import { bridge } from "./provider";

/**
 * نتيجة حفظ ملف تصدير.
 *
 * المهم هنا: لو البرنامج شغال سطح مكتب، الملف بيتكتب على القرص فعلاً
 * وبيرجع مساره — يعني «تم التصدير» مش كلام، ده مسار تقدر تفتحه.
 */
export interface SaveResult {
  ok: boolean;
  /** المسار الكامل للملف (نسخة سطح المكتب) */
  file?: string;
  name?: string;
  bytes?: number;
  error?: string;
  /** true لما الحفظ يكون تنزيل متصفح مش كتابة مؤكدة على القرص */
  unverified?: boolean;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** كتابة بايتات: على القرص في نسخة سطح المكتب، وتنزيل عادي في المتصفح */
async function saveBytes(bytes: Uint8Array, filename: string, mime: string): Promise<SaveResult> {
  if (!bytes.length) return { ok: false, error: "الملف فاضي — مفيش بيانات تتصدّر" };
  const b = bridge();
  if (b?.saveFile) {
    const res = await b.saveFile({ name: filename, base64: bytesToBase64(bytes) });
    if (!res?.ok || !res.data?.file) {
      return { ok: false, error: res?.error || "تعذر حفظ الملف على القرص" };
    }
    return { ok: true, file: res.data.file, name: res.data.name, bytes: res.data.bytes };
  }
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  downloadBlob(new Blob([copy.buffer], { type: mime }), filename);
  return { ok: true, name: filename, bytes: bytes.length, unverified: true };
}

const SOURCE_LABEL: Record<string, string> = {
  "pre-approval": "Pre-Approval",
  claim: "Claim",
};

/** يقرأ ملف السابات: الساب + الاسم + مكان العمل (+ تليفون لو موجود) */
export async function readPatientsFile(file: File): Promise<PatientRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const pick = (row: Record<string, unknown>, keys: string[]) => {
    for (const k of Object.keys(row)) {
      const norm = k.trim();
      if (keys.some((x) => norm === x || norm.includes(x))) {
        const v = row[k];
        if (v instanceof Date) return dateKey(v);
        const s = String(v ?? "").trim();
        if (s) return s;
      }
    }
    return "";
  };

  const patients: PatientRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // الساب بياخد نفس التنظيف اللي في preparePatients (مسافات/أرقام عربية/شرطات)،
    // وبعد التنظيف بنشيل المكرر — قبل كده «١٢٣٤٥» و«12345» كانوا بيعدّوا كسابين.
    const sab = normalizeSab(pick(row, ["الساب", "sab", "Sub", "Card", "كارت"]));
    if (!sab || seen.has(sab)) continue;
    seen.add(sab);
    patients.push({
      sab,
      name: pick(row, ["الاسم", "اسم المريض", "name", "Name"]),
      phone: pick(row, ["التليفون", "الهاتف", "الموبايل", "phone", "mobile"]),
      workplace: pick(row, ["مكان العمل", "العمل", "الجهة", "workplace", "employer"]),
    });
  }
  return patients;
}

/** 1) جرد الاستمارات: كل ساب وعدد استماراته وأرقامها المرجعية وأنواعها */
export async function exportAnalysis(cases: CaseRecord[]) {
  const bySab = new Map<string, CaseRecord[]>();
  for (const c of cases) {
    if (!bySab.has(c.sab)) bySab.set(c.sab, []);
    bySab.get(c.sab)!.push(c);
  }
  const rows = [...bySab.values()].map((list) => {
    const first = list[0];
    const valid = list.filter((c) => c.valid);
    return {
      الساب: first.sab,
      الاسم: first.patientName,
      "رقم التليفون": first.phone,
      "مكان العمل": first.workplace,
      "عدد الاستمارات": list.length,
      "عدد داخل المدة": valid.length,
      "الأرقام المرجعية": valid.map((c) => c.reference).join("، "),
      "نوع كل استمارة": valid.map((c) => `${SOURCE_LABEL[c.source] ?? c.source}${c.monthly ? " (شهري)" : ""}`).join("، "),
      "التواريخ": valid.map((c) => c.formDate).join("، "),
      "أرقام خارج المدة": list.filter((c) => !c.valid).map((c) => `${c.reference} (${c.validityReason})`).join("، "),
      "حالة الصور": list
        .map((c) => `${c.reference}: ${c.rx.status === "ready" ? "تم" : c.rx.status === "failed" ? "متعثر" : "لم يُجلب"}`)
        .join("، "),
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "جرد الاستمارات");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      cases.map((c) => ({
        الساب: c.sab,
        الاسم: c.patientName,
        "الرقم المرجعي": c.reference,
        المصدر: SOURCE_LABEL[c.source] ?? c.source,
        النوع: c.type || c.claimType,
        "شهري؟": c.monthly ? "نعم" : "لا",
        التاريخ: c.formDate,
        "داخل المدة": c.valid ? "نعم" : "لا",
        "سبب الاستبعاد": c.valid ? "" : c.validityReason,
        "بها دواء": c.hasDrugs === "available" ? "نعم" : c.hasDrugs === "unavailable" ? "لا" : "",
      })),
    ),
    "تفصيل كل استمارة",
  );
  const saved = await write(wb, `روشتة-برو-جرد-الاستمارات-${dateKey()}.xlsx`);
  return { ...saved, count: rows.length };
}

/** 2) إكسل الاستمارات اللي بها دواء */
export async function exportWithDrugs(cases: CaseRecord[]) {
  const bySab = new Map<string, CaseRecord[]>();
  for (const c of cases) {
    if (c.hasDrugs !== "available") continue;
    if (!bySab.has(c.sab)) bySab.set(c.sab, []);
    bySab.get(c.sab)!.push(c);
  }
  const rows = [...bySab.values()].map((list) => ({
    الاسم: list[0].patientName,
    الساب: list[0].sab,
    "رقم التليفون": list[0].phone,
    "عدد الاستمارات": list.length,
    "الأرقام المرجعية": list.map((c) => c.reference).join("، "),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "بها دواء");
  const saved = await write(wb, `روشتة-برو-بها-دواء-${dateKey()}.xlsx`);
  return { ...saved, count: rows.length };
}

/** 3) إكسل استمارات Pre-Approval */
export async function exportPreApproval(cases: CaseRecord[]) {
  const rows = cases
    .filter((c) => c.source === "pre-approval")
    .map((c) => ({
      الاسم: c.patientName,
      الساب: c.sab,
      "رقم التليفون": c.phone,
      "الرقم المرجعي": c.reference,
      التاريخ: c.formDate,
      "داخل الشهر": c.valid ? "نعم" : "لا",
    }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Pre-Approval");
  const saved = await write(wb, `روشتة-برو-PreApproval-${dateKey()}.xlsx`);
  return { ...saved, count: rows.length };
}

/** 4) إكسل الشهري لكل ساب (مع التأكيد) */
export async function exportMonthly(monthly: MonthlyCheck[]) {
  const rows = monthly.map((m) => ({
    الساب: m.sab,
    الاسم: m.patientName,
    "رقم التليفون": m.phone,
    "مكان العمل": m.workplace,
    "الشهري متاح": m.confirmed === "available" ? "نعم" : m.confirmed === "unavailable" ? "لا" : m.computed === "available" ? "نعم (حسب النظام)" : "لا (حسب النظام)",
    "آخر استمارة شهرية": m.lastMonthlyRef,
    "تاريخ آخر شهري": m.lastMonthlyDate,
    "مرّ عليها (يوم)": m.daysSince ?? "",
    الملاحظة: m.reason,
    "تأكيد المستخدم": m.confirmed ? (m.confirmed === "available" ? "متاح" : "غير متاح") : "لم يُأكد",
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "الشهري");
  const saved = await write(wb, `روشتة-برو-الشهري-${dateKey()}.xlsx`);
  return { ...saved, count: rows.length };
}

/** 5) إكسل الموافقين (الرد الإيجابي) — عمود الحساب فاضي */
export async function exportApproved(cases: CaseRecord[], outreach: OutreachMessage[]) {
  const approvedSabs = new Set(outreach.filter((m) => m.reply === "approved").map((m) => m.sab));
  const rows = cases
    .filter((c) => approvedSabs.has(c.sab) && c.valid && (c.hasDrugs === "available" || c.monthly))
    .map((c) => ({
      الساب: c.sab,
      الاسم: c.patientName,
      "رقم التليفون": c.phone,
      الاستمارة: c.reference,
      "نوع الاستمارة": `${SOURCE_LABEL[c.source] ?? c.source}${c.monthly ? " / شهري" : ""}`,
      الحساب: "",
    }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "الموافقون");
  const saved = await write(wb, `روشتة-برو-الموافقون-${dateKey()}.xlsx`);
  return { ...saved, count: rows.length };
}

export async function exportFailed(failed: FailedRecord[], meta: Record<string, string | number>) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      failed.map((f) => ({
        الساب: f.sab,
        الاسم: f.patientName,
        "مكان العمل": f.workplace,
        الخطوة: f.step,
        "الرقم المرجعي": f.reference,
        السبب: f.reason,
        الوقت: new Date(f.at).toLocaleString("ar-EG"),
      })),
    ),
    "متعثرات",
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([meta]), "ملخص");
  return write(wb, `روشتة-برو-متعثرات-${dateKey()}.xlsx`);
}

export async function exportSessionReport(input: {
  cases: CaseRecord[];
  failed: FailedRecord[];
  samples: SpeedSample[];
  sessionMs: number;
  /** قياس كل خطوة — لو موجودة بيتولّد شيت توقيت + أبطأ ١٠ سابات */
  steps?: StepSample[];
}) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      input.cases.map((c) => ({
        الساب: c.sab,
        الاسم: c.patientName,
        "الرقم المرجعي": c.reference,
        المصدر: SOURCE_LABEL[c.source] ?? c.source,
        التاريخ: c.formDate,
        "داخل المدة": c.valid ? "نعم" : "لا",
        "حالة الصورة": c.rx.status === "ready" ? "جاهزة" : c.rx.status === "failed" ? "متعثرة" : "لم تُجلب",
        "طريقة الالتقاط": c.rx.method ?? "",
        "الإرجاع (Delete)": c.deleted ? "تم" : deleteLabel(c.deleteState),
        "بها دواء": c.hasDrugs ?? "لم يُحدد",
      })),
    ),
    "الاستمارات",
  );
  const steps = input.steps ?? [];
  const bn = bottleneck(steps);
  const slow = slowestSabs(steps, 10);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        "مدة التشغيل (دقيقة)": Math.round(input.sessionMs / 60000),
        "عدد العينات": input.samples.length,
        "أقصى عدد نوافذ": input.samples.length ? Math.max(...input.samples.map((s) => s.workers)) : 0,
        "الاختناق": bn.step === "idle" ? "" : `${bn.label} (${bn.share}٪)`,
        "متوسط البحث (مللي)": summarize(steps, "search")[0]?.avg ?? 0,
        "متوسط الالتقاط (مللي)": summarize(steps, "capture")[0]?.avg ?? 0,
        "متوسط الإرجاع (مللي)": summarize(steps, "delete")[0]?.avg ?? 0,
      },
    ]),
    "ملخص",
  );

  if (steps.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        steps.map((x) => ({
          الوقت: new Date(x.at).toISOString(),
          الساب: x.sab,
          الخطوة: STEP_LABEL[x.step] ?? x.step,
          "مللي ثانية": x.ms,
          نجحت: x.ok ? "نعم" : "لا",
          ملاحظة: x.note ?? "",
        })),
      ),
      "توقيت الخطوات",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        slow.map((r) => ({
          الساب: r.sab,
          "الإجمالي (مللي)": r.totalMs,
          "بحث (مللي)": r.searchMs,
          "التقاط (مللي)": r.captureMs,
          "إرجاع (مللي)": r.deleteMs,
          "صور": r.forms,
        })),
      ),
      "أبطأ السابات",
    );
  }

  return write(wb, `روشتة-برو-تقرير-التشغيل-${dateKey()}.xlsx`);
}

/** تنزيل CSV بتوقيت كل خطوة — أخف وأسرع من إكسل للتحليل السريع */
export async function exportStepsCsv(steps: StepSample[]) {
  const csv = stepsToCsv(steps);
  const bytes = new TextEncoder().encode("\uFEFF" + csv);
  const saved = await saveBytes(bytes, `روشتة-برو-توقيت-${dateKey()}.csv`, "text/csv;charset=utf-8");
  return { ...saved, count: steps.length };
}

export async function downloadImage(dataUrl: string, filename: string): Promise<SaveResult> {
  if (!dataUrl.startsWith("data:")) return { ok: false, error: "مفيش صورة للتصدير" };
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/png";
  const isB64 = /;base64/.test(head);
  const bytes = isB64
    ? Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(body));
  const ext = mime.includes("svg") ? "svg" : mime.includes("jpeg") ? "jpg" : "png";
  return saveBytes(bytes, `${safeName(filename)}.${ext}`, mime);
}

async function write(wb: XLSX.WorkBook, filename: string): Promise<SaveResult> {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return saveBytes(new Uint8Array(out), filename, XLSX_MIME);
}
