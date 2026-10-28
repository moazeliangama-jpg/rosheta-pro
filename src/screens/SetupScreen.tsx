import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileSpreadsheet,
  ImageDown,
  Link2,
  ListChecks,
  LogIn,
  MessageCircle,
  QrCode,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  ShieldOff,
  Upload,
  XCircle,
} from "lucide-react";
import { useAppStore } from "../lib/store";
import { readPatientsFile } from "../lib/excel";
import { groupByWorkplace } from "../lib/eligibility";
import { PAYERS } from "../lib/payers";
import { bridge, hasDesktopBridge } from "../lib/provider";
import { Badge, Button, Card, Field, SectionTitle, Toggle } from "../components/ui";

import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { DevicePanel } from "../components/DevicePanel";
import { WorkspacePanel } from "../components/WorkspacePanel";
import { cn, nowTime } from "../lib/utils";

export function SetupScreen({ onScan, onImages }: { onScan: () => void; onImages: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const patients = useAppStore((s) => s.patients);
  const loadPatients = useAppStore((s) => s.loadPatients);
  const resetRun = useAppStore((s) => s.resetRun);
  const cases = useAppStore((s) => s.cases);
  const logLine = useAppStore((s) => s.logLine);
  const loggedIn = useAppStore((s) => s.niceDeerLoggedIn);
  const setLoggedIn = useAppStore((s) => s.setLoggedIn);
  const session = useAppStore((s) => s.session);

  const [busy, setBusy] = useState<"login" | "file" | "wa" | null>(null);
  const [loginNote, setLoginNote] = useState("");
  const [waState, setWaState] = useState("closed");
  const [probeSab, setProbeSab] = useState("");
  // ٧٣) الإعدادات المتقدمة مطوية افتراضيًا — زرار التشغيل هو الواجهة
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [probeResult, setProbeResult] = useState<string>("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const workplaces = useMemo(() => groupByWorkplace(patients), [patients]);
  const filtered = useMemo(
    () => patients.filter((p) => !settings.workplace || (p.workplace || "بدون مكان عمل") === settings.workplace),
    [patients, settings.workplace],
  );
  const caseList = Object.values(cases);
  const hasScan = caseList.length > 0;
  const needsImages = caseList.filter((c) => c.valid && c.rx.status !== "ready").length;

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    void b.wa.status().then((res) => setWaState(String(res?.state ?? "closed")));
    // بيانات الدخول بقت مشفّرة على القرص (مش نص صريح في الإعدادات)
    void b.credentials.load().then((res) => {
      if (!res?.ok || !res.data) return;
      setSettings({ niceDeerUser: res.data.username, niceDeerPass: res.data.password });
    });
  }, [setSettings]);

  /** حفظ مشفّر لبيانات الدخول — بيتنادى بعد نجاح الدخول أو لو اليوزر طلب */
  const saveCredentials = async () => {
    const b = bridge();
    if (!b) return;
    const res = await b.credentials.save({
      username: settings.niceDeerUser,
      password: settings.niceDeerPass,
    });
    if (!res.ok) setError(res.error ?? "تعذر حفظ بيانات الدخول");
  };

  const doLogin = async () => {
    if (!hasDesktopBridge()) return;
    setBusy("login");
    setLoginNote("");
    setError("");
    try {
      const b = bridge()!;
      await b.setCredentials({ username: settings.niceDeerUser, password: settings.niceDeerPass });
      const res = await b.login({ username: settings.niceDeerUser, password: settings.niceDeerPass });
      if (res.ok) {
        await saveCredentials();
        setLoggedIn(true);
        setLoginNote(res.already ? "الجلسة مسجلة بالفعل — مفيش حاجة تتعمل." : "تم تسجيل الدخول بنجاح.");
        logLine("ok", "تسجيل دخول نايس دير ناجح.");
      } else {
        setLoggedIn(false);
        setLoginNote(res.error ?? "فشل تسجيل الدخول");
        logLine("error", `فشل دخول نايس دير: ${res.error}`);
      }
    } finally {
      setBusy(null);
    }
  };

  const doUpload = async (file: File) => {
    setBusy("file");
    setError("");
    try {
      const list = await readPatientsFile(file);
      if (!list.length) throw new Error("الملف مفيهوش عمود الساب بأي صف مقروء");
      loadPatients(list);
      resetRun();
      const groups = groupByWorkplace(list);
      const first = [...groups.keys()][0] ?? "";
      setSettings({ workplace: first });
      logLine("ok", `تم تحميل ${list.length} ساب في ${groups.size} مكان عمل.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل قراءة الملف";
      setError(msg);
      logLine("error", `فشل قراءة Excel: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const startScan = () => {
    if (!settings.payerId) {
      setError("اختر الباير الأول — من غيره البحث مش هيجيب استمارات.");
      return;
    }
    if (!filtered.length) {
      setError("مفيش سابات في مكان العمل المختار.");
      return;
    }
    setError("");
    onScan();
  };

  return (
    <div className="space-y-4">
      {!hasDesktopBridge() ? (
        <Card className="border-rose-500/30 bg-rose-950/20">
          <div className="flex items-start gap-3">
            <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
            <div>
              <div className="text-sm font-bold text-rose-200">الأتمتة الحقيقية محتاجة نسخة سطح المكتب</div>
              <p className="mt-1 text-xs leading-relaxed text-rose-100/60">
                المتصفح مش قادر يفتح نوافذ نايس دير المخفية ولا يقرأ صور الروشتات. شغّل نسخة الـ EXE
                (<code className="rounded bg-black/40 px-1">npm run build</code> ثم{" "}
                <code className="rounded bg-black/40 px-1">npx electron .</code> على ويندوز). كل الشاشات هتشتغل
                بأتمتة حقيقية بعد كده.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <DevicePanel />

      {/* 1) نايس دير */}
      <Card>
        <SectionTitle hint="بيتحفظوا مشفّرين على الجهاز — مش نص صريح">١. دخول نايس دير والباير</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="اسم المستخدم"
            value={settings.niceDeerUser}
            onChange={(e) => setSettings({ niceDeerUser: e.target.value })}
            placeholder="Username"
            dir="ltr"
            autoComplete="off"
          />
          <Field
            label="كلمة السر"
            type="password"
            value={settings.niceDeerPass}
            onChange={(e) => setSettings({ niceDeerPass: e.target.value })}
            placeholder="Password"
            dir="ltr"
            autoComplete="off"
          />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-white/80">الباير (Payer)</span>
            <select
              value={settings.payerId}
              onChange={(e) => {
                const p = PAYERS.find((x) => x.id === e.target.value);
                setSettings({ payerId: e.target.value, payerName: p?.name ?? "" });
              }}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-white focus:border-teal-400/60 focus:outline-none"
            >
              <option value="">— اختر الباير —</option>
              {PAYERS.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#0b1518]">
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button onClick={() => void doLogin()} disabled={busy === "login" || !hasDesktopBridge()} className="flex-1">
              {busy === "login" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              اختبار الدخول
            </Button>
            <Button
              variant="muted"
              onClick={() => void saveCredentials()}
              disabled={!settings.niceDeerUser || !settings.niceDeerPass || !hasDesktopBridge()}
              title="بيتحفظوا مشفّرين بمفتاح ويندوز — مش نص صريح"
            >
              <ShieldCheck className="h-4 w-4" />
              حفظ
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-1 ps-3">
            <span className="text-[11px] text-white/40">تجربة ساب:</span>
            <input
              value={probeSab}
              onChange={(e) => setProbeSab(e.target.value)}
              placeholder="اكتب رقم الساب"
              dir="ltr"
              className="w-28 bg-transparent px-1 py-1 text-sm text-white placeholder:text-white/25 focus:outline-none"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={!probeSab || !settings.payerId || !hasDesktopBridge()}
              onClick={async () => {
                setProbeResult("بيبحث في نايس دير…");
                const res = await bridge()?.searchSub({
                  sab: probeSab.trim(),
                  payerId: settings.payerId,
                  payerName: settings.payerName,
                });
                if (!res?.ok) {
                  setProbeResult(`فشل: ${res?.error ?? "خطأ غير معروف"}`);
                  logLine("error", `تجربة الساب ${probeSab}: ${res?.error}`);
                  return;
                }
                const d = res.data as {
                  forms: Array<{ reference: string; date: string; type: string; source: string }>;
                  phone: string;
                  note?: string;
                };
                const summary = d.forms.length
                  ? `${d.forms.length} استمارة • تليفون ${d.phone || "غير موجود"} • ${d.forms
                      .map((f) => `${f.reference} (${f.source === "pre-approval" ? "Pre-Approval" : "Claim"} ${f.date})`)
                      .slice(0, 4)
                      .join("، ")}`
                  : d.note || "مفيش استمارات";
                setProbeResult(summary);
                logLine("ok", `تجربة الساب ${probeSab}: ${summary}`);
              }}
            >
              <Search className="h-3.5 w-3.5" /> جرّب
            </Button>
          </div>
          {probeResult ? <span className="text-[11px] text-white/50">{probeResult}</span> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {loggedIn ? (
            <Badge tone="ok">
              <CheckCircle2 className="h-3 w-3" /> داخل على نايس دير
            </Badge>
          ) : (
            <Badge tone="warn">
              <XCircle className="h-3 w-3" /> الدخول مش متأكد
            </Badge>
          )}
          {loginNote ? <span className="text-xs text-white/50">{loginNote}</span> : null}
          <button
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/50 hover:bg-white/5"
            onClick={async () => {
              await bridge()?.logoutNiceDeer();
              setLoggedIn(false);
              logLine("warn", "تم مسح جلسة نايس دير من الجهاز.");
            }}
          >
            مسح الجلسة
          </button>
          <button
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/50 hover:bg-white/5"
            onClick={() => void bridge()?.openSearchSite()}
          >
            <Link2 className="mr-1 inline h-3 w-3" /> فتح الموقع للتأكد
          </button>
        </div>
      </Card>

      {/* 2) السابات */}
      <Card
        // ٨٠) سحب وإفلات ملف Excel على البطاقة نفسها
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) void doUpload(f);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        className={dragging ? "border-teal-400/60 bg-teal-500/5" : undefined}
      >
        <SectionTitle hint="الساب + الاسم + مكان العمل — أو اسحب الملف هنا">٢. ملف السابات (Excel)</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doUpload(f);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={busy === "file"}>
            <Upload className="h-4 w-4" /> {busy === "file" ? "جارٍ القراءة…" : "ارفع ملف Excel"}
          </Button>
          <select
            value={settings.workplace}
            onChange={(e) => setSettings({ workplace: e.target.value })}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white focus:border-teal-400/60 focus:outline-none"
          >
            <option value="">كل أماكن العمل ({patients.length})</option>
            {[...workplaces.entries()].map(([name, list]) => (
              <option key={name} value={name} className="bg-[#0b1518]">
                {name} ({list.length})
              </option>
            ))}
          </select>
          <Badge tone={filtered.length ? "ok" : "neutral"}>
            <FileSpreadsheet className="h-3 w-3" /> {filtered.length} ساب هيتشغلوا
          </Badge>
          {error ? <span className="text-xs text-rose-300">{error}</span> : null}
        </div>

        {filtered.length > 0 ? (
          <div className="mt-3 max-h-48 overflow-auto rounded-xl border border-white/10">
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
                {filtered.slice(0, 80).map((p) => (
                  <tr key={p.sab} className="border-t border-white/5 text-white/80">
                    <td className="px-3 py-1.5 tabular-nums">{p.sab}</td>
                    <td className="px-3 py-1.5">{p.name}</td>
                    <td className="px-3 py-1.5 tabular-nums" dir="ltr">
                      {p.phone}
                    </td>
                    <td className="px-3 py-1.5 text-white/60">{p.workplace}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {/* 3) التشغيل */}
      <Card>
        <SectionTitle hint="١ جرد ← ٢ صور">٣. التشغيل</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="text-xs text-white/50">مدة صلاحية الاستمارة</div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={30}
                value={settings.validityDays}
                onChange={(e) => setSettings({ validityDays: Math.max(1, Number(e.target.value) || 6) })}
                className="w-16 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-center text-sm tabular-nums text-white focus:outline-none"
              />
              <span className="text-xs text-white/50">يوم (Pre-Approval: الشهر الحالي)</span>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="text-xs text-white/50">عدد نوافذ نايس دير</div>
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-[10px] text-teal-300/80 hover:text-teal-200"
              >
                {settings.workerChoice === "auto" ? "تحديد يدوي" : "تلقائي"}
              </button>
            </div>
            {settings.workerChoice === "auto" ? (
              // ٧٤) في التلقائي بنخفي الأرقام — البرنامج بيقرر من سرعة الجهاز والقياس
              <div className="mt-1.5 text-[11px] leading-relaxed text-white/45">
                البرنامج بيبدأ بعدد مناسب لجهازك (رام وأنوية) ويزوّد أو يقلّل حسب السرعة الحقيقية.
              </div>
            ) : (
              <div className="mt-1.5 flex gap-1">
                {(["auto", "5", "8", "12", "16"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setSettings({ workerChoice: v })}
                    className={cn(
                      "flex-1 rounded-md border px-1.5 py-1 text-[11px] font-semibold transition",
                      settings.workerChoice === v
                        ? "border-teal-400/60 bg-teal-500/20 text-teal-200"
                        : "border-white/10 text-white/50 hover:bg-white/5",
                    )}
                  >
                    {v === "auto" ? "تلقائي" : v}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Toggle
            checked={!settings.preventDelete}
            onChange={(v) => setSettings({ preventDelete: !v })}
            label="الإرجاع بعد التصوير (Delete)"
            hint="#btn-DeleteClaim — زي طريقة الصرف"
          />
          <Toggle
            checked={settings.turboMode}
            onChange={(v) => setSettings({ turboMode: v })}
            label="الوضع المرعب ⚡ (Turbo)"
            hint="تسخين النوافذ + إعادة استخدام نتائج البحث + إرجاع Delete في الخلفية"
          />
        </div>

        {/* ٧٣) الإعدادات المتقدمة مطوية: زرار «ابدأ» هو الواجهة الأساسية */}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="mt-3 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-white/50 hover:bg-white/5"
        >
          {showAdvanced ? "إخفاء الإعدادات المتقدمة ▲" : "إعدادات متقدمة ▼ (خارج المدة · تصدير تلقائي)"}
        </button>

        {showAdvanced ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Toggle
              checked={settings.includeInvalid}
              onChange={(v) => setSettings({ includeInvalid: v })}
              label="جلب صور خارج المدة"
              hint="افتراضيًا بنجيب الصور للمستمارات داخل المدة بس"
            />
            <Toggle
              checked={settings.autoExport}
              onChange={(v) => setSettings({ autoExport: v })}
              label="تصدير تقرير الجلسة تلقائيًا"
              hint="إكسل توقيت الخطوات + أبطأ السابات في آخر الجلسة"
            />
            <Toggle
              checked={settings.onlyNewForms}
              onChange={(v) => setSettings({ onlyNewForms: v })}
              label="جلسة «الجديد فقط»"
              hint="بيجيب صور الاستمارات اللي ظهرت النهاردة بس — مش اللي اشتغلت عليها قبل كده"
            />
            <Toggle
              checked={settings.debugMode}
              onChange={(v) => setSettings({ debugMode: v })}
              label="وضع التشخيص"
              hint="بيحفظ لقطة HTML عند فشل قراءة الجدول (مفيد لو نايس دير غيّر الصفحة)"
            />
            <Toggle
              checked={settings.compactMode}
              onChange={(v) => setSettings({ compactMode: v })}
              label="وضع الشاشة الصغيرة"
              hint="واجهة أضيق وأخف للابتوب"
            />
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
              <div className="text-xs text-white/50">الحد اليومي للرسائل</div>
              <input
                type="number"
                min={10}
                max={2000}
                value={settings.dailySendLimit}
                onChange={(e) => setSettings({ dailySendLimit: Math.max(10, Number(e.target.value) || 300) })}
                className="mt-1 w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-center text-sm tabular-nums text-white focus:outline-none"
              />
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
              <div className="text-xs text-white/50">عشوائية فاصل الإرسال ±٪</div>
              <input
                type="number"
                min={0}
                max={80}
                value={settings.sendJitterPct}
                onChange={(e) => setSettings({ sendJitterPct: Math.max(0, Math.min(80, Number(e.target.value) || 0)) })}
                className="mt-1 w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-center text-sm tabular-nums text-white focus:outline-none"
              />
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="lg" onClick={startScan} disabled={session.state === "scanning" || session.state === "running"}>
            <Search className="h-4 w-4" /> ١) جرد الاستمارات
          </Button>
          <Button
            size="lg"
            variant="success"
            onClick={onImages}
            disabled={!hasScan || needsImages === 0 || session.state === "running" || session.state === "scanning"}
          >
            <ImageDown className="h-4 w-4" /> ٢) جلب صور الروشتات ({needsImages})
          </Button>
          <Button variant="ghost" onClick={() => useAppStore.getState().setScreen("decision")} disabled={!hasScan}>
            <ListChecks className="h-4 w-4" /> شاشة القرار
          </Button>
          {session.startedAt ? (
            <span className="text-xs text-white/40">
              آخر تشغيل {nowTime(session.startedAt)} — {session.images} صورة
            </span>
          ) : null}
        </div>
        {!settings.preventDelete ? (
          <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            تنبيه: «الإرجاع» مفعّل — البرنامج هيضغط <code>#btn-DeleteClaim</code> على كل استمارة بعد التقاط صورتها
            (زي طريقة الصرف). لو مش عايز ده، اقفل الخيار قبل التشغيل.
          </p>
        ) : null}
      </Card>

      <WorkspacePanel />

      {/* 4) واتساب */}
      <Card>
        <SectionTitle hint="مرة واحدة — بعدها بيفضل متصل">٤. واتساب ويب</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={waState === "ready" ? "ok" : waState === "qr" ? "warn" : "neutral"}>
            <MessageCircle className="h-3 w-3" />
            {waState === "ready" ? "متصل" : waState === "qr" ? "محتاج QR" : waState === "closed" ? "مقفول" : waState}
          </Badge>
          <Button
            size="sm"
            onClick={async () => {
              setBusy("wa");
              const res = await bridge()?.wa.pair();
              setWaState(String(res?.state ?? "loading"));
              setBusy(null);
            }}
            disabled={busy === "wa" || !hasDesktopBridge()}
          >
            <QrCode className="h-3.5 w-3.5" /> {busy === "wa" ? "افتح النافذة وامسح الكود…" : "ربط / مسح QR"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await bridge()?.wa.status().then((r) => setWaState(String(r?.state ?? "closed")));
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> تحديث الحالة
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              await bridge()?.wa.logout();
              setWaState("closed");
              logLine("warn", "تم فصل واتساب ومسح الجلسة.");
            }}
          >
            فصل الاتصال
          </Button>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-white/80">رسالة «بها دواء»</span>
            <textarea
              value={settings.messageDrugs}
              onChange={(e) => setSettings({ messageDrugs: e.target.value })}
              rows={3}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-teal-400/60 focus:outline-none"
            />
            <span className="mt-1 block text-[11px] text-white/35">{"{name}"} = الاسم الأول، {"{sab}"} = الساب، {"{count}"} = عدد الاستمارات</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-white/80">رسالة «الشهري متاح»</span>
            <textarea
              value={settings.messageMonthly}
              onChange={(e) => setSettings({ messageMonthly: e.target.value })}
              rows={3}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-teal-400/60 focus:outline-none"
            />
          </label>
          <Field
            label="كلمات الرد الإيجابي"
            value={settings.replyPositive}
            onChange={(e) => setSettings({ replyPositive: e.target.value })}
            hint="مفصولة بفاصلة"
          />
          <Field
            label="كلمات الرد السلبي"
            value={settings.replyNegative}
            onChange={(e) => setSettings({ replyNegative: e.target.value })}
            hint="مفصولة بفاصلة"
          />
          <Field
            label="كلمات طلب التأجيل"
            value={settings.replyPostpone}
            onChange={(e) => setSettings({ replyPostpone: e.target.value })}
            hint="مفصولة بفاصلة"
          />
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="text-xs text-white/50">الفاصل بين الرسائل (ثانية)</div>
            <input
              type="number"
              min={3}
              max={120}
              value={settings.sendDelaySec}
              onChange={(e) => setSettings({ sendDelaySec: Math.max(3, Number(e.target.value) || 8) })}
              className="mt-1 w-20 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-center text-sm tabular-nums text-white focus:outline-none"
            />
          </div>
        </div>
      </Card>

      {/* 5) المواعيد */}
      <Card>
        <SectionTitle hint="تلقائي يوميًا">٥. المواعيد</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="ساعة تشغيل الجرد تلقائيًا"
            type="time"
            value={settings.sessionTime}
            onChange={(e) => setSettings({ sessionTime: e.target.value })}
            dir="ltr"
          />
          <Field
            label="ساعة تصدير إكسل الموافقين"
            type="time"
            value={settings.reportTime}
            onChange={(e) => setSettings({ reportTime: e.target.value })}
            dir="ltr"
          />
          <Field
            label="أرقام الاستقبال"
            value={settings.receptionNumbers}
            onChange={(e) => setSettings({ receptionNumbers: e.target.value })}
            placeholder={"201000000000,201111111111"}
            dir="ltr"
            hint="مفصولة بفاصلة — بتستقبل إكسل الموافقين"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => logLine("ok", "الإعداد بيتحفظ تلقائيًا على الجهاز.")}>
            <Save className="h-4 w-4" /> حفظ
          </Button>
          <Button
            variant="muted"
            onClick={() => {
              if (confirm("هيتم مسح السابات والاستمارات والصور من الجهاز. متأكد؟")) useAppStore.getState().resetAll();
            }}
          >
            مسح كل البيانات
          </Button>
        </div>
      </Card>

      <DiagnosticsPanel />
    </div>
  );
}
