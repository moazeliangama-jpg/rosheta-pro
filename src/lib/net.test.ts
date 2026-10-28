// اختبارات كشف انقطاع النت ونسخة الاحتياطية اليومية (٦٧ / ٦٠)
import test from "node:test";
import assert from "node:assert/strict";
import { OFFLINE_MESSAGE, isOnline, waitForOnline } from "./net";
import { BACKUP_KEEP, backupName, shouldBackup } from "./backup";

const withNavigator = (onLine: boolean | undefined, fn: () => Promise<void> | void) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine },
    configurable: true,
    writable: true,
  });
  return Promise.resolve(fn()).finally(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });
};

test("بيعتبر الاتصال شغال لو navigator.onLine مش معرّف", async () => {
  await withNavigator(undefined, () => {
    assert.equal(isOnline(), true);
  });
});

test("بيبعت false لما الاتصال واقف", async () => {
  await withNavigator(false, () => {
    assert.equal(isOnline(), false);
  });
});

test("waitForOnline بيرجع فورًا لو الاتصال موجود", async () => {
  await withNavigator(true, async () => {
    const t0 = Date.now();
    assert.equal(await waitForOnline(), true);
    assert.ok(Date.now() - t0 < 500);
  });
});

test("waitForOnline بيستنى ويرجع false لو المهلة خلصت والنت لسه واقف", async () => {
  await withNavigator(false, async () => {
    let waited = 0;
    const t0 = Date.now();
    const ok = await waitForOnline({ timeoutMs: 60, pollMs: 20, onWait: () => (waited += 1) });
    assert.equal(ok, false);
    assert.ok(waited >= 1, "لازم يقول للمستخدم إنه بيستنى");
    assert.ok(Date.now() - t0 < 2000);
  });
});

test("waitForOnline بيقف لو الجلسة اتلغت", async () => {
  await withNavigator(false, async () => {
    const signal = { cancelled: true };
    assert.equal(await waitForOnline({ timeoutMs: 5000, pollMs: 20, signal }), false);
  });
});

test("رسالة الانقطاع بتطمن المستخدم إن الشغل محفوظ", () => {
  assert.match(OFFLINE_MESSAGE, /الشغل محفوظ/);
  assert.match(OFFLINE_MESSAGE, /النت/);
});

test("اسم النسخة الاحتياطية بالتاريخ", () => {
  assert.equal(backupName(new Date(2026, 9, 28)), "rosheta-backup-2026-10-28.json");
});

test("نسخة واحدة بس في اليوم", () => {
  assert.equal(shouldBackup(null, "2026-10-28"), true);
  assert.equal(shouldBackup("2026-10-27", "2026-10-28"), true);
  assert.equal(shouldBackup("2026-10-28", "2026-10-28"), false);
});

test("بنحتفظ بـ٧ نسخ بس", () => {
  assert.equal(BACKUP_KEEP, 7);
});
