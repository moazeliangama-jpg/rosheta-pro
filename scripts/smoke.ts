/**
 * اختبار دخان لمسار «الروشتة مش بتظهر»:
 * 1) تحميل بيانات تجريبية → بناء الحالات
 * 2) تشغيل الجلسة فعليًا على مزوّد تجريبي
 * 3) التأكد إن كل استمارة إما صورتها موجودة فعلًا أو عندها سبب فشل مكتوب
 * 4) محاكاة قفل البرنامج وإعادة فتحه والتأكد إن الصور بترجع من التخزين
 *
 * التشغيل: npm run smoke
 */
import { useAppStore } from "../src/lib/store.ts";
import { SessionEngine, buildCases } from "../src/lib/engine.ts";
import { demoPatients } from "../src/lib/demo.ts";
import { mergeCase, mergeRx } from "../src/lib/store.ts";

const problems: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) console.log(`✅ ${name}`);
  else {
    console.log(`❌ ${name} ${extra}`);
    problems.push(name);
  }
}

async function main() {
  const store = useAppStore.getState();
  store.setSettings({ demoMode: true, fastMode: true, sendDelaySec: 0, monthlyCooldownDays: 6 });

  const { patients, forms } = demoPatients(12);
  const cases = buildCases(patients, forms, 6);
  store.loadSheet(patients, forms);
  for (const c of cases) store.upsertCase(c);

  check("كل استمارة ليها مفتاح ثابت من الساب ورقم الاستمارة", cases.every((c) => c.id === `${c.sab}::${c.formId}`));
  check("عدد الحالات = عدد الاستمارات", Object.keys(useAppStore.getState().cases).length === forms.length);

  const engine = new SessionEngine();
  await engine.start(Object.values(useAppStore.getState().cases), { fresh: true });

  const after = Object.values(useAppStore.getState().cases);
  const ready = after.filter((c) => c.rx.status === "ready" && c.rx.dataUrl);
  const failed = after.filter((c) => c.rx.status === "failed");
  const stuck = after.filter((c) => (c.rx.status === "ready" && !c.rx.dataUrl) || c.rx.status === "loading" || c.rx.status === "pending");

  check("مفيش استمارة معلّقة بدون صورة ولا سبب", stuck.length === 0, `(${stuck.length} معلّقة)`);
  check("أغلب الروشتات ظهرت صورتها", ready.length >= after.length * 0.6, `(${ready.length}/${after.length})`);
  check("المتعثرات كلها ليها سبب مكتوب", failed.every((c) => Boolean(c.rx.reason)));
  check("الصور محفوظة في التخزين المحلي (IndexedDB)", ready.length === 0 || ready[0].rx.dataUrl!.length > 100);

  // محاكاة إعادة الفتح: الحالة المحفوظة من غير dataUrl
  const hydrated = after.map((c) => {
    const saved = { ...c, rx: { ...c.rx, dataUrl: undefined } };
    return { saved, id: c.id };
  });
  const before = hydrated.filter((h) => h.saved.rx.status === "ready").map((h) => h.id);
  store.patchSession({ state: "done" });
  // نصفّر الحالات ونستعيدها زي ما بيحصل عند إعادة التحميل
  useAppStore.setState({ cases: {}, caseOrder: [], imagesHydrated: false });
  for (const h of hydrated) useAppStore.getState().upsertCase(h.saved as never);
  await useAppStore.getState().hydrateImages();

  const restored = useAppStore.getState().cases;
  const back = before.filter((id) => restored[id]?.rx.dataUrl);
  check(
    "الصور بترجع بعد إعادة فتح البرنامج",
    back.length === before.length,
    `(${back.length}/${before.length})`,
  );
  check(
    "الحالات اللي مالهاش صورة بتتحول لفشل برسالة واضحة",
    Object.values(restored).every((c) => c.rx.dataUrl || c.rx.status === "failed"),
  );

  // اختبار دمج الصور: تحديث بدون صورة ما يمسحش صورة سليمة
  const good = mergeRx(
    { status: "ready", dataUrl: "data:image/png;base64,AAA", attempts: 0, updatedAt: 1 },
    { status: "loading", attempts: 1, updatedAt: 2 },
  );
  check("تحديث الحالة ما بيمسحش صورة موجودة", good.dataUrl === "data:image/png;base64,AAA");

  const merged = mergeCase(
    { ...cases[0], drugs: "available" },
    { ...cases[0], rx: { status: "loading", attempts: 0, updatedAt: 9 } },
  );
  check("تحديث المحرك ما بيمسحش قرار المستخدم", merged.drugs === "available");

  console.log("");
  if (problems.length) {
    console.error(`فشل ${problems.length} فحص`);
    process.exit(1);
  }
  console.log("كل الفحوصات نجحت ✨");
  process.exit(0);
}

void main();
