// ============================================================================
// روشتة برو — محرك أتمتة نايس دير الحقيقي (Electron main process) — نسخة سريعة
//
// كل خطوة بتتعمل فعليًا على https://nicedeer.net بنفس ترتيب الصرف:
//   تسجيل دخول → صفحة البحث → الباير → إغلاق المنبثقة → الساب → Search
//   → قراءة #Table و #Table2 والتليفون → الضغط على الرقم المرجعي
//   → التقاط صورة الروشتة → الإرجاع (#btn-DeleteClaim)
//
// مبادئ السرعة:
//   • كل خطوة في الصفحة بترجع Promise بيتحل لحظة تحقق الشرط (rAF) — مفيش sleeps ثابتة.
//   • البحث كله في نداء واحد (باير + إغلاق + تنظيف + ساب + Search + ثبات النتائج).
//   • نافذة الصورة بتتفتح بـ did-create-window وبتتلقط فورًا من غير إنشاء نافذة إضافية.
//   • الإرجاع (Delete) بيتم في طابور منفصل في الخلفية — مش بيوقف جلب الصور.
//   • بركة نوافذ قابلة لإعادة الاستخدام + تسخين مسبق (warm-up) لكل النوافذ.
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

const MAX_WORKERS = 16;
const MAX_DELETERS = 3;

const TIMEOUTS = {
  pageLoad: 40000,
  search: 18000,
  image: 14000,
  delete: 12000,
  login: 35000,
  warmup: 25000,
};

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-ipc-flooding-protection");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// أدوات تنفيذ في الصفحة
// ---------------------------------------------------------------------------

async function run(win, code) {
  if (!win || win.isDestroyed()) return null;
  try {
    return await win.webContents.executeJavaScript(code, true);
  } catch {
    return null;
  }
}

/** نفس run لكن بيرمي الخطأ الحقيقي بدل ما يخفيه */
async function runStrict(win, code) {
  if (!win || win.isDestroyed()) throw new Error("النافذة اتقفلت");
  try {
    return await win.webContents.executeJavaScript(code, true);
  } catch (err) {
    const message = String(err && err.message ? err.message : err).replace(/^Error:\s*/, "");
    throw new Error(message);
  }
}

/** يستنى انتهاء تحميل الصفحة (حدث فعلي، مش polling) */
/** تاريخ التصفح — واجهة Electron الجديدة أو القديمة */
function navApi(win) {
  const wc = win.webContents;
  const nh = wc.navigationHistory;
  return {
    canGoBack: () => (nh && typeof nh.canGoBack === "function" ? nh.canGoBack() : Boolean(wc.canGoBack && wc.canGoBack())),
    goBack: () => (nh && typeof nh.goBack === "function" ? nh.goBack() : wc.goBack()),
  };
}

/**
 * رجوع لصفحة البحث مع الحفاظ على نتائجها بدل إعادة تحميلها وإعادة البحث.
 * ده اللي بيخلي الاستمارة اللي بعدها تبدأ فورًا (بدون بحث جديد).
 */
async function backToResults(win, steps = 3) {
  if (!win || win.isDestroyed()) return false;
  const nav = navApi(win);
  for (let i = 0; i < steps; i++) {
    let can;
    try {
      can = nav.canGoBack();
    } catch {
      can = false;
    }
    if (!can) return false;
    try {
      nav.goBack();
    } catch {
      return false;
    }
    await waitForLoad(win, 6000);
    const ok = await run(win, S.waitForSelectorScript("#SearchCode", 1200));
    if (ok) return true;
  }
  return false;
}

function waitForLoad(win, timeoutMs = TIMEOUTS.pageLoad) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve(false);
    const wc = win.webContents;
    if (!wc.isLoadingMainFrame()) return resolve(true);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      wc.removeListener("did-stop-loading", onStop);
      wc.removeListener("did-fail-load", onFail);
      resolve(value);
    };
    const onStop = () => finish(true);
    const onFail = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    wc.once("did-stop-loading", onStop);
    wc.once("did-fail-load", onFail);
  });
}

async function safeLoad(win, url, timeoutMs = TIMEOUTS.pageLoad, referrer) {
  if (!win || win.isDestroyed()) return "error";
  const load = (referrer ? win.loadURL(url, { httpReferrer: referrer }) : win.loadURL(url))
    .then(() => "loaded")
    .catch((err) => (String(err?.message || err).includes("ERR_ABORTED") ? "loaded" : "error"));
  const timer = new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
  return Promise.race([load, timer]);
}

/** أول نتيجة ناجحة من مجموعة وعود (بدون ما نستنى الفاشلة) */
function firstSuccess(promises, timeoutMs) {
  return new Promise((resolve) => {
    let pending = promises.length;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    for (const p of promises) {
      Promise.resolve(p)
        .then((value) => {
          if (value && value.dataUrl) done(value);
        })
        .catch(() => {})
        .finally(() => {
          pending -= 1;
          if (pending === 0 && !settled) done(null);
        });
    }
  });
}

// ---------------------------------------------------------------------------
// بركة نوافذ
// ---------------------------------------------------------------------------

function hiddenWindowOptions(extra = {}) {
  return {
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
      disableDialogs: true,
      ...extra,
    },
  };
}

const DEFAULT_POPUP_HANDLER = ({ url }) => {
  if (!/^https?:\/\/([a-z0-9-]+\.)*nicedeer\.[a-z]+/i.test(url)) shell.openExternal(url);
  return { action: "deny" };
};

class WindowPool {
  constructor({ name, max, keepState }) {
    this.name = name;
    this.max = max;
    this.windows = [];
    this.busy = new Set();
    this.keepState = keepState;
  }

  get size() {
    return this.windows.length;
  }

  create() {
    const win = new BrowserWindow({ ...hiddenWindowOptions(), title: `rp-${this.name}` });
    win.webContents.setUserAgent(UA);
    win.webContents.setWindowOpenHandler(DEFAULT_POPUP_HANDLER);
    win.on("closed", () => {
      const i = this.windows.indexOf(win);
      if (i >= 0) this.windows.splice(i, 1);
      this.busy.delete(win);
    });
    this.windows.push(win);
    return win;
  }

  async acquire(timeoutMs = 180000) {
    const free = this.windows.find((w) => !this.busy.has(w) && !w.isDestroyed());
    if (free) {
      this.busy.add(free);
      return free;
    }
    if (this.windows.length < this.max) {
      const win = this.create();
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
      await sleep(25);
    }
    throw new Error(`كل نوافذ ${this.name} مشغولة`);
  }

  release(win) {
    this.busy.delete(win);
  }

  /**
   * حجز نافذة مفضّلة (مثلاً النافذة اللي عليها نتائج نفس الساب) —
   * بنستنى شوية قصيرة عشان نلاقيها، وبعدها بناخد أي نافذة فاضية.
   */
  async acquirePref(match, waitMs = 4000) {
    const started = Date.now();
    for (;;) {
      const free = this.windows.find((w) => !this.busy.has(w) && !w.isDestroyed() && match(w));
      if (free) {
        this.busy.add(free);
        return free;
      }
      if (Date.now() - started > waitMs || this.windows.length < this.max) return this.acquire();
      await sleep(25);
    }
  }

  /** شغل على نافذة مفضّلة مع ضمان تحريرها */
  async withPref(match, fn, waitMs) {
    const win = await this.acquirePref(match, waitMs);
    try {
      return await fn(win);
    } finally {
      this.release(win);
    }
  }

  /** شغل على نافذة مع ضمان تحريرها */
  async with(fn, timeoutMs) {
    const win = await this.acquire(timeoutMs);
    try {
      return await fn(win);
    } finally {
      this.release(win);
    }
  }

  async closeAll() {
    for (const win of [...this.windows]) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows = [];
    this.busy.clear();
  }
}

const workers = new WindowPool({ name: "workers", max: 5, keepState: true });
const captures = new WindowPool({ name: "captures", max: 4, keepState: false });

// ---------------------------------------------------------------------------
// طابور الإرجاع (Delete) في الخلفية
// ---------------------------------------------------------------------------

const deleteResults = new Map(); // key -> { state, at, ms }
const deleteJobs = [];
let deleteRunning = 0;
const deleters = new WindowPool({ name: "deleters", max: MAX_DELETERS, keepState: false });

function enqueueDelete(job) {
  deleteResults.set(job.key, { state: "queued", at: Date.now() });
  deleteJobs.push(job);
  pumpDeletes();
}

function pumpDeletes() {
  while (deleteRunning < MAX_DELETERS && deleteJobs.length) {
    const job = deleteJobs.shift();
    deleteRunning += 1;
    void runDeleteJob(job).finally(() => {
      deleteRunning -= 1;
      pumpDeletes();
    });
  }
}

async function runDeleteJob(job) {
  const started = Date.now();
  try {
    const state = await deleters.with(async (win) => {
      for (const candidate of job.candidates) {
        if (!candidate || candidate === "main") continue;
        const loaded = await safeLoad(win, candidate, TIMEOUTS.delete);
        if (loaded === "error") continue;
        const hasButton = await run(win, S.waitForSelectorScript("#btn-DeleteClaim", 3500));
        if (!hasButton) continue;
        const click = await run(win, S.CLICK_DELETE_SCRIPT);
        if (click === "clicked") return "done";
      }
      return "not-found";
    }, 30000);
    deleteResults.set(job.key, { state, at: Date.now(), ms: Date.now() - started });
  } catch (err) {
    deleteResults.set(job.key, {
      state: "error",
      error: String(err && err.message ? err.message : err),
      at: Date.now(),
      ms: Date.now() - started,
    });
  }
}

// ---------------------------------------------------------------------------
// تسجيل الدخول وصفحة البحث
// ---------------------------------------------------------------------------

async function pageState(win) {
  return run(win, S.PAGE_STATE_SCRIPT);
}

async function login(win, credentials) {
  if (!credentials.username || !credentials.password) {
    throw new Error("بيانات دخول نايس دير غير محفوظة — اكتب اليوزر والباسورد في الإعداد");
  }

  await safeLoad(win, LOGIN_URL);
  const ready = await run(win, S.waitForSelectorScript("#UserName", TIMEOUTS.login));
  if (!ready) throw new Error("صفحة تسجيل الدخول لم تظهر (#UserName)");

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
        if (window.jQuery) { try { window.jQuery(el).val(value).trigger('change'); } catch (e) {} }
        return true;
      };
      const a = setVal('#UserName', ${JSON.stringify(credentials.username)});
      const b = setVal('#passwordInput', ${JSON.stringify(credentials.password)});
      return a && b;
    })()`,
  );
  if (!filled) throw new Error("خانات تسجيل الدخول غير موجودة (#UserName / #passwordInput)");

  await run(
    win,
    `(() => {
      const btn = document.querySelector('#loginBTN') || [...document.querySelectorAll('button')].find((b) => /log\\s*in/i.test(b.textContent || ''));
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );

  const started = Date.now();
  let ok = false;
  while (Date.now() - started < TIMEOUTS.login) {
    const url = win.webContents.getURL() || "";
    if (url && !url.includes("/Account/Login")) {
      ok = true;
      break;
    }
    await sleep(120);
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
  win.__rpReady = true;
  return true;
}

/** يضمن إن النافذة على صفحة البحث (بيستخدم كاش عشان ما يدفعش تكلفة كل مرة) */
async function ensureSearchPage(win, credentials) {
  const state = await pageState(win);
  if (state && state.hasCode) {
    win.__rpReady = true;
    return "ready";
  }
  // لو النافذة على صفحة روشتة/نتائج قديمة: رجوع سريع بدل تحميل جديد وبحث جديد
  if (state && (state.url || "").includes("nicedeer") && (await backToResults(win))) {
    win.__rpReady = true;
    return "back";
  }
  if (!state || !(state.url || "").includes("nicedeer")) {
    await safeLoad(win, SEARCH_URL);
    const after = await run(win, S.waitForSelectorScript("#SearchCode", 15000));
    if (after) return "loaded";
  }
  await login(win, credentials);
  await safeLoad(win, SEARCH_URL);
  const ok = await run(win, S.waitForSelectorScript("#SearchCode", 15000));
  if (!ok) throw new Error("صفحة البحث في نايس دير لم تظهر");
  return "logged-in";
}

// ---------------------------------------------------------------------------
// البحث — نداء واحد لكل ساب
// ---------------------------------------------------------------------------

async function searchSub(win, { sab, payerId, payerName }) {
  const res = await runStrict(
    win,
    S.fastSearchScript({ sab, payerId, payerName, timeoutMs: TIMEOUTS.search }),
  );

  if (!res) throw new Error("الصفحة لم ترد على البحث — أعد المحاولة");
  if (!res.ok) throw new Error(res.message || "فشل البحث في نايس دير");

  // الباير مهم: لو القائمة موجودة والباير مش فيها، النتائج ممكن تكون لباير تاني
  if (res.payer && res.payer.ok === false && res.payer.reason === "no-option") {
    const names = (res.payer.options || []).map((o) => o.text).filter(Boolean).join(" / ");
    throw new Error(`الباير المطلوب غير موجود في القائمة. المتاح: ${names}`);
  }

  const forms = (res.forms || []).map((f, index) => ({
    ...f,
    index,
    refId: `${sab}::${f.source}::${f.reference || index}`,
    dateISO: parseDateToISO(f.date),
    monthly: isMonthlyText(f.type) || isMonthlyText(f.claimType) || isMonthlyText(f.rowText),
  }));

  win.__rpSab = sab;
  win.__rpRefs = forms.map((f) => f.reference);

  return {
    sab,
    phone: res.phone || "",
    name: res.name || "",
    forms,
    empty: forms.length === 0,
    note:
      forms.length === 0
        ? res.settled
          ? "نايس دير لم يرجع استمارات لهذا الساب"
          : "لم تظهر نتائج خلال المهلة"
        : "",
    url: res.url || "",
    timings: res.timings || {},
    payer: res.payer || null,
  };
}

/** يجعل الصفحة على نتائج الساب المطلوب (ويعيد استخدام النتائج لو موجودة) */
async function ensureResults(win, { sab, payerId, payerName, needReference }) {
  const state = await pageState(win);
  const sameSab = state && state.markedSab === sab;
  const hasRef = !needReference || (state && Array.isArray(state.refs) && state.refs.includes(needReference));
  if (sameSab && hasRef) {
    return { reused: true, timings: { searchMs: 0 } };
  }
  const res = await searchSub(win, { sab, payerId, payerName });
  return { reused: false, result: res, timings: { searchMs: res.timings?.totalMs ?? 0 } };
}

// ---------------------------------------------------------------------------
// التقاط الصورة
// ---------------------------------------------------------------------------

async function captureImageInWindow(win, { timeoutMs = TIMEOUTS.image, minSide = 180 } = {}) {
  if (!win || win.isDestroyed()) return null;
  const started = Date.now();

  // بنحاول نلقط فورًا — الصورة ممكن تكون ظهرت قبل ما الصفحة تخلص تحميل،
  // ولو الصفحة لسه بتتنقل بنعيد المحاولة بسرعة بدل ما نستنى حدث التحميل.
  while (Date.now() - started < timeoutMs + 2500) {
    if (!win || win.isDestroyed()) return null;
    const remaining = Math.max(1200, timeoutMs - (Date.now() - started));
    const res = await run(win, S.captureImageScript({ timeoutMs: remaining, minSide }));
    if (res && res.dataUrl) return res;
    if (res && res.failed) {
      if (res.reason === "protected") break;
      if (!win.webContents.isLoadingMainFrame()) break;
    }
    await sleep(50);
  }

  // صورة محمية (tainted) — بنصور النافذة نفسها
  try {
    const shot = await win.webContents.capturePage();
    if (shot && !shot.isEmpty()) {
      // تصغير لقطة الشاشة — أسرع وأخف على التخزين مع نفس الوضوح
      const resized = shot.getSize().width > 1600
        ? shot.resize({ width: 1600, quality: "best" })
        : shot;
      return {
        dataUrl: `data:image/png;base64,${resized.toPNG().toString("base64")}`,
        method: "screenshot",
        ms: 0,
      };
    }
  } catch {
    /* تجاهل */
  }
  return null;
}

/**
 * يجهّز اعتراض نافذة الصورة اللي هتفتح من الضغط على الرقم المرجعي.
 * النافذة بتتخلق بواسطة Electron نفسها (allow + override) وبتتلقط فورًا،
 * فمفيش تكلفة إنشاء نافذة إضافية ولا انتظار ثابت.
 */
function armPopupCapture(win) {
  const urls = [];
  let resolveChild;
  const childPromise = new Promise((resolve) => {
    resolveChild = resolve;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    urls.push(url);
    return {
      action: "allow",
      overrideBrowserWindowOptions: hiddenWindowOptions({ show: false }),
    };
  });

  const onChild = (child) => {
    child.webContents.setUserAgent(UA);
    void (async () => {
      try {
        const image = await captureImageInWindow(child, { timeoutMs: TIMEOUTS.image });
        resolveChild(image);
      } catch {
        resolveChild(null);
      } finally {
        if (!child.isDestroyed()) child.destroy();
      }
    })();
  };

  win.webContents.on("did-create-window", onChild);

  return {
    urls,
    childPromise,
    dispose() {
      win.webContents.off("did-create-window", onChild);
      if (!win.isDestroyed()) win.webContents.setWindowOpenHandler(DEFAULT_POPUP_HANDLER);
    },
  };
}

/** يفتح رابط صورة في نافذة التقاط معاد استخدامها */
async function captureFromUrl(url, referrer) {
  return captures.with(async (win) => {
    const loaded = await safeLoad(win, url, TIMEOUTS.pageLoad, referrer);
    if (loaded === "error") return null;
    return captureImageInWindow(win, { timeoutMs: TIMEOUTS.image });
  }, 40000);
}

// ---------------------------------------------------------------------------
// الاستمارة الواحدة
// ---------------------------------------------------------------------------

async function processForm(win, job) {
  const { sab, payerId, payerName, reference, preventDelete, credentials, href } = job;
  const t0 = Date.now();
  const timings = {};
  const notes = [];

  await ensureSearchPage(win, credentials);

  const prepared = await ensureResults(win, { sab, payerId, payerName, needReference: reference });
  timings.searchMs = prepared.timings.searchMs;
  if (prepared.result) {
    if (!prepared.result.forms.length) {
      return { ok: false, error: prepared.result.note || "مفيش استمارات لهذا الساب", timings };
    }
    if (!prepared.result.forms.some((f) => f.reference === reference)) {
      return { ok: false, error: `الرقم المرجعي ${reference} غير موجود في نتائج الساب`, timings };
    }
  } else {
    notes.push("استخدام نتائج البحث المحفوظة");
  }

  let navigatedTo = null;
  const onWillNavigate = (_event, url) => {
    if (url && !url.startsWith("devtools://")) navigatedTo = url;
  };
  win.webContents.on("will-navigate", onWillNavigate);

  const popup = armPopupCapture(win);
  let clicked = "";
  try {
    clicked = await runStrict(win, S.clickReferenceScript(reference));
    if (!clicked) {
      return { ok: false, error: `الرقم المرجعي ${reference} غير موجود في الصفحة`, timings };
    }
    timings.clickMs = Date.now() - t0 - (timings.searchMs || 0);

    // مساران بالتوازي: نافذة الصورة المنبثقة، أو تنقّل الصفحة نفسها
    const mainPromise = (async () => {
      // بنستنى التنقل 600 مللي — لو مفيش تنقل مفيش داعي نضيّع وقت في الصفحة الحالية
      const nav = await new Promise((resolve) => {
        const started = Date.now();
        const tick = () => {
          if (navigatedTo) return resolve(navigatedTo);
          if (Date.now() - started > 600) return resolve(null);
          setTimeout(tick, 25);
        };
        tick();
      });
      if (!nav || win.isDestroyed()) return null;
      await waitForLoad(win, 12000);
      return captureImageInWindow(win, { timeoutMs: 6000 });
    })();

    let image = await firstSuccess([popup.childPromise, mainPromise], TIMEOUTS.image + 4000);

    // خطة أخيرة: رابط صورة داخل الصفحة نفسها
    if (!image) {
      const link = await run(win, S.FIND_IMAGE_LINK_SCRIPT);
      if (link && link !== "click") {
        const abs = link.startsWith("http") ? link : `${BASE}${link}`;
        image = await captureFromUrl(abs, win.webContents.getURL());
        if (image) notes.push("التقاط من رابط صورة الروشتة");
      }
    }

    timings.captureMs = Date.now() - t0 - (timings.searchMs || 0) - (timings.clickMs || 0);

    if (!image || !image.dataUrl) {
      return {
        ok: false,
        error: popup.urls.length
          ? "نافذة الروشتة اتفتحت لكن مفيش صورة مقروءة فيها"
          : "مفيش صورة روشتة ظهرت بعد الضغط على الرقم المرجعي",
        timings,
        popupUrls: popup.urls,
      };
    }

    // الإرجاع في الخلفية — مش بيوقف جلب الصورة اللي بعده
    let deleteState = "skipped";
    if (!preventDelete) {
      const candidates = [];
      if (href) candidates.push(href.startsWith("http") ? href : `${BASE}${href}`);
      for (const url of popup.urls) candidates.push(url);

      if (candidates.length) {
        enqueueDelete({ key: `${sab}::${reference}`, candidates });
        deleteState = "background";
      } else {
        const click = await run(win, S.CLICK_DELETE_SCRIPT);
        deleteState = click === "clicked" ? "done" : "not-found";
      }
    }

    // رجوع فوري لصفحة النتائج (بتوفر بحث كامل للاستمارة اللي بعدها)
    if (navigatedTo) {
      try {
        await backToResults(win, 2);
      } catch {
        /* لو فشل الرجوع، ensureSearchPage هيتعامل معاها */
      }
    }

    timings.totalMs = Date.now() - t0;
    return {
      ok: true,
      dataUrl: image.dataUrl,
      method: image.method || "unknown",
      width: image.width,
      height: image.height,
      deleted: deleteState === "done",
      deleteState,
      timings,
      notes,
    };
  } finally {
    popup.dispose();
    if (!win.isDestroyed()) win.webContents.off("will-navigate", onWillNavigate);
  }
}

// ---------------------------------------------------------------------------
// واتساب ويب
// ---------------------------------------------------------------------------

let waWin = null;

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

async function waEnsureOpen() {
  const win = getWaWindow(false);
  if (!(win.webContents.getURL() || "").includes("web.whatsapp.com")) {
    await safeLoad(win, "https://web.whatsapp.com/", 60000);
  }
  return win;
}

async function waState(win) {
  return (await run(win, S.WA_STATE_SCRIPT)) || "loading";
}

async function waWaitReady(timeoutMs = 90000) {
  const win = await waEnsureOpen();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if ((await waState(win)) === "ready") return "ready";
    await sleep(250);
  }
  return waState(win);
}

// ---------------------------------------------------------------------------
// IPC — نايس دير
// ---------------------------------------------------------------------------

let credentials = { username: "", password: "" };

ipcMain.handle("nd:set-credentials", async (_e, payload) => {
  credentials = {
    username: String(payload?.username || ""),
    password: String(payload?.password || ""),
  };
  if (payload?.maxWorkers) workers.max = Math.max(1, Math.min(MAX_WORKERS, Number(payload.maxWorkers) || 5));
  return { ok: true };
});

ipcMain.handle("nd:set-workers", async (_e, payload) => {
  const n = Math.max(1, Math.min(MAX_WORKERS, Number(payload?.maxWorkers) || 5));
  workers.max = n;
  // نوافذ التصوير بتتوسّع مع نوافذ البحث عشان مفيش نافذة تقف مستنية
  captures.max = Math.max(2, Math.min(n, 8));
  return { ok: true, maxWorkers: n, captures: captures.max };
});

ipcMain.handle("nd:warmup", async (_e, payload) => {
  const count = Math.max(1, Math.min(MAX_WORKERS, Number(payload?.workers) || workers.max));
  workers.max = count;
  captures.max = Math.max(2, Math.min(count, 8));
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      try {
        const win = await workers.acquire(60000);
        try {
          const t0 = Date.now();
          const state = await pageState(win);
          if (!state || !state.hasCode) {
            await safeLoad(win, SEARCH_URL);
            await run(win, S.waitForSelectorScript("#SearchCode", 15000));
          }
          return { index: i, ok: true, ms: Date.now() - t0 };
        } finally {
          workers.release(win);
        }
      } catch (err) {
        return { index: i, ok: false, error: String(err?.message || err) };
      }
    }),
  );
  return {
    ok: results.every((r) => r.ok),
    workers: count,
    ms: Date.now() - started,
    results,
    loggedIn: results.some((r) => r.ok),
  };
});

ipcMain.handle("nd:login", async (_e, payload) => {
  if (payload?.username) credentials = { username: payload.username, password: payload.password || "" };
  try {
    return await workers.with(async (win) => {
      const state = await pageState(win);
      if (state && state.hasCode) return { ok: true, already: true };
      await safeLoad(win, SEARCH_URL);
      const ready = await pageState(win);
      if (ready && ready.hasCode) return { ok: true, already: true };
      await login(win, credentials);
      return { ok: true, already: false };
    });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("nd:status", async () => {
  try {
    return await workers.with(async (win) => {
      const state = await pageState(win);
      return { ok: true, loggedIn: Boolean(state && state.hasCode), workers: workers.size };
    }, 20000);
  } catch (err) {
    return { ok: false, loggedIn: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("nd:search", async (_e, payload) => {
  const { sab, payerId, payerName } = payload || {};
  if (!sab) return { ok: false, error: "رقم الساب مطلوب" };
  const t0 = Date.now();
  try {
    return await workers.with(async (win) => {
      await ensureSearchPage(win, credentials);
      const res = await searchSub(win, { sab, payerId, payerName });
      return { ok: true, data: res, ms: Date.now() - t0 };
    });
  } catch (err) {
    return { ok: false, error: String(err?.message || err), ms: Date.now() - t0 };
  }
});

ipcMain.handle("nd:form-image", async (_e, payload) => {
  const { sab, reference, source, payerId, payerName, preventDelete, href } = payload || {};
  if (!sab || !reference) return { ok: false, error: "الساب والرقم المرجعي مطلوبين" };
  try {
    return await workers.withPref(
      (win) => win.__rpSab === sab,
      (win) =>
      processForm(win, {
        sab,
        reference,
        source,
        href,
        payerId,
        payerName,
        preventDelete: Boolean(preventDelete),
        credentials,
      }),
      6000,
    );
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("nd:deletes", async () => {
  return {
    ok: true,
    pending: deleteJobs.length,
    running: deleteRunning,
    results: Object.fromEntries(deleteResults),
  };
});

ipcMain.handle("nd:delete", async (_e, payload) => {
  const { sab, reference, href } = payload || {};
  if (!sab || !reference) return { ok: false, error: "الساب والرقم المرجعي مطلوبين" };
  const candidates = [];
  if (href) candidates.push(href.startsWith("http") ? href : `${BASE}${href}`);
  if (!candidates.length) return { ok: false, error: "مفيش صفحة استمارة معروفة للإرجاع" };
  const key = `${sab}::${reference}::manual`;
  enqueueDelete({ key, candidates });
  return { ok: true, key };
});

ipcMain.handle("nd:logout-everything", async () => {
  await workers.closeAll();
  await session.fromPartition(ND_PARTITION).clearStorageData();
  deleteResults.clear();
  return { ok: true };
});

ipcMain.handle("nd:close-all", async () => {
  await workers.closeAll();
  await captures.closeAll();
  await deleters.closeAll();
  deleteJobs.length = 0;
  if (waWin && !waWin.isDestroyed()) waWin.destroy();
  waWin = null;
  return true;
});

ipcMain.handle("app:open-search-site", async () => {
  try {
    return await workers.with(async (win) => {
      await ensureSearchPage(win, credentials);
      win.show();
      return { ok: true };
    });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("app:open-external", async (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) await shell.openExternal(url);
  return true;
});

// ---------------------------------------------------------------------------
// IPC — واتساب
// ---------------------------------------------------------------------------

ipcMain.handle("wa:status", async () => {
  try {
    if (!waWin || waWin.isDestroyed()) return { ok: true, state: "closed" };
    return { ok: true, state: await waState(waWin) };
  } catch (err) {
    return { ok: false, state: "error", error: String(err?.message || err) };
  }
});

ipcMain.handle("wa:pair", async () => {
  const win = await waEnsureOpen();
  win.show();
  win.focus();
  const state = await waWaitReady(120000);
  return { ok: state === "ready", state };
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
  if (state !== "ready") state = await waWaitReady(25000);
  if (state !== "ready") return { ok: false, error: "واتساب غير متصل — امسح كود QR من بطاقة واتساب" };

  const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`;
  await safeLoad(win, url, 40000);
  const res = await run(win, S.WA_SEND_SCRIPT);
  return res && res.ok ? { ok: true, ms: res.ms } : { ok: false, error: (res && res.error) || "فشل الإرسال" };
});

ipcMain.handle("wa:replies", async (_e, payload) => {
  const { phone } = payload || {};
  const win = await waEnsureOpen();
  if ((await waState(win)) !== "ready") return { ok: false, error: "واتساب غير متصل" };
  await safeLoad(win, `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`, 40000);
  const res = await run(win, S.waitForSelectorScript('[data-testid="msg-container"], div.message-in, div.message-out', 8000));
  const msgs = (await run(win, S.WA_LAST_REPLIES_SCRIPT)) || [];
  const incoming = msgs.filter((m) => m.incoming);
  return {
    ok: Boolean(res),
    last: incoming.length ? incoming[incoming.length - 1].text : "",
    all: incoming.slice(-5),
  };
});

ipcMain.handle("wa:open-chat", async (_e, payload) => {
  const { phone, text } = payload || {};
  const win = getWaWindow(true);
  if (!(win.webContents.getURL() || "").includes("web.whatsapp.com")) {
    await safeLoad(win, "https://web.whatsapp.com/", 60000);
  }
  win.show();
  const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}${text ? `&text=${encodeURIComponent(text)}` : ""}`;
  await safeLoad(win, url, 40000);
  return { ok: true };
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
