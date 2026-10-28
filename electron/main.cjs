// ============================================================================
// روشتة برو — محرك أتمتة نايس دير الحقيقي (Electron main process)
//
// كل خطوة هنا بتتعمل فعليًا على https://nicedeer.net بنفس ترتيب الصرف اللي
// المستخدم حدده:
//   1. تسجيل الدخول  (#UserName / #passwordInput / #loginBTN)
//   2. صفحة البحث    (/Apps/NewPharmacy/Beneficiary/Search)
//   3. اختيار الباير (#payerId) وإغلاق النافذة المنبثقة (.close-icon)
//   4. كتابة الساب   (#SearchCode) والضغط على (#SearchId)
//   5. قراءة الجدولين (#Table للـ Pre-Approvals و #Table2 للـ Claims)
//   6. قراءة رقم التليفون من (.NDClaimIDResult)
//   7. الضغط على الرقم المرجعي وفتح نافذة صورة الروشتة والتقاط الصورة
//   8. الضغط على (#btn-DeleteClaim) لإرجاع الاستمارة على السيستم
//
// مفيش أي بيانات وهمية: أي فشل بيرجع {ok:false, error} بسبب مكتوب.
// ============================================================================
const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const path = require("node:path");

const S = require("./snippets.cjs");
const { parseDateToISO, isMonthlyText } = require("./nice-utils.cjs");

const BASE = "https://nicedeer.net";
const LOGIN_URL = `${BASE}/Account/Login`;
const SEARCH_URL = `${BASE}/Apps/NewPharmacy/Beneficiary/Search`;
const ND_PARTITION = "persist:nicedeer";
const WA_PARTITION = "persist:whatsapp";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const TIMEOUTS = {
  pageLoad: 45000,
  afterSearch: 20000,
  imageReady: 20000,
  delete: 15000,
  login: 40000,
};

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// أدوات عامة
// ---------------------------------------------------------------------------

/** ينفّذ كود في الصفحة ويرجّع النتيجة (أو null لو الصفحة لسه بتتنقل) */
async function run(win, code) {
  if (!win || win.isDestroyed()) return null;
  try {
    return await win.webContents.executeJavaScript(code, true);
  } catch {
    return null;
  }
}

/** يستنى لحد ما الدالة في الصفحة ترجّع قيمة truthy */
async function waitInPage(win, code, timeoutMs = 15000, intervalMs = 120) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!win || win.isDestroyed()) return null;
    const value = await run(win, code);
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

async function waitForUrl(win, includes, timeoutMs = TIMEOUTS.pageLoad) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!win || win.isDestroyed()) return false;
    const url = win.webContents.getURL();
    if (url && url.includes(includes)) return true;
    await sleep(150);
  }
  return false;
}

async function safeLoad(win, url, timeoutMs = TIMEOUTS.pageLoad) {
  const timer = new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
  const load = win
    .loadURL(url)
    .then(() => "loaded")
    .catch((err) => (String(err?.message || err).includes("ERR_ABORTED") ? "loaded" : "error"));
  return Promise.race([load, timer]);
}



// ---------------------------------------------------------------------------
// بركة نوافذ نايس دير — كل نافذة مخفية بتشتغل على ساب مستقل
// ---------------------------------------------------------------------------

class NiceDeerPool {
  constructor() {
    this.windows = [];
    this.busy = new Set();
    this.queue = [];
    this.maxWorkers = 5;
  }

  setMax(n) {
    this.maxWorkers = Math.max(1, Math.min(12, Number(n) || 5));
  }

  createWindow() {
    const win = new BrowserWindow({
      show: false,
      width: 1366,
      height: 1000,
      webPreferences: {
        partition: ND_PARTITION,
        backgroundThrottling: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        images: true,
      },
    });
    win.webContents.setUserAgent(UA);
    win.webContents.setWindowOpenHandler(({ url }) => {
      // نمنع النوافذ العشوائية، وبنلتقط الرابط في الالتقاط الخاص بالاستمارة
      if (!/^https?:\/\/([a-z0-9-]+\.)*nicedeer\.[a-z]+/i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    win.on("closed", () => {
      const i = this.windows.indexOf(win);
      if (i >= 0) this.windows.splice(i, 1);
      this.busy.delete(win);
    });
    return win;
  }

  /** ياخد نافذة فاضية (أو يستنى واحدة تتحرر) */
  async acquire(timeoutMs = 120000) {
    const free = this.windows.find((w) => !this.busy.has(w) && !w.isDestroyed());
    if (free) {
      this.busy.add(free);
      return free;
    }
    if (this.windows.length < this.maxWorkers) {
      const win = this.createWindow();
      this.windows.push(win);
      this.busy.add(win);
      return win;
    }
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const w = this.windows.find((x) => !this.busy.has(x) && !x.isDestroyed());
      if (w) {
        this.busy.add(w);
        return w;
      }
      await sleep(200);
    }
    throw new Error("كل نوافذ نايس دير مشغولة — استنى شوية أو زوّد عدد النوافذ");
  }

  release(win) {
    this.busy.delete(win);
  }

  async closeAll() {
    for (const win of [...this.windows]) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows = [];
    this.busy.clear();
  }

  async clearSession() {
    await this.closeAll();
    await session.fromPartition(ND_PARTITION).clearStorageData();
  }
}

const pool = new NiceDeerPool();

// ---------------------------------------------------------------------------
// 1) تسجيل الدخول
// ---------------------------------------------------------------------------

async function isLoggedIn(win) {
  const url = win.webContents.getURL() || "";
  if (url.includes("/Account/Login")) return false;
  const hasSearch = await run(
    win,
    `!!(document.querySelector('#SearchCode') || document.querySelector('#payerId'))`,
  );
  return Boolean(hasSearch);
}

async function login(win, { username, password }) {
  if (!username || !password) {
    throw new Error("بيانات دخول نايس دير غير محفوظة — اكتب اليوزر والباسورد في الإعداد");
  }

  await safeLoad(win, LOGIN_URL);
  await waitInPage(win, `!!document.querySelector('#UserName')`, TIMEOUTS.login);

  const filled = await run(
    win,
    `(() => {
      const setVal = (sel, value) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      const a = setVal('#UserName', ${JSON.stringify(username)});
      const b = setVal('#passwordInput', ${JSON.stringify(password)});
      return a && b;
    })()`,
  );
  if (!filled) throw new Error("خانات تسجيل الدخول في نايس دير مش موجودة (#UserName / #passwordInput)");

  await run(
    win,
    `(() => {
      const btn = document.querySelector('#loginBTN') || [...document.querySelectorAll('button')].find(b => /log\\s*in/i.test(b.textContent || ''));
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );

  // بعد اللوجين: الصفحة لازم تسيب /Account/Login
  const startedAt = Date.now();
  let ok = false;
  while (Date.now() - startedAt < 25000) {
    const url = win.webContents.getURL() || "";
    if (url && !url.includes("/Account/Login")) {
      ok = true;
      break;
    }
    await sleep(250);
  }
  if (!ok) {
    const err = await run(
      win,
      `(() => {
        const el = document.querySelector('.validation-summary-errors, .alert-danger, .text-danger, .field-validation-error');
        return el ? (el.textContent || '').trim() : '';
      })()`,
    );
    throw new Error(err ? `رفض نايس دير الدخول: ${err}` : "تسجيل الدخول لم يكتمل — تحقق من اليوزر والباسورد");
  }
  return true;
}

/** يضمن إن النافذة داخلة وعندها صفحة البحث جاهزة */
async function ensureSearchPage(win, credentials) {
  const url = win.webContents.getURL() || "";
  if (!url.includes("nicedeer")) {
    await safeLoad(win, SEARCH_URL);
  }
  if (await isLoggedIn(win)) {
    const onSearch = (win.webContents.getURL() || "").includes("/Beneficiary/Search");
    if (onSearch && (await run(win, `!!document.querySelector('#SearchCode')`))) return "already";
    await safeLoad(win, SEARCH_URL);
    if (await run(win, `!!document.querySelector('#SearchCode')`)) return "loaded";
  }
  await login(win, credentials);
  await safeLoad(win, SEARCH_URL);
  const ready = await waitInPage(win, `!!document.querySelector('#SearchCode')`, 20000);
  if (!ready) throw new Error("صفحة البحث في نايس دير لم تظهر");
  return "logged-in";
}

// ---------------------------------------------------------------------------
// 2) البحث عن الساب وقراءة الجدولين
// ---------------------------------------------------------------------------

/** يقرأ الجدولين + رقم التليفون من الصفحة الحالية */

async function searchSub(win, { sab, payerId, payerName }) {
  await waitInPage(win, `!!document.querySelector('#SearchCode')`, 20000);

  // لو الصفحة فيها صفوف لساب قديم، بنعيد تحميلها قبل البحث
  // عشان ما ننسبش استمارات ساب قديم للساب الجديد.
  const hasOldRows = await run(win, `!!document.querySelector('#Table tbody tr, #Table2 tbody tr')`);
  if (hasOldRows) {
    await safeLoad(win, SEARCH_URL);
    await waitInPage(win, `!!document.querySelector('#SearchCode')`, 20000);
  }
  const firstPass = (win.webContents.getURL() || "") === "";

  const payer = await run(win, S.selectPayerScript(payerId, payerName));
  if (firstPass) await sleep(300);
  if (!payer || !payer.ok) {
    if (payer && payer.reason === "no-option") {
      const names = (payer.options || []).map((o) => o.text).filter(Boolean).join(" / ");
      throw new Error(`الباير المطلوب غير موجود في القائمة. المتاح: ${names}`);
    }
    // ممكن القائمة تظهر بعد تحميل select2
    await sleep(700);
    const retry = await run(win, S.selectPayerScript(payerId, payerName));
    if (!retry || !retry.ok) throw new Error("لم يتم اختيار الباير (#payerId)");
  }

  await sleep(250);
  await run(win, S.CLOSE_MODAL_SCRIPT);
  await sleep(250);

  const filled = await run(win, S.fillCodeScript(sab));
  if (!filled) throw new Error("خانة الساب (#SearchCode) غير موجودة");
  await sleep(150);
  const clicked = await run(win, S.CLICK_SEARCH_SCRIPT);
  if (!clicked) throw new Error("زرار البحث (#SearchId) غير موجود");

  // انتظار ظهور صفوف في أي من الجدولين
  const ok = await waitInPage(
    win,
    `(() => {
      const t1 = document.querySelector('#Table tbody tr');
      const t2 = document.querySelector('#Table2 tbody tr');
      if (t1 || t2) return 'rows';
      const txt = (document.body.innerText || '');
      if (/invalid card|no data|not found|غير موجود|لا يوجد/i.test(txt)) return 'empty';
      return '';
    })()`,
    TIMEOUTS.afterSearch,
  );

  // ننتظر ثبات عدد الصفوف عشان ما نقراش جدول لسه بيرسم
  let lastCount = -1;
  for (let i = 0; i < 12; i++) {
    const count = await run(win, `document.querySelectorAll('#Table tbody tr, #Table2 tbody tr').length`);
    if (typeof count === "number" && count > 0 && count === lastCount) break;
    lastCount = typeof count === "number" ? count : lastCount;
    await sleep(350);
  }

  const parsed = (await run(win, S.PARSE_RESULTS_SCRIPT)) || { forms: [], phone: "", name: "" };
  const forms = (parsed.forms || []).map((f, index) => ({
    ...f,
    index,
    refId: `${sab}::${f.source}::${f.reference || index}`,
    dateISO: parseDateToISO(f.date),
    monthly: isMonthlyText(f.type) || isMonthlyText(f.claimType) || isMonthlyText(f.rowText),
  }));

  return {
    sab,
    phone: parsed.phone || "",
    name: parsed.name || "",
    forms,
    empty: forms.length === 0,
    note: ok === "empty" ? "نايس دير لم يرجع استمارات لهذا الساب" : forms.length === 0 ? "لم تظهر صفوف في الجدولين" : "",
    url: parsed.url || "",
  };
}

// ---------------------------------------------------------------------------
// 3) فتح الاستمارة والتقاط صورة الروشتة + الإرجاع (Delete)
// ---------------------------------------------------------------------------

/** يضغط على الرقم المرجعي ويلتقط روابط أي نافذة/تنقل يفتحه الموقع */
async function openFormAndCaptureUrls(win, { reference, source }) {
  const urls = [];
  let navigated = "";

  const onWindowOpen = ({ url }) => {
    urls.push(url);
    return { action: "deny" };
  };
  const onWillNavigate = (event, url) => {
    if (url && !url.startsWith("devtools://")) {
      navigated = url;
    }
  };

  win.webContents.setWindowOpenHandler(onWindowOpen);
  win.webContents.on("will-navigate", onWillNavigate);

  const clickResult = await run(win, S.clickReferenceScript(reference));


  await sleep(1200);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:\/\/([a-z0-9-]+\.)*nicedeer\.[a-z]+/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.off("will-navigate", onWillNavigate);

  return { clickResult, urls, navigated };
}

/**
 * يلتقط صورة الروشتة من صفحة/نافذة الصورة.
 * الترتيب: صورة الصفحة الأصلية (img) → canvas → fetch مع الكوكيز → تصوير النافذة.
 */

async function captureImageFromWindow(win, timeoutMs = TIMEOUTS.imageReady) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!win || win.isDestroyed()) break;
    const res = await run(win, S.EXTRACT_IMAGE_SCRIPT);
    if (res && res.dataUrl) return res;
    if (res && res.failed) {
      // فيه صورة لكن ممنوع قراءتها — بنصور النافذة نفسها
      break;
    }
    await sleep(400);
  }
  try {
    const shot = await win.webContents.capturePage();
    if (shot && !shot.isEmpty()) {
      return { dataUrl: `data:image/png;base64,${shot.toPNG().toString("base64")}`, method: "screenshot" };
    }
  } catch {
    /* تجاهل */
  }
  return null;
}

/** يفتح رابط في نافذة مخفية مؤقتة ويلتقط منها الصورة */
async function captureFromUrl(url, referrer) {
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1000,
    webPreferences: {
      partition: ND_PARTITION,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      images: true,
    },
  });
  win.webContents.setUserAgent(UA);
  try {
    if (referrer && /^https?:/.test(referrer)) {
      try {
        await win.loadURL(url, { httpReferrer: referrer });
      } catch {
        await safeLoad(win, url, TIMEOUTS.pageLoad);
      }
    } else {
      await safeLoad(win, url, TIMEOUTS.pageLoad);
    }
    const res = await captureImageFromWindow(win);
    return res;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * الاستمارة الواحدة: ضغط الرقم المرجعي → التقاط الصورة → (اختياري) Delete →
 * الرجوع لصفحة نتائج البحث عشان الاستمارة اللي بعدها.
 */
async function processForm(win, job) {
  const { sab, payerId, payerName, reference, source, preventDelete, credentials, href } = job;
  const attemptsLog = [];

  await ensureSearchPage(win, credentials);
  let parsed = await run(win, S.PARSE_RESULTS_SCRIPT);
  const hasRows = parsed && (parsed.forms || []).length > 0;
  const wrongSab = !hasRows || !(parsed.forms || []).some((f) => f.reference === reference);

  if (wrongSab) {
    attemptsLog.push("إعادة بحث للوصول لصفحة النتائج");
    const res = await searchSub(win, { sab, payerId, payerName });
    if (!res.forms.length) {
      return { ok: false, error: res.note || "لم تظهر استمارات لهذا الساب أثناء جلب الصورة" };
    }
  }

  const opened = await openFormAndCaptureUrls(win, { reference, source });
  if (!opened.clickResult) {
    return { ok: false, error: `الرقم المرجعي ${reference} غير موجود في الصفحة` };
  }

  let image = null;
  let imageSourceUrl = "";

  // (أ) نافذة منبثقة
  for (const url of opened.urls) {
    const res = await captureFromUrl(url, win.webContents.getURL());
    if (res && res.dataUrl) {
      image = res;
      imageSourceUrl = url;
      attemptsLog.push("التقاط من نافذة الصورة");
      break;
    }
  }

  // (ب) الصفحة نفسها ات navigated لصفحة الاستمارة
  if (!image && opened.navigated) {
    await sleep(800);
    const res = await captureImageFromWindow(win);
    if (res && res.dataUrl) {
      image = res;
      imageSourceUrl = opened.navigated;
      attemptsLog.push("التقاط من صفحة الاستمارة");
    }
  }

  // (ج) الصفحة الحالية فيها صورة أو لينك صورة
  if (!image) {
    const res = await captureImageFromWindow(win, 8000);
    if (res && res.dataUrl) {
      image = res;
      attemptsLog.push("التقاط من الصفحة الحالية");
    } else {
      imageSourceUrl = await run(win, S.FIND_IMAGE_LINK_SCRIPT);
      if (imageSourceUrl && imageSourceUrl !== "click") {
        const abs = imageSourceUrl.startsWith("http") ? imageSourceUrl : `${BASE}${imageSourceUrl}`;
        const res2 = await captureFromUrl(abs, win.webContents.getURL());
        if (res2 && res2.dataUrl) {
          image = res2;
          attemptsLog.push("التقاط من رابط صورة الروشتة");
        }
      }
    }
  }

  if (!image) {
    return {
      ok: false,
      error: opened.urls.length
        ? "نافذة الروشتة اتفتحت لكن مفيش صورة مقروءة فيها"
        : "مفيش نافذة روشتة اتفتحت من الرقم المرجعي",
      attemptsLog,
    };
  }

  // (د) الإرجاع (Delete) — بيدوس فعلًا على #btn-DeleteClaim
  let deleteState = "skipped";
  if (!preventDelete) {
    const del = await run(win, S.CLICK_DELETE_SCRIPT);
    if (del === "clicked") {
      deleteState = "done";
      await sleep(900);
    } else if (del === "hidden" || del === "no-button") {
      // الصفحة اللي فيها زرار الإرجاع ممكن تكون هي صفحة الاستمارة المنبثقة
      const del2 = opened.urls.length
        ? await (async () => {
            const w2 = new BrowserWindow({ show: false, webPreferences: { partition: ND_PARTITION, sandbox: true } });
            try {
              await safeLoad(w2, opened.urls[opened.urls.length - 1]);
              return await run(w2, S.CLICK_DELETE_SCRIPT);
            } finally {
              if (!w2.isDestroyed()) w2.destroy();
            }
          })()
        : "skipped";
      deleteState = del2 === "clicked" ? "done" : "not-found";
    }
  }

  // (هـ) الرجوع لصفحة البحث
  try {
    const url = win.webContents.getURL() || "";
    if (!url.includes("/Beneficiary/Search")) {
      await safeLoad(win, SEARCH_URL);
      await searchSub(win, { sab, payerId, payerName });
    }
  } catch {
    /* المحاولة الجاية هتعمل بحث من الأول */
  }

  return {
    ok: true,
    dataUrl: image.dataUrl,
    method: image.method || "unknown",
    imageSourceUrl,
    deleted: deleteState === "done",
    deleteState,
    attemptsLog,
  };
}

// ---------------------------------------------------------------------------
// 4) واتساب ويب الحقيقي
// ---------------------------------------------------------------------------

let waWin = null;
let waLoginWaiters = [];

function getWaWindow(show = false) {
  if (waWin && !waWin.isDestroyed()) {
    if (show) waWin.show();
    return waWin;
  }
  waWin = new BrowserWindow({
    show: true,
    width: 1100,
    height: 800,
    title: "واتساب ويب — روشتة برو",
    webPreferences: {
      partition: WA_PARTITION,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  waWin.webContents.setUserAgent(UA);
  waWin.on("closed", () => {
    waWin = null;
  });
  return waWin;
}

async function waState(win) {
  return (await run(win, S.WA_STATE_SCRIPT)) || "loading";
}

async function waEnsureOpen() {
  const win = getWaWindow(false);
  if (!(win.webContents.getURL() || "").includes("web.whatsapp.com")) {
    await safeLoad(win, "https://web.whatsapp.com/", 60000);
  }
  return win;
}

async function waWaitReady(timeoutMs = 90000) {
  const win = await waEnsureOpen();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const st = await waState(win);
    if (st === "ready") return "ready";
    await sleep(800);
  }
  const st = await waState(win);
  return st;
}

ipcMain.handle("wa:status", async () => {
  try {
    if (!waWin || waWin.isDestroyed()) return { ok: true, state: "closed" };
    const st = await waState(waWin);
    return { ok: true, state: st };
  } catch (err) {
    return { ok: false, state: "error", error: String(err?.message || err) };
  }
});

ipcMain.handle("wa:pair", async () => {
  const win = await waEnsureOpen();
  win.show();
  win.focus();
  const st = await waWaitReady(120000);
  return { ok: st === "ready", state: st };
});

ipcMain.handle("wa:logout", async () => {
  try {
    if (waWin && !waWin.isDestroyed()) waWin.destroy();
    waWin = null;
    await session.fromPartition(WA_PARTITION).clearStorageData();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("wa:send", async (_e, payload) => {
  const { phone, text } = payload || {};
  if (!phone || !text) return { ok: false, error: "رقم الهاتف والنص مطلوبين" };
  const win = await waEnsureOpen();
  let state = await waState(win);
  if (state !== "ready") state = await waWaitReady(45000);
  if (state !== "ready") return { ok: false, error: "واتساب غير متصل — امسح كود QR من بطاقة واتساب" };

  const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`;
  await safeLoad(win, url, 45000);
  await sleep(2200);
  const res = await run(win, S.WA_SEND_SCRIPT);
  return res && res.ok ? { ok: true } : { ok: false, error: (res && res.error) || "فشل الإرسال" };
});

ipcMain.handle("wa:replies", async (_e, payload) => {
  const { phone } = payload || {};
  const win = await waEnsureOpen();
  const state = await waState(win);
  if (state !== "ready") return { ok: false, error: "واتساب غير متصل" };
  await safeLoad(win, `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`, 45000);
  await sleep(2200);
  const msgs = (await run(win, S.WA_LAST_REPLIES_SCRIPT)) || [];
  const incoming = msgs.filter((m) => m.incoming);
  return { ok: true, last: incoming.length ? incoming[incoming.length - 1].text : "", all: incoming.slice(-5) };
});

ipcMain.handle("wa:open-chat", async (_e, payload) => {
  const { phone, text } = payload || {};
  const win = getWaWindow(true);
  if (!(win.webContents.getURL() || "").includes("web.whatsapp.com")) {
    await safeLoad(win, "https://web.whatsapp.com/", 60000);
  }
  win.show();
  const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}${text ? `&text=${encodeURIComponent(text)}` : ""}`;
  await safeLoad(win, url, 45000);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// 5) IPC — نايس دير
// ---------------------------------------------------------------------------

let credentials = { username: "", password: "" };

ipcMain.handle("nd:set-credentials", async (_e, payload) => {
  credentials = {
    username: String(payload?.username || ""),
    password: String(payload?.password || ""),
  };
  if (payload?.maxWorkers) pool.setMax(payload.maxWorkers);
  return { ok: true };
});

ipcMain.handle("nd:set-workers", async (_e, payload) => {
  pool.setMax(payload?.maxWorkers);
  return { ok: true, maxWorkers: pool.maxWorkers };
});

ipcMain.handle("nd:login", async (_e, payload) => {
  if (payload?.username) credentials = { username: payload.username, password: payload.password || "" };
  const win = await pool.acquire();
  try {
    await safeLoad(win, SEARCH_URL);
    if (await isLoggedIn(win)) return { ok: true, already: true };
    await login(win, credentials);
    return { ok: true, already: false };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    pool.release(win);
  }
});

ipcMain.handle("nd:status", async () => {
  const win = await pool.acquire(20000).catch(() => null);
  if (!win) return { ok: true, loggedIn: false, busy: true };
  try {
    if (!(win.webContents.getURL() || "").includes("nicedeer")) {
      await safeLoad(win, SEARCH_URL);
    }
    return { ok: true, loggedIn: await isLoggedIn(win), workers: pool.windows.length };
  } finally {
    pool.release(win);
  }
});

ipcMain.handle("nd:search", async (_e, payload) => {
  const { sab, payerId, payerName } = payload || {};
  if (!sab) return { ok: false, error: "رقم الساب مطلوب" };
  const win = await pool.acquire();
  try {
    await ensureSearchPage(win, credentials);
    const res = await searchSub(win, { sab, payerId, payerName });
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    pool.release(win);
  }
});

ipcMain.handle("nd:form-image", async (_e, payload) => {
  const { sab, reference, source, payerId, payerName, preventDelete, href } = payload || {};
  if (!sab || !reference) return { ok: false, error: "الساب والرقم المرجعي مطلوبين" };
  const win = await pool.acquire();
  try {
    const res = await processForm(win, {
      sab,
      payerId,
      payerName,
      reference,
      source,
      href,
      preventDelete: Boolean(preventDelete),
      credentials,
    });
    return res;
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    pool.release(win);
  }
});

ipcMain.handle("nd:delete", async (_e, payload) => {
  const { sab, payerId, payerName, reference } = payload || {};
  const win = await pool.acquire();
  try {
    await ensureSearchPage(win, credentials);
    await openFormAndCaptureUrls(win, { reference, source: payload?.source });
    const del = await run(win, S.CLICK_DELETE_SCRIPT);
    return { ok: del === "clicked", state: del };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    pool.release(win);
  }
});

ipcMain.handle("nd:logout-everything", async () => {
  await pool.clearSession();
  return { ok: true };
});

ipcMain.handle("nd:close-all", async () => {
  await pool.closeAll();
  if (waWin && !waWin.isDestroyed()) waWin.destroy();
  waWin = null;
  return true;
});

ipcMain.handle("app:open-external", async (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) await shell.openExternal(url);
  return true;
});

ipcMain.handle("app:open-search-site", async () => {
  const nd = await pool.acquire();
  try {
    await ensureSearchPage(nd, credentials);
    nd.show();
    return { ok: true };
  } finally {
    pool.release(nd);
  }
});

// ---------------------------------------------------------------------------
// النافذة الرئيسية
// ---------------------------------------------------------------------------

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 980,
    backgroundColor: "#05090a",
    title: "روشتة برو",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  const devUrl = process.env.ROSHETTA_DEV_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://") && !url.includes("localhost:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  return win;
}

app.whenReady().then(() => {
  session.fromPartition(ND_PARTITION).setUserAgent(UA);
  session.fromPartition(WA_PARTITION).setUserAgent(UA);
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
