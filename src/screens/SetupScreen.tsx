import { useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Play, Save, Sparkles, Upload } from "lucide-react";
import { useAppStore } from "../lib/store";
import { readWorkbook } from "../lib/excel";
import { demoPatients } from "../lib/demo";
import { buildCases } from "../lib/engine";
import { Badge, Button, Card, Field, SectionTitle, Toggle } from "../components/ui";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { hasDesktopBridge } from "../lib/provider";
import { arNum } from "../lib/utils";

export function SetupScreen({ onStart }: { onStart: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const loadSheet = useAppStore((s) => s.loadSheet);
  const upsertCase = useAppStore((s) => s.upsertCase);
  const logLine = useAppStore((s) => s.logLine);
  const patients = useAppStore((s) => s.patients);
  const forms = useAppStore((s) => s.forms);
  const resettAll = useAppStore((s) => s.resetAll);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const applySheet = (nextPatients: typeof patients, nextForms: typeof forms) => {
    const cases = buildCases(nextPatients, nextForms, settings.monthlyCooldownDays);
    loadSheet(nextPatients, nextForms);
    for (const c of cases) upsertCase(c);
    logLine("ok", `تم تحميل ${arNum(nextPatients.length)} ساب و${arNum(nextForms.length)} استمارة.`);
  };

  const onFile = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const { patients: p, forms: f } = await readWorkbook(file);
      if (!p.length) throw new Error("الملف مفيهوش عمود «الساب» بأي صف مقروء.");
      applySheet(p, f);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل قراءة الملف";
      setError(msg);
      logLine("error", `فشل قراءة Excel: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const loadDemo = () => {
    const { patients: p, forms: f } = demoPatients(22);
    applySheet(p, f);
  };

  const canStart = patients.length > 0 && forms.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint="مرة واحدة — الإعداد بيتحفظ تلقائيًا">١. الإعداد</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="مكان العمل"
            value={settings.workplace}
            onChange={(e) => setSettings({ workplace: e.target.value })}
            placeholder="مثال: مستشفى القوات المسلحة بالمعادي"
          />
          <Field
            label="الباير (ساب الجلسة)"
            value={settings.buyer}
            onChange={(e) => setSettings({ buyer: e.target.value })}
            placeholder="مثال: ساب شهري"
          />
          <Field
            label="مستخدم نايس دير"
            value={settings.niceDeerUser}
            onChange={(e) => setSettings({ niceDeerUser: e.target.value })}
            placeholder="username"
            dir="ltr"
          />
          <Field
            label="كلمة سر نايس دير"
            type="password"
            value={settings.niceDeerPass}
            onChange={(e) => setSettings({ niceDeerPass: e.target.value })}
            placeholder="••••••••"
            dir="ltr"
            hint="بتتحفظ محليًا على الجهاز فقط"
          />
          <Field
            label="وصل واتساب (رقم المرسل)"
            value={settings.whatsappSender}
            onChange={(e) => setSettings({ whatsappSender: e.target.value })}
            placeholder="2010xxxxxxxx"
            dir="ltr"
          />
          <Field
            label="أرقام الاستقبال (رقم في كل سطر)"
            value={settings.receptionNumbers}
            onChange={(e) => setSettings({ receptionNumbers: e.target.value })}
            placeholder={"201000000000\n201111111111"}
            dir="ltr"
          />
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Toggle
            checked={settings.demoMode}
            onChange={(v) => setSettings({ demoMode: v })}
            label="الوضع التجريبي"
            hint={hasDesktopBridge() ? "مفعّل: بيولّد روشتات تجريبية بدل نايس دير" : "إجباري في المتصفح — نايس دير محتاج نسخة سطح المكتب"}
          />
          <Toggle
            checked={settings.fastMode}
            onChange={(v) => setSettings({ fastMode: v })}
            label="الوضع السريع"
            hint="انتظار ذكي بدل ٥ ثوانٍ ثابتة"
          />
          <Toggle
            checked={settings.preventDelete}
            onChange={(v) => setSettings({ preventDelete: v })}
            label="منع الإرجاع (Delete)"
            hint="يسيب الاستمارة على السيستم"
          />
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="text-sm font-medium text-white">عدد النوافذ</div>
            <div className="mt-2 flex gap-1.5">
              {(["auto", "3", "5", "8", "10"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setSettings({ workerChoice: v })}
                  className={
                    "flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition " +
                    (settings.workerChoice === v
                      ? "border-teal-400/60 bg-teal-500/20 text-teal-200"
                      : "border-white/10 bg-black/20 text-white/55 hover:bg-white/5")
                  }
                >
                  {v === "auto" ? "تلقائي" : v}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle hint="ورقة المرضى + ورقة الاستمارات">٢. ملف Excel</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4" /> {busy ? "جارٍ القراءة…" : "ارفع ملف Excel"}
          </Button>
          <Button variant="ghost" onClick={loadDemo}>
            <Sparkles className="h-4 w-4" /> بيانات تجريبية
          </Button>
          {error ? <span className="text-xs text-rose-300">{error}</span> : null}
          {patients.length > 0 ? (
            <Badge tone="ok">
              <CheckCircle2 className="h-3 w-3" /> {arNum(patients.length)} ساب • {arNum(forms.length)} استمارة
            </Badge>
          ) : (
            <span className="text-xs text-white/40">الأعمدة المطلوبة: الساب، الاسم، التليفون، مكان العمل</span>
          )}
        </div>
        {patients.length > 0 ? (
          <div className="mt-3 max-h-52 overflow-auto rounded-xl border border-white/10">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-[#0f1b1e] text-white/50">
                <tr>
                  <th className="px-3 py-2 font-medium">الساب</th>
                  <th className="px-3 py-2 font-medium">الاسم</th>
                  <th className="px-3 py-2 font-medium">التليفون</th>
                  <th className="px-3 py-2 font-medium">مكان العمل</th>
                </tr>
              </thead>
              <tbody>
                {patients.slice(0, 60).map((p) => (
                  <tr key={p.sab} className="border-t border-white/5 text-white/80">
                    <td className="px-3 py-1.5 tabular-nums">{p.sab}</td>
                    <td className="px-3 py-1.5">{p.name}</td>
                    <td className="px-3 py-1.5 tabular-nums" dir="ltr">{p.phone}</td>
                    <td className="px-3 py-1.5 text-white/60">{p.workplace}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionTitle hint="الجلسة التلقائية والتقرير اليومي">٣. المواعيد</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="ساعة تشغيل الجلسة تلقائيًا"
            type="time"
            value={settings.sessionTime}
            onChange={(e) => setSettings({ sessionTime: e.target.value })}
            dir="ltr"
          />
          <Field
            label="ساعة إرسال الإكسل"
            type="time"
            value={settings.reportTime}
            onChange={(e) => setSettings({ reportTime: e.target.value })}
            dir="ltr"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="lg" onClick={onStart} disabled={!canStart}>
            <Play className="h-4 w-4" /> ابدأ التشغيل الكامل
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              logLine("ok", "تم حفظ الإعداد محليًا.");
            }}
          >
            <Save className="h-4 w-4" /> حفظ
          </Button>
          <Button variant="muted" onClick={() => resettAll()}>
            مسح كل البيانات
          </Button>
          {!canStart ? <span className="text-xs text-white/40">لازم تحمّل الاستمارات الأول</span> : null}
        </div>
      </Card>

      <DiagnosticsPanel />
    </div>
  );
}

export { FileSpreadsheet };
