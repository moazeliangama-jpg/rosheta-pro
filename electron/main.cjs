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
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  shell,
  powerSaveBlocker,
  Notification,
  safeStorage,
  screen,
} = require("electron");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const S = require("./snippets.cjs");
const { parseDateToISO, isMonthlyText } = require("./nice-utils.cjs");
const SEC = require("./security.cjs");
const UPD = require("./updates.cjs");
const BUG = require("./bugreport.cjs");
const RX = require("./rx-page.cjs");
const LG = require("./nd-login.cjs");

const BASE = "https://nicedeer.net";
const LOGIN_URL = `${BASE}/Account/Login`;
const SEARCH_URL = `${BASE}/Apps/NewPharmacy/Beneficiary/Search`;
const ND_PARTITION = "persist:nicedeer";
const WA_PARTITION = "persist:whatsapp";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** سقف النوافذ الحقيقي = الأقل بين حد ثابت وإمكانيات الجهاز (رام + أنوية) */
function hardwareCap() {
  const ramGb = os.totalmem() / 1024 ** 3;
  const cores = os.cpus()?.length || 4;
  const byRam = Math.floor((ramGb * 1024 - 2048) / 450);
  const byCores = Math.max(2, cores * 2);
  return Math.max(1, Math.min(16, byRam, byCores, 12));
}

const MAX_WORKERS = hardwareCap();
/** الإرجاع بقى أسرع من الأول لأن النوافذ بتشتغل بدون صور */
const MAX_DELETERS = Math.max(2, Math.min(6, Math.round(MAX_WORKERS / 2)));
/** أقصى عمليات لكل نافذة قبل ما نستبدلها (تسرّب الذاكرة في Chromium حقيقي) */
const MAX_OPS_PER_WINDOW = 200;
/** فوق الرقم ده بنوقف جلب الصور مؤقتًا لحد ما الطابور ينزل */
const DELETE_BACKLOG_LIMIT = 60;

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
// كاش قرص أكبر = صور روشتات وصفحات أسرع في الجلسة اللي بعدها
app.commandLine.appendSwitch("disk-cache-size", String(200 * 1024 * 1024));
// مفيش WebGL ولا إضافات: استخدام موارد أقل من غير أي تأثير على الأتمتة
// (الصور بتترسم على canvas ثنائي الأبعاد، فمش محتاجين 3D خالص)
app.commandLine.appendSwitch("disable-3d-apis");
app.commandLine.appendSwitch("disable-extensions");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// التجهيز الذاتي: المثبّت بيفترض إن الجهاز مش جاهز، والبرنامج بيجهّز نفسه بنفسه
// ---------------------------------------------------------------------------

/**
 * ٩٧) النسخة المحمولة (Portable): البيانات بتتحفظ في مجلد جنب الملف التنفيذي،
 * عشان تنقل البرنامج على فلاشة ومعاه قراراتك وصورك. النسخة المثبّتة بتفضل في
 * مجلد بيانات ويندوز العادي.
 */
function configurePortableDataDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!portableDir) return false;
  try {
    const target = path.join(portableDir, "RoshettaPro-Data");
    fs.mkdirSync(target, { recursive: true });
    app.setPath("userData", target);
    return true;
  } catch {
    return false;
  }
}

const PORTABLE = configurePortableDataDir();

const dataDir = () => app.getPath("userData");
const logsDir = () => path.join(dataDir(), "logs");
const diagDir = () => path.join(dataDir(), "diagnostics");
const backupDir = () => path.join(dataDir(), "backups");
const secureDir = () => path.join(dataDir(), "secure");
const credsFile = () => path.join(secureDir(), "credentials.bin");

/** إنشاء المجلدات اللي البرنامج محتاجها (لو مش موجودة) — بيشتغل أول تشغيل */
function ensureRuntimeDirs() {
  const dirs = {
    data: dataDir(),
    logs: logsDir(),
    diagnostics: diagDir(),
    backups: backupDir(),
    secure: secureDir(),
  };
  for (const dir of Object.values(dirs)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* لو مش قادر، الـ preflight هيقول للمستخدم */
    }
  }
  return dirs;
}

let appLogPath = null;
let appLogSize = 0;

/** ١٢١ + ١٢٧) لوج على القرص بيدور لما يكبر (آخر ٥ ملفات) */
function appendLog(level, msg) {
  try {
    if (!appLogPath) {
      fs.mkdirSync(logsDir(), { recursive: true });
      appLogPath = path.join(logsDir(), "rosheta.log");
      appLogSize = fs.existsSync(appLogPath) ? fs.statSync(appLogPath).size : 0;
    }
    if (appLogSize > 2 * 1024 * 1024) {
      for (let i = 4; i >= 1; i--) {
        const from = i === 1 ? appLogPath : path.join(logsDir(), `rosheta.${i - 1}.log`);
        const to = path.join(logsDir(), `rosheta.${i}.log`);
        try {
          if (fs.existsSync(from)) fs.renameSync(from, to);
        } catch {
          /* تجاهل */
        }
      }
      appLogSize = 0;
    }
    const line = `${new Date().toISOString()} [${String(level).toUpperCase()}] ${String(msg)}${os.EOL}`;
    fs.appendFileSync(appLogPath, line, "utf8");
    appLogSize += Buffer.byteLength(line);
  } catch {
    /* لو فشل اللوج، البرنامج بيكمل عادي */
  }
}

/**
 * ١٢٧) الصيانة: تنضيف اللوجات واللقطات القديمة تلقائيًا، وإحصاء حجمها.
 * البرنامج مش بيسيب ملفات تكبر لانهائي على جهاز المستخدم.
 */
const RETENTION_DAYS = { logs: 14, diagnostics: 7 };

function dirFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .map((name) => {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        return { name, full, size: st.size, mtime: st.mtimeMs };
      })
      .filter((f) => f.size >= 0);
  } catch {
    return [];
  }
}

function filesStats(dir) {
  const files = dirFiles(dir);
  return {
    count: files.length,
    bytes: files.reduce((n, f) => n + f.size, 0),
  };
}

/** تنضيف الملفات الأقدم من المدة المسموحة (أو كلها لو all=true) */
function pruneRuntime({ all = false } = {}) {
  const now = Date.now();
  const removed = [];
  for (const [key, days] of Object.entries(RETENTION_DAYS)) {
    const dir = key === "logs" ? logsDir() : diagDir();
    for (const f of dirFiles(dir)) {
      const expired = all || now - f.mtime > days * 24 * 60 * 60 * 1000;
      if (!expired) continue;
      try {
        fs.rmSync(f.full, { force: true });
        removed.push(f.name);
      } catch {
        /* تجاهل */
      }
    }
  }
  // النسخ الاحتياطية: بنحتفظ بآخر ٧ بس (مش بالعمر — كل نسخة يوم)
  try {
    const backups = dirFiles(backupDir()).sort((a, b) => b.mtime - a.mtime);
    for (const f of backups.slice(7)) {
      try {
        fs.rmSync(f.full, { force: true });
        removed.push(f.name);
      } catch {
        /* تجاهل */
      }
    }
  } catch {
    /* تجاهل */
  }
  if (all) {
    appLogPath = null;
    appLogSize = 0;
  }
  return {
    removed: removed.length,
    logs: filesStats(logsDir()),
    diagnostics: filesStats(diagDir()),
    backups: filesStats(backupDir()),
    retention: RETENTION_DAYS,
  };
}

// ---------------------------------------------------------------------------
// بيانات الدخول: متشفّرة على القرص بمفتاح النظام (DPAPI على ويندوز)
// قبل كده كانت بتتحفظ نص صريح في localStorage — أي ملف على الجهاز كان يقراها.
// ---------------------------------------------------------------------------

/**
 * حفظ بيانات دخول نايس دير مشفّرة.
 * لو تشفير النظام مش متاح (نادر جدًا)، بنرفض الحفظ بدل ما نكتبها نص صريح.
 */
function saveCredentialsSecure({ username, password } = {}) {
  const user = String(username || "").trim();
  const pass = String(password || "");
  if (!user || !pass) return { ok: false, error: "اليوزر والباسورد مطلوبين" };
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      error: "تشفير النظام غير متاح على الجهاز — البرنامج مش هيحفظ كلمة السر. اكتبها كل مرة.",
    };
  }
  try {
    fs.mkdirSync(secureDir(), { recursive: true });
    const payload = JSON.stringify({ username: user, password: pass, at: Date.now() });
    const encrypted = safeStorage.encryptString(payload);
    const tmp = `${credsFile()}.tmp`;
    fs.writeFileSync(tmp, encrypted);
    fs.renameSync(tmp, credsFile());
    appendLog("info", "اتحفظت بيانات الدخول مشفّرة");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/** قراءة بيانات الدخول المشفّرة (بترجع {} لو مش موجودة) */
function loadCredentialsSecure() {
  try {
    if (!fs.existsSync(credsFile())) return { ok: true, data: null };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "تشفير النظام غير متاح" };
    const raw = safeStorage.decryptString(fs.readFileSync(credsFile()));
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      data: { username: String(parsed.username || ""), password: String(parsed.password || "") },
    };
  } catch {
    return { ok: false, error: "الملف المشفّر تالف أو من جهاز تاني — اكتب البيانات مرة واحدة." };
  }
}

function clearCredentialsSecure() {
  try {
    fs.rmSync(credsFile(), { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function freeDiskMb() {
  try {
    if (typeof fs.statfsSync === "function") {
      const st = fs.statfsSync(dataDir());
      return Math.round((Number(st.bavail) * Number(st.bsize)) / 1024 ** 2);
    }
  } catch {
    /* مش مدعوم */
  }
  return null;
}

/** فحص جاهزية الجهاز — بيجهّز الناقص بنفسه وبيقول للمستخدم النتيجة */
async function preflight() {
  const dirs = ensureRuntimeDirs();
  try {
    pruneRuntime();
  } catch {
    /* الصيانة مش شرط لنجاح الفحص */
  }
  const checks = [];
  const distIndex = path.join(__dirname, "..", "dist", "index.html");
  checks.push({
    key: "app",
    label: "ملفات البرنامج",
    ok: fs.existsSync(distIndex),
    detail: fs.existsSync(distIndex) ? "الواجهة موجودة داخل المثبّت" : "ملفات الواجهة ناقصة — أعد تثبيت البرنامج",
  });

  let writable = false;
  try {
    const probeFile = path.join(dirs.data, ".write-test");
    fs.writeFileSync(probeFile, "ok");
    fs.unlinkSync(probeFile);
    writable = true;
  } catch {
    writable = false;
  }
  checks.push({
    key: "storage",
    label: "مساحة تخزين قابلة للكتابة",
    ok: writable,
    detail: writable ? dirs.data : "مش قادر يكتب في مجلد البيانات — شغّل البرنامج كمسؤول مرة واحدة",
  });

  const disk = freeDiskMb();
  checks.push({
    key: "disk",
    label: "مساحة القرص",
    ok: disk === null || disk > 500,
    detail: disk === null ? "مش معروف" : `${disk} ميجا فاضية (المطلوب ٥٠٠ على الأقل)`,
  });

  const ramGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  checks.push({
    key: "ram",
    label: "ذاكرة الجهاز",
    ok: ramGb >= 4,
    detail: `${ramGb} جيجا — ${ramGb >= 4 ? "مناسبة للنوافذ المتوازية" : "قليلة، البرنامج هيقلّل النوافذ تلقائيًا"}`,
  });

  checks.push({
    key: "runtime",
    label: "محرك التشغيل (Chromium + Node مدمج)",
    ok: Boolean(process.versions.electron && process.versions.chrome),
    detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
  });

  let online = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(SEARCH_URL, { method: "HEAD", signal: controller.signal });
    clearTimeout(timer);
    online = res.ok || res.status < 500;
  } catch {
    online = false;
  }
  checks.push({
    key: "network",
    label: "الاتصال بـ نايس دير",
    ok: online,
    detail: online ? SEARCH_URL : "مفيش اتصال — اتأكد من الإنترنت أو الفلتر",
  });

  appendLog("info", `preflight: ${checks.filter((c) => c.ok).length}/${checks.length} ناجح`);
  return { ok: checks.every((c) => c.ok), checks, dirs, info: systemInfo(), log: appLogPath };
}

// ---------------------------------------------------------------------------
// أدوات تنفيذ في الصفحة
// ---------------------------------------------------------------------------

async function run(win, code) {
  // التنقّل بيقتل سياق الصفحة، وexecuteJavaScript ساعتها بيرمي — من غير إعادة
  // محاولة كان السكربت بيرجع null في صمت والخطوة «مابتحصلش».
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!win || win.isDestroyed()) return null;
    try {
      return await wc(win).executeJavaScript(code, true);
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      const transient = /execution context|destroyed|navigat|script failed|render frame/i.test(message);
      if (!transient || attempt === 1) return null;
      await sleep(220);
    }
  }
  return null;
}

/** وعد بمهلة: لو الصفحة اتعلّقت، بنفكّ التعليق بدل ما الجلسة تقف */
function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        onTimeout?.();
      } catch {
        /* تجاهل */
      }
      reject(new Error("الصفحة مش بتستجيب — النافذة هتتستبدل"));
    }, ms);
    promise.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * تنفيذ كود في الصفحة مع watchdog:
 * نافذة متعلقة أكتر من ٤٥ ثانية (سيرفر بطيء، مودال معلّق) بتتدمّر
 * والبركة بتفتح غيرها — أحسن من جلسة واقفة للأبد.
 */
const STUCK_WINDOW_MS = 45000;

async function runStrict(win, code) {
  if (!win || win.isDestroyed()) throw new Error("النافذة اتقفلت");
  try {
    return await withTimeout(wc(win).executeJavaScript(code, true), STUCK_WINDOW_MS, () => {
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch {
        /* تجاهل */
      }
    });
  } catch (err) {
    const message = String(err && err.message ? err.message : err).replace(/^Error:\s*/, "");
    throw new Error(message);
  }
}

/** يستنى انتهاء تحميل الصفحة (حدث فعلي، مش polling) */
/** تاريخ التصفح — واجهة Electron الجديدة أو القديمة */
function navApi(win) {
  const page = wc(win);
  if (!page) return { canGoBack: () => false, goBack: () => {} };
  const nh = page.navigationHistory;
  return {
    canGoBack: () => (nh && typeof nh.canGoBack === "function" ? nh.canGoBack() : Boolean(page.canGoBack && page.canGoBack())),
    goBack: () => (nh && typeof nh.goBack === "function" ? nh.goBack() : page.goBack()),
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
    const page = contentOf(win);
    if (!page || !page.isLoadingMainFrame()) return resolve(true);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      page.removeListener("did-stop-loading", onStop);
      page.removeListener("did-fail-load", onFail);
      resolve(value);
    };
    const onStop = () => finish(true);
    const onFail = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    page.once("did-stop-loading", onStop);
    page.once("did-fail-load", onFail);
  });
}

async function safeLoad(win, url, timeoutMs = TIMEOUTS.pageLoad, referrer) {
  if (!win || win.isDestroyed()) return "error";
  const page = contentOf(win);
  if (!page) return "error";
  const load = (referrer ? page.loadURL(url, { httpReferrer: referrer }) : page.loadURL(url))
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

/**
 * نوافذ الأتمتة بتتفتح في **الخلفية** (موجودة على الشاشة لكن مش بتاخد التركيز)
 * مش مخفية تمامًا. السبب عملي:Chromium بيعتبر النافذة المخفية «مش مرئية»،
 * ونايس دير (Cloudflare) بيرفض الدخول/بيعلّق التحقق في نافذة مش مرئية،
 * وكمان الرسم بيتوقف فبتطلع صورة الروشتة بيضاء.
 */
let backgroundWindows = true;

const ND_WINDOW_PRELOAD = path.join(__dirname, "nd-window-preload.cjs");
const CHROME_PRELOAD = path.join(__dirname, "browser-chrome-preload.cjs");
const CHROME_HTML = path.join(__dirname, "browser-chrome.html");
/** ارتفاع شريط المتصفح (العنوان + أزرار التنقّل) */
const CHROME_HEIGHT = 46;

function hiddenWindowOptions(extra = {}) {
  return {
    show: false,
    // نافذة أصغر = ذاكرة ورسم أقل، ومفيش أي تأثير على قراءة الصفحة
    width: 1000,
    height: 700,
    // **نافذة متصفح حقيقية**: إطار ويندوز عادي + شريط مهام + عنوان بيتغيّر مع
    // الخطوة الجارية. الإخفاء التام (show:false نهائي) كان بيكسر نايس دير/كلاودفلير
    // وبيطلّع صور فاضية، فالنافذة بتتعرض فورًا بـshowInactive (من غير سرقة تركيز).
    frame: true,
    titleBarStyle: "default",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    minimizable: true,
    maximizable: true,
    closable: true,
    skipTaskbar: false,
    title: "روشتة برو — نايس دير",
    webPreferences: {
      partition: ND_PARTITION,
      backgroundThrottling: false,
      // الرسم بيشتغل حتى قبل الظهور — من غيره capturePage بيرجّع صورة بيضاء
      paintWhenInitiallyHidden: true,
      // بيمنع alert/confirm/prompt من إنها تجمّد الصفحة (النافذة في الخلفية)
      preload: ND_WINDOW_PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      images: true,
      ...extra,
    },
  };
}

/** مكان النافذة في الخلفية: ركن الشاشة اليمين تحت، مرتّبة فوق بعضها بشكل متدرّج */
function backgroundBounds(index = 0) {
  try {
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1024, Math.max(780, Math.round(area.width * 0.55)));
    const height = Math.min(760, Math.max(560, Math.round(area.height * 0.62)));
    const step = (Number(index) % 5) * 18;
    return {
      x: area.x + area.width - width - 12 - step,
      y: area.y + area.height - height - 12 - step,
      width,
      height,
    };
  } catch {
    return { x: 40, y: 40, width: 1000, height: 700 };
  }
}

/**
 * عرض النافذة في الخلفية من غير سرقة التركيز.
 * لو المستخدم قافل الوضع ده، النافذة بتفضل مخفية (سلوك النسخ القديمة).
 */
function presentInBackground(win, index = 0) {
  if (!win || win.isDestroyed()) return;
  if (!backgroundWindows) {
    try {
      win.hide();
    } catch {
      /* تجاهل */
    }
    return;
  }
  try {
    win.setBounds(backgroundBounds(index));
    // نافذة حقيقية في شريط المهام: تقدر تشوفها وتدوس عليها في أي وقت.
    // مفيش سرقة تركيز لأن الظهور بـshowInactive مش بـshow.
    win.setSkipTaskbar(false);
    win.showInactive();
  } catch {
    /* لو مش قادر يعرضها، بنكمل */
  }
}

/**
 * عنوان النافذة + شريط المتصفح = اللي بيتعمل فيها دلوقتي بالظبط.
 * النافذة الحقيقية بتتعرف من شريط المهام ومن شريط العنوان، فالاتنين بيتحدّثوا
 * من نفس المصدر (الخطوة الجارية) — مش زينة.
 */
function labelWindow(win, text) {
  if (!win || win.isDestroyed()) return;
  const title = String(text || "").trim();
  win.__rpLabel = title;
  try {
    win.setTitle(title ? `روشتة برو — ${title}` : "روشتة برو — نايس دير");
  } catch {
    /* تجاهل */
  }
  pushChromeState(win);
}

// ---------------------------------------------------------------------------
// نافذة = متصفح حقيقي: شريط عنوان + أزرار تنقّل + محتوى معزول (WebContentsView)
// ---------------------------------------------------------------------------

/**
 * محتوى الصفحة جوه النافذة.
 *
 * النافذة بقت حاوية فيها شريط متصفح فوق ومحتوى نايس دير تحته (WebContentsView).
 * كل الأتمتة بتشتغل على المحتوى ده مش على النافذة نفسها. لو الـAPI مش متاح
 * (نسخة Electron قديمة) بنرجع لـwebContents النافذة نفسه — نفس السلوك القديم.
 */
function contentOf(win) {
  if (!win || win.isDestroyed()) return null;
  const view = win.__rpView;
  if (view && view.webContents && !view.webContents.isDestroyed()) return view.webContents;
  return win.webContents;
}

/** اختصار شائع الاستخدام في كل كود الأتمتة */
const wc = (win) => contentOf(win);

let viewsSupported = null;
/** هل WebContentsView متاح فعلًا في نسخة Electron دي؟ (بيتفحص مرة واحدة) */
function canUseViews() {
  if (viewsSupported !== null) return viewsSupported;
  try {
    if (typeof WebContentsView !== "function") {
      viewsSupported = false;
      return false;
    }
    const probe = new WebContentsView({ webPreferences: { partition: "persist:rp-probe" } });
    try {
      probe.webContents.close();
    } catch {
      /* تجاهل */
    }
    viewsSupported = true;
  } catch (err) {
    appendLog("warn", `إطار المتصفح مش متاح في نسخة Electron دي: ${err?.message || err}`);
    viewsSupported = false;
  }
  return viewsSupported;
}

/** حالة شريط العنوان: الرابط الحقيقي، إمكانية الرجوع/التقدم، والتحميل */
function pushChromeState(win) {
  if (!win || win.isDestroyed() || !win.__rpView) return;
  const content = win.__rpContent;
  if (!content || content.isDestroyed()) return;
  const nh = content.navigationHistory;
  const canBack = () => {
    try {
      return nh && typeof nh.canGoBack === "function" ? nh.canGoBack() : Boolean(content.canGoBack && content.canGoBack());
    } catch {
      return false;
    }
  };
  const canForward = () => {
    try {
      return nh && typeof nh.canGoForward === "function" ? nh.canGoForward() : Boolean(content.canGoForward && content.canGoForward());
    } catch {
      return false;
    }
  };
  let onTop = false;
  try {
    onTop = win.isAlwaysOnTop();
  } catch {
    /* تجاهل */
  }
  const state = {
    url: (() => {
      try {
        return content.getURL() || "about:blank";
      } catch {
        return "about:blank";
      }
    })(),
    canGoBack: canBack(),
    canGoForward: canForward(),
    loading: (() => {
      try {
        return content.isLoading();
      } catch {
        return false;
      }
    })(),
    label: win.__rpLabel || "",
    onTop,
  };
  try {
    win.webContents.send("nd:chrome-state", state);
  } catch {
    /* الشريط ممكن يكون لسه بيحمّل */
  }
}

/** ربط أحداث المحتوى بشريط العنوان */
function wireChrome(win) {
  const content = win.__rpContent;
  if (!content) return;
  const push = () => pushChromeState(win);
  for (const event of [
    "did-start-loading",
    "did-stop-loading",
    "did-navigate",
    "did-navigate-in-page",
    "did-frame-finish-load",
    "page-title-updated",
  ]) {
    content.on(event, push);
  }
  /**
   * شورت كت المتصفح الحقيقية وهي شغالة على الصفحة نفسها:
   * التركيز غالبًا جوه المحتوى (مش على الشريط)، فمن غير الربط ده `F5` و`Alt+←`
   * كانوا بيضيعوا على الصفحة. هنا بننفذهم على المحتوى ونمنع الصفحة من استهلاكهم.
   */
  content.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = String(input.key || "");
    const lower = key.toLowerCase();
    const nh = content.navigationHistory;
    const back = () => {
      if (nh && typeof nh.canGoBack === "function" ? nh.canGoBack() : content.canGoBack?.()) {
        if (nh && typeof nh.goBack === "function") nh.goBack();
        else content.goBack();
      }
    };
    const forward = () => {
      if (nh && typeof nh.canGoForward === "function" ? nh.canGoForward() : content.canGoForward?.()) {
        if (nh && typeof nh.goForward === "function") nh.goForward();
        else content.goForward();
      }
    };
    if (key === "F5" || ((input.control || input.meta) && lower === "r" && !input.shift && !input.alt)) {
      event.preventDefault();
      content.reload();
      push();
      return;
    }
    if (!input.alt) return;
    if (key === "ArrowLeft") {
      event.preventDefault();
      back();
      push();
    } else if (key === "ArrowRight") {
      event.preventDefault();
      forward();
      push();
    }
  });

  win.on("resize", () => {
    layoutContent(win);
    push();
  });
  ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "restore"].forEach((event) =>
    win.on(event, () => {
      layoutContent(win);
      push();
    }),
  );
}

/** مكان محتوى الصفحة تحت شريط المتصفح */
function layoutContent(win) {
  if (!win || win.isDestroyed() || !win.__rpView) return;
  try {
    const [width, height] = win.getContentSize();
    // لو شريط المتصفح مش محمّل (فشل تحميل ملف الشريط) بنخلي المحتوى ياخد
    // النافذة كلها — شريط أبيض فاضي فوق الصفحة كان بيبوّظ شكل «المتصفح».
    const top = win.__rpChromeOk ? CHROME_HEIGHT : 0;
    win.__rpView.setBounds({
      x: 0,
      y: top,
      width: Math.max(0, width),
      height: Math.max(0, height - top),
    });
  } catch {
    /* تجاهل */
  }
}

/**
 * نافذة متصفح حقيقية: إطار ويندوز + شريط عنوان وأزرار + محتوى في partition
 * مستقل. العزل هنا مهم وظيفيًا: كل نافذة ليها كوكيز وجلسة سيرفر مختلفة،
 * فنتائج بحث ساب مش بتتبهدل بنتائج ساب تاني بيتجرد في نفس اللحظة.
 */
function createBrowserWindow({ partition = ND_PARTITION, title = "روشتة برو — نايس دير", index = 0 } = {}) {
  const bounds = backgroundBounds(index);
  const useView = canUseViews();
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: true,
    titleBarStyle: "default",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    title,
    webPreferences: useView
      ? { preload: CHROME_PRELOAD, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
      : {
          partition,
          backgroundThrottling: false,
          paintWhenInitiallyHidden: true,
          preload: ND_WINDOW_PRELOAD,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          images: true,
        },
  });

  if (useView) {
    try {
      const view = new WebContentsView({
        webPreferences: {
          partition,
          backgroundThrottling: false,
          paintWhenInitiallyHidden: true,
          preload: ND_WINDOW_PRELOAD,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          images: true,
        },
      });
      win.contentView.addChildView(view);
      win.__rpView = view;
      win.__rpContent = view.webContents;
      layoutContent(win);
      wireChrome(win);
      win.__rpChromeOk = false;
      win.webContents.on("did-finish-load", () => {
        win.__rpChromeOk = true;
        layoutContent(win);
        pushChromeState(win);
      });
      win.webContents.on("did-fail-load", () => {
        win.__rpChromeOk = false;
        layoutContent(win);
      });
      win.loadFile(CHROME_HTML).catch(() => {
        // لو ملف الشريط مش موجود/مش مقروء: المحتوى ياخد النافذة كلها
        win.__rpChromeOk = false;
        layoutContent(win);
      });
      win.on("closed", () => {
        try {
          if (win.__rpView && win.__rpContent && !win.__rpContent.isDestroyed()) win.__rpContent.close();
        } catch {
          /* تجاهل */
        }
        win.__rpView = null;
        win.__rpContent = null;
      });
    } catch (err) {
      appendLog("warn", `فشل إنشاء إطار المتصفح: ${err?.message || err} — نافذة عادية`);
      win.__rpView = null;
      win.__rpContent = null;
    }
  }
  return win;
}

/**
 * دليل حقيقي عند الفشل: صورة النافذة + HTML الصفحة زي ما هي لحظة الفشل.
 *
 * ليه؟ لأن «الخطوات مش بتتعمل» مش معلومة؛ المعلومة هي **الصفحة اللي كانت مفتوحة**
 * (هل هي صفحة البحث؟ صفحة دخول؟ رسالة رفض؟). الدليل بيتحفظ في مجلد
 * `diagnostics` ومساره بيرجع مع رسالة الفشل نفسها — مفيش طلب لوجات من المستخدم.
 * مفيش أي بيانات دخول في الملف: قيم الـinput مش بتتحول لـattribute، والسكربتات
 * بتتشال، والحجم بيتقص.
 */
const EVIDENCE_HTML_SCRIPT = `(() => {
  try {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('script, iframe, link[rel="preload"]').forEach((el) => el.remove());
    clone.querySelectorAll('input, textarea').forEach((el) => {
      el.removeAttribute('value');
      el.textContent = '';
      el.setAttribute('data-rp-redacted', '1');
    });
    return clone.outerHTML.slice(0, 400000);
  } catch (e) {
    return '';
  }
})()`;

async function saveWindowEvidence(win, tag) {
  if (!win || win.isDestroyed()) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTag = String(tag || "page")
    .replace(/[^\w.-]+/g, "-")
    .slice(0, 40);
  const base = path.join(diagDir(), `${safeTag}-${stamp}`);
  const files = {};
  try {
    const html = await run(win, EVIDENCE_HTML_SCRIPT);
    if (html && html.length > 200) {
      fs.writeFileSync(`${base}.html`, html);
      files.html = `${base}.html`;
    }
  } catch {
    /* الدليل مش حرج للتنفيذ */
  }
  try {
    ensurePaintable(win);
    const img = await wc(win).capturePage();
    if (img && !img.isEmpty()) {
      fs.writeFileSync(`${base}.png`, img.toPNG());
      files.png = `${base}.png`;
    }
  } catch {
    /* تجاهل */
  }
  return Object.keys(files).length ? files : null;
}

/** قبل اللقطة: نتأكد إن النافذة بترسم فعلًا */
function ensurePaintable(win) {
  if (!win || win.isDestroyed()) return;
  try {
    if (!win.isVisible()) win.showInactive();
  } catch {
    /* تجاهل */
  }
}

// ---------------------------------------------------------------------------
// تقليل الموارد: خطوط وميديا وتتبّع دايمًا، وصور صفحة البحث لما مفيش روشتة
// ---------------------------------------------------------------------------

/** نوافذ ممنوع فيها تحميل الصور (صفحة البحث والإرجاع) — بتتقفل قبل فتح الروشتة */
const noImageWindows = new Set();
/** الجلسات اللي اتركّب عليها حاجب الموارد — كل نافذة ليها جلسة مستقلة */
const blockedSessions = new WeakSet();

function setResourceMode(win, mode) {
  if (!win || win.isDestroyed()) return;
  const page = contentOf(win);
  if (!page) return;
  if (mode === "images") noImageWindows.delete(page.id);
  else noImageWindows.add(page.id);
}

/** حجب الموارد بيتظبط لكل جلسة على حدة (كل نافذة ليها partition مستقل) */
function setupResourceBlocking(ses) {
  const nd = ses || session.fromPartition(ND_PARTITION);
  if (!nd || blockedSessions.has(nd)) return;
  blockedSessions.add(nd);
  try {
    nd.webRequest.onBeforeRequest((details, callback) => {
      const type = details.resourceType;
      // الخطوط والوسائط مش محتاجينها لا في البحث ولا في الروشتة
      if (type === "font" || type === "media") return callback({ cancel: true });
      if (type === "image" && noImageWindows.has(details.webContentsId)) return callback({ cancel: true });
      if (/google-analytics|googletagmanager|doubleclick|hotjar|clarity\.ms|sentry\.io|facebook\.net/i.test(details.url)) {
        return callback({ cancel: true });
      }
      return callback({});
    });
  } catch {
    /* لو الواجهة مش مدعومة، بنكمل عادي */
  }
}

/**
 * أي نافذة منبثقة من نايس دير بتتقفل، والسؤال بس: نفتح الرابط ده في المتصفح؟
 * الفلترة بقت على المضيف الحقيقي (SEC) — الدومينات اللي بتشبه الاسم بتترفض،
 * وبروتوكولات زي file: و ms-msdt: مش بتتفتح خالص.
 */
/**
 * هل الرابط ده صفحة روشتة فعلية؟ (صفحة الصور أو فتح المطالبة)
 * بنستخدمه عشان ما نعتبرش لقطة صفحة البحث «صورة روشتة» — دي كانت هتخلي
 * البرنامج يعرض صورة غلط بدل ما يقول إن الصورة ماجاتش.
 */
const PRESCRIPTION_URL_RE = /PrescriptionImgs|Prescription|OpenClaim/i;
const isPrescriptionUrl = (url) => PRESCRIPTION_URL_RE.test(String(url || ""));

const DEFAULT_POPUP_HANDLER = ({ url }) => {
  if (SEC.isSafeExternalUrl(url) && !SEC.isNiceDeerUrl(url)) void shell.openExternal(url);
  return { action: "deny" };
};

class WindowPool {
  constructor({ name, max, keepState, blockImages = true }) {
    this.name = name;
    this.max = max;
    this.windows = [];
    this.busy = new Set();
    this.keepState = keepState;
    this.blockImages = blockImages;
    this.idleSince = new Map();
  }

  get size() {
    return this.windows.length;
  }

  create() {
    // كل نافذة ليها **جلسة (partition) خاصة**: كوكيز وتخزين منفصلين.
    // من غير العزل ده، نوافذ بتجرد سابات مختلفة بتتقاسم نفس جلسة السيرفر،
    // فنتائج ساب بتتبهدل بنتائج ساب تاني بيتجرد في نفس اللحظة.
    const slot = this.windows.length + 1;
    /**
     * اختيار الجلسة: دور على أول رقم من ١ لـ١٢ **مش مستخدم دلوقتي**.
     * قبل كده كان الرقم بيتكرر كل ١٢ نافذة، فممكن نافذتين شغالين في نفس
     * اللحظة ياخدوا نفس الـpartition — يعني نفس الكوكيز ونفس جلسة السيرفر،
     * وده بالظبط اللي بيسرّب نتائج ساب لساب تاني. الرقم المتحرك لقيود الحجم
     * بس، والشرط الحقيقي إن مفيش نافذتين حيّتين على نفس الجلسة.
     */
    const taken = new Set(this.windows.map((w) => w && w.__rpPartition).filter(Boolean));
    let partition = "";
    for (let i = 0; i < 12; i += 1) {
      this.slotCounter = (this.slotCounter || 0) + 1;
      const candidate = `persist:nd-${this.name}-${((this.slotCounter - 1) % 12) + 1}`;
      if (!taken.has(candidate)) {
        partition = candidate;
        break;
      }
    }
    if (!partition) {
      // كل الـ١٢ مشغولين: جلسة جديدة تمامًا بدل ما نتشارك جلسة حد
      this.extraPartitions = (this.extraPartitions || 0) + 1;
      partition = `persist:nd-${this.name}-x${this.extraPartitions}`;
    }
    const win = createBrowserWindow({
      partition,
      title: `روشتة برو — نافذة ${this.name} #${slot}`,
      index: this.windows.length,
    });
    win.__rpPartition = partition;
    win.__rpPartitionFresh = !this.knownPartitions;
    this.knownPartitions = this.knownPartitions || new Set();
    win.__rpPartitionFresh = !this.knownPartitions.has(partition);
    this.knownPartitions.add(partition);
    const page = contentOf(win);
    win.__rpContentId = page.id;
    setupResourceBlocking(page.session);
    page.setUserAgent(UA);
    page.setWindowOpenHandler(DEFAULT_POPUP_HANDLER);
    win.__rpOps = 0;
    setResourceMode(win, this.blockImages ? "search" : "images");
    labelWindow(win, `نافذة ${this.name} #${slot}`);
    // النافذة بتظهر في الخلفية (مرئية للموقع) — ده اللي بيخلي الدخول والتحقق يشتغلوا
    presentInBackground(win, this.windows.length);
    // منع تحويل أي نافذة لصفحة غير متوقعة (بيحصل مع redirects لصفحة الدخول)
    win.on("closed", () => {
      const i = this.windows.indexOf(win);
      if (i >= 0) this.windows.splice(i, 1);
      this.busy.delete(win);
      this.idleSince.delete(win);
      if (!win.isDestroyed()) noImageWindows.delete(win.__rpContentId || 0);
    });
    this.windows.push(win);
    return win;
  }

  /** تشغيل على نافذة **محددة** (محجوزة لساب) مع انتظار تحررها */
  async withWindow(win, fn, timeoutMs = 120000) {
    if (!win || win.isDestroyed()) throw new Error("النافذة المحجوزة اتقفلت");
    const started = Date.now();
    while (this.busy.has(win) && Date.now() - started < timeoutMs) await sleep(25);
    if (win.isDestroyed()) throw new Error("النافذة المحجوزة اتقفلت");
    this.busy.add(win);
    try {
      return await fn(win);
    } finally {
      this.release(win);
    }
  }

  /** نافذة اتقفلت أو عملت عمليات كتير → نشيلها من البركة */
  destroy(win) {
    if (win && win.__rpLease) releaseWindowLease(win.__rpLease);
    const i = this.windows.indexOf(win);
    if (i >= 0) this.windows.splice(i, 1);
    this.busy.delete(win);
    this.idleSince.delete(win);
    try {
      if (!win.isDestroyed()) {
        noImageWindows.delete(win.__rpContentId || 0);
        win.destroy();
      }
    } catch {
      /* تجاهل */
    }
  }

  /** تقليل النوافذ الخاملة لما الذاكرة تقرب تخلص أو بعد فترة سكون */
  prune({ force = false } = {}) {
    const free = this.windows.filter(
      (w) => !this.busy.has(w) && !w.isDestroyed() && !w.__rpLease && !(w.__rpSab && !w.__rpSabDone),
    );
    const freeMemMb = os.freemem() / 1024 ** 2;
    const keep = force ? 0 : Math.min(free.length, 1);
    let removed = 0;
    for (const win of free) {
      if (removed >= free.length - keep) break;
      const idleFor = Date.now() - (this.idleSince.get(win) || Date.now());
      const lowMemory = freeMemMb < 900 && this.windows.length > 2;
      if (lowMemory || force || idleFor > 120000) {
        this.destroy(win);
        removed += 1;
      }
    }
    return removed;
  }

  async acquire(timeoutMs = 180000) {
    const ready = this.windows.filter((w) => !this.busy.has(w) && !w.isDestroyed());
    // **ممنوع** ناخد نافذة محجوزة لساب شغال — دي متصفح بيتكلم مع سيرفر بجلسة ساب تاني
    // نافذة حرة الأول، وبعدها أي نافذة غير محجوزة، وبعدها نفتح واحدة جديدة
    const free = ready.find((w) => !w.__rpLease && !(w.__rpSab && !w.__rpSabDone)) || ready.find((w) => !w.__rpLease);
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
      // وممنوع كمان في الانتظار: نافذة محجوزة لساب شغال مش بتتسلّم لحد تاني
      const w = this.windows.find(
        (x) => !this.busy.has(x) && !x.isDestroyed() && !x.__rpLease,
      );
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
    if (!win || win.isDestroyed()) return;
    win.__rpOps = (win.__rpOps || 0) + 1;
    this.idleSince.set(win, Date.now());
    /**
     * نافذة مربوطة بساب شغال: **ما تتقفلش** في نص العملية.
     * السبب حقيقي مش شكلي: لو النافذة اتقفلت، نتائج بحث الساب بتضيع وكل
     * استمارة بتفتح بحث جديد كامل — وده بالظبط اللي كان بيخلي الصرف بطيء
     * وبيفصل «كل متصفح يمشي ساب واحد» لأن الساب بيقفز بين نوافذ.
     */
    if (win.__rpSab && !win.__rpSabDone) return;
    // إعادة تدوير النافذة بعد عدد عمليات كبير: بتمنع تضخّم الذاكرة في الجلسات الطويلة
    if (win.__rpOps >= MAX_OPS_PER_WINDOW) {
      this.destroy(win);
      return;
    }
    const freeMemMb = os.freemem() / 1024 ** 2;
    if (freeMemMb < 900 && this.windows.length > 2 && this.windows.length > this.busy.size + 1) {
      this.destroy(win);
    }
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

/**
 * حجز نافذة لكل ساب: من أول بحث لحد آخر استمارة.
 *
 * ليه ده مهم؟ لأن bridge calls بتيجي من المحرك أوبالتوازي (سابات مختلفة في
 * نفس الوقت). من غير الحجز، احتمال إن استمارة ساب تتجرد على نافذة تانية غير
 * اللي عملت البحث — فتضيع نتايج البحث ويبدأ الساب من صفحة فاضية.
 * بالحجز ده: **كل متصفح يمشي ساب واحد بس** من أوله لآخره.
 */
const sabWindowLease = new Map();

function leaseWindowForSab(sab, win) {
  const key = String(sab);
  sabWindowLease.set(key, win);
  if (win && !win.isDestroyed()) win.__rpLease = key;
  return win;
}

function leasedWindowForSab(sab) {
  const key = String(sab);
  const win = sabWindowLease.get(key);
  if (!win || win.isDestroyed()) {
    sabWindowLease.delete(key);
    return null;
  }
  return win;
}

function releaseWindowLease(sab) {
  const key = String(sab);
  const win = sabWindowLease.get(key) || null;
  sabWindowLease.delete(key);
  if (win && !win.isDestroyed() && win.__rpLease === key) win.__rpLease = null;
  return win;
}

const workers = new WindowPool({ name: "workers", max: Math.min(5, MAX_WORKERS), keepState: true });
// نوافذ التقاط: الصور مسموحة فيها (كانت محجوبة → الصورة ماكانتش بتظهر خالص)
const captures = new WindowPool({
  name: "captures",
  max: Math.min(4, MAX_WORKERS),
  keepState: false,
  blockImages: false,
});

// كل دقيقة: اقفل النوافذ الخاملة اللي مش مستخدمة من دقيقتين (تحرير رام)
setInterval(() => {
  try {
    workers.prune();
    captures.prune();
    deleters.prune();
  } catch {
    /* تجاهل */
  }
}, 60000).unref?.();

// ---------------------------------------------------------------------------
// طابور الإرجاع (Delete) في الخلفية
// ---------------------------------------------------------------------------

const deleteResults = new Map(); // key -> { state, at, ms }
const deleteJobs = [];
let deleteRunning = 0;
const deleters = new WindowPool({ name: "deleters", max: MAX_DELETERS, keepState: false });

/** إعادات الإرجاع — بنعيد الفاشل مرة واحدة بس في آخر الجلسة */
const deleteRetry = new Map();

/**
 * «عصر» الإرجاع: لو المستخدم لغى العملية، العصر بيتغيّر وكل مهمة اتظبطت في
 * العصر القديم بتتجاهل قبل ما تلمس الموقع. ده اللي بيضمن إن **الإلغاء = مفيش حذف**. 
 */
let deleteEpoch = 0;

function enqueueDelete(job) {
  const entry = { ...job, epoch: deleteEpoch };
  deleteResults.set(entry.key, { state: "queued", at: Date.now() });
  deleteJobs.push(entry);
  pumpDeletes();
  return deleteJobs.length;
}

/**
 * إلغاء الإرجاعات: بنفرّغ الطابور وبنلغي كل مهمة لسه ما اتنفذتش، واللي شغالة
 * بترجع "cancelled" قبل أي ضغطة على #btn-DeleteClaim.
 * السبب واضح في النتيجة عشان المستخدم يعرف إن مفيش حذف حصل فعلًا.
 */
function cancelPendingDeletes(reason = "المستخدم لغى العملية") {
  deleteEpoch += 1;
  const queued = deleteJobs.splice(0, deleteJobs.length);
  for (const job of queued) {
    deleteResults.set(job.key, { state: "cancelled", at: Date.now(), reason });
  }
  let retried = 0;
  for (const [key, job] of [...deleteRetry.entries()]) {
    const prev = deleteResults.get(key);
    if (prev && (prev.state === "done" || prev.state === "confirmed")) continue;
    deleteResults.set(key, { state: "cancelled", at: Date.now(), reason });
    deleteRetry.delete(key);
    retried += 1;
  }
  const total = queued.length + retried;
  if (total) liveStep(`اتلغى ${total} إرجاع — مفيش حذف لأن العملية اتلغت`);
  return { cancelled: total, running: deleteRunning };
}

function deleteBacklog() {
  return { pending: deleteJobs.length, running: deleteRunning };
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
  // اتلغى قبل ما يبدأ أو وهو في الطابور → مفيش أي لمس للموقع
  if (job.epoch !== deleteEpoch) {
    deleteResults.set(job.key, { state: "cancelled", at: Date.now(), reason: "المستخدم لغى العملية" });
    return;
  }
  try {
    // نفس الساب على نفس النافذة (الكوكيز والجلسة موجودة) — أسرع وبيمنع قفز الحالة
    const state = await deleters.withPref(
      (win) => win.__rpSab === job.sab,
      async (win) => {
        win.__rpSab = job.sab;
        // صفحة الإرجاع مش محتاجة صور — بنمنعها لتسريع التحميل
        setResourceMode(win, "search");
        labelWindow(win, `ساب ${job.sab} — إرجاع ${job.reference}`);
        /**
         * الإرجاع بيحصل في نافذة من بركة مستقلة (جلسة خاصة). من غير ضمان
         * الدخول، الصفحة كانت بتفتح على صفحة الدخول → مفيش #btn-DeleteClaim
         * → الإرجاع يتسجّل «not-found» والاستمارة تفضل مفتوحة في الصرف
         * من غير ما حد يعرف. الضمان هنا قبل أي تحميل.
         */
        let sessionState = "ok";
        try {
          sessionState = await ensureSession(win, credentials);
        } catch (err) {
          capLog(`إرجاع ${job.reference}`, `ضمان الجلسة فشل: ${String(err?.message || err).slice(0, 120)}`);
          sessionState = "logged-out";
        }
        if (sessionState === "logged-out") return "login";
        for (const candidate of job.candidates) {
          if (!candidate || candidate === "main") continue;
          const loaded = await safeLoad(win, candidate, TIMEOUTS.delete);
          if (loaded === "error") continue;
          // الإلغاء ممكن يحصل والصفحة لسه بتفتح — بنحترمه قبل أي ضغطة
          if (job.epoch !== deleteEpoch) return "cancelled";
          const hasButton = await run(win, S.waitForSelectorScript("#btn-DeleteClaim", 3500));
          if (!hasButton) continue;
          const click = await run(win, S.CLICK_DELETE_SCRIPT);
          if (click !== "clicked") continue;

          // تأكيد حقيقي: بنستنى انتهاء الطلب ونقرأ نتيجة الصفحة بدل الافتراض
          await run(win, S.WAIT_AJAX_IDLE_SCRIPT(5000));
          const outcome = await run(win, S.DELETE_OUTCOME_SCRIPT);
          // «تم» ما تتقالش غير بتأكيد. لو الصفحة ما أكدتش، الحالة "unverified"
          // وبتتعاد مرة واحدة — مش بنحسبها نجاح على أمل إنها نجحت.
          if (outcome === "confirmed") return "done";
          if (outcome === "error") return "error";
          return "unverified";
        }
        return "not-found";
      },
      1500,
    );
    if (state === "login") {
      // الصفحة مفتحتش أصلًا بجلسة داخلة → مفيش أي ضغطة حذف، والحالة تتقال بصراحة
      deleteResults.set(job.key, {
        state: "error",
        error: "نافذة الإرجاع مش داخلة بحساب — الاستمارة لسه مفتوحة في الصرف",
        at: Date.now(),
        ms: Date.now() - started,
      });
      if (!job.retried) deleteRetry.set(job.key, { ...job, retried: true });
      return;
    }
    deleteResults.set(job.key, { state, at: Date.now(), ms: Date.now() - started });
    if (state === "error" || state === "not-found" || state === "unverified") {
      if (!job.retried) deleteRetry.set(job.key, { ...job, retried: true });
    }
  } catch (err) {
    deleteResults.set(job.key, {
      state: "error",
      error: String(err && err.message ? err.message : err),
      at: Date.now(),
      ms: Date.now() - started,
    });
    if (!job.retried) deleteRetry.set(job.key, { ...job, retried: true });
  }
}

/** إعادة محاولة الإرجاعات اللي فشلت — مرة واحدة، آخر الجلسة */
function retryFailedDeletes() {
  const jobs = [...deleteRetry.values()];
  deleteRetry.clear();
  for (const job of jobs) enqueueDelete(job);
  return jobs.length;
}

// ---------------------------------------------------------------------------
// عزل الجلسات: نافذة = متصفح مستقل + نسخ كوكي الهوية بس
// ---------------------------------------------------------------------------

/** أسماء كوكيز الجلسة اللي لازم تفضل مستقلة لكل نافذة */
const SESSION_COOKIE_RE = /session|sessid|jsessionid|phpsessid|asp\.net_session/i;

/**
 * نسخ **كوكي الهوية** (زي ASPXAUTH) من جلسة الدخول الأساسية لأي نافذة معزولة،
 * مع ترك كوكي الجلسة (ASP.NET_SessionId وأمثاله) — فكل نافذة بتحصل على جلسة
 * سيرفر جديدة مستقلة وبنفس الحساب.
 *
 * النتيجة: كل متصفح بيمشي خطوات ساب معيّن لوحده، ونتائج بحثه مش بتتبهدل
 * بنتائج ساب تاني شغال في نفس اللحظة — وده كان أصل «تداخل المعلومات».
 */
async function copyAuthCookies(win) {
  try {
    const page = contentOf(win);
    if (!page) return 0;
    const source = session.fromPartition(ND_PARTITION);
    const target = page.session;
    if (!target || source === target) return 0;
    let cookies = [];
    try {
      cookies = await source.cookies.get({ url: BASE });
    } catch {
      cookies = [];
    }
    let copied = 0;
    for (const cookie of cookies) {
      if (!cookie || !cookie.name) continue;
      if (SESSION_COOKIE_RE.test(cookie.name)) continue;
      const host = String(cookie.domain || "").replace(/^\./, "");
      if (!host) continue;
      try {
        await target.cookies.set({
          url: `https://${host}${cookie.path || "/"}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || "/",
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          sameSite: cookie.sameSite,
          ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}),
        });
        copied += 1;
      } catch {
        /* كوكي واحد مش مشكلة */
      }
    }
    if (copied) capLog("session", `نافذة معزولة: اتنسخ ${copied} كوكي هوية من الجلسة الأساسية`);
    return copied;
  } catch {
    return 0;
  }
}

/**
 * دخول **في نفس المتصفح** — زي ما المستخدم بيعمله بإيده:
 * `https://nicedeer.net/Account/Login` → `#UserName` → `#passwordInput`
 * → `#loginBTN`. كل متصفح بيسجّل دخوله بنفسه، وبيانات الإعداد هي اللي بتتكتب
 * في كل واحد فيهم.
 *
 * القفل هنا لكل **نافذة** (مش قفل عام): نوافذ مختلفة بتدخل في نفس الوقت، لكن
 * نفس النافذة مش بتدخل مرتين. وبنفرّق المحاولات بكسر بسيط عشان السيرفر
 * ميشوفش عشر محاولات دخول في نفس اللحظة.
 */
const windowLoginPromises = new Map();
let loginStagger = 0;

async function loginInWindow(win, creds) {
  if (!win || win.isDestroyed()) throw new LoginError("المتصفح اتقفل قبل الدخول", "no-window");
  const key = win.id;
  const running = windowLoginPromises.get(key);
  if (running) return running;
  const delay = Math.min(6000, (loginStagger += 1) * 600);
  const task = (async () => {
    if (delay) await sleep(delay);
    traceStep(`دخول في المتصفح #${key} (${win.__rpLabel || "نافذة"})`);
    return runLoginSteps(win, creds, { challengeWaitMs: 30000, interactive: false, tag: `login-win-${key}` });
  })().finally(() => windowLoginPromises.delete(key));
  windowLoginPromises.set(key, task);
  return task;
}

/**
 * دخول النافذة المعزولة: **دخول حقيقي في نفس المتصفح أولًا** (طلب المستخدم)،
 * ولو الموقع عمل تحقق بشري أو رفض، بننسخ هوية الجلسة الأساسية وبنكمّل —
 * عشان متبقاش نافذة واحدة بتوقف الجرد كله.
 */
async function loginIntoIsolatedWindow(win, credentials) {
  try {
    await loginInWindow(win, credentials);
    await safeLoad(win, SEARCH_URL);
    if (await run(win, S.waitForSelectorScript("#SearchCode", 15000))) return "logged-in";
  } catch (err) {
    traceStep(`الدخول في نفس المتصفح ما كملش (${String(err?.message || err).slice(0, 80)}) — بنجرّب هوية الجلسة`);
  }
  const copied = await copyAuthCookies(win);
  if (copied) {
    await safeLoad(win, SEARCH_URL);
    if (await run(win, S.waitForSelectorScript("#SearchCode", 15000))) return "shared-auth";
  }
  // آخر حل: نافذة دخول مرئية (المستخدم بيعدّي التحقق بإيده)
  await loginOnce(win, credentials);
  await copyAuthCookies(win);
  await safeLoad(win, SEARCH_URL);
  return "logged-in";
}

// ---------------------------------------------------------------------------
// تسجيل الدخول وصفحة البحث
// ---------------------------------------------------------------------------

async function pageState(win) {
  return run(win, S.PAGE_STATE_SCRIPT);
}

/**
 * قفل تسجيل الدخول: من غير القفل ده أكتر من نافذة بتسجّل دخول في نفس اللحظة،
 * وده بيولّد محاولات فاشلة وبيبطّأ كل حاجة. النافذة اللي بتدخل بتعملها مرة،
 * والباقي بيستنى نفس الوعد وبيستفيد من الكوكيز المشتركة.
 */
let loginPromise = null;

// ---------------------------------------------------------------------------
// أثر المحاولة: كل خطوة بتتسجّل — عشان أي فشل يبقى له سبب مكتوب مش تخمين
// ---------------------------------------------------------------------------

let loginTrace = [];

function traceStep(message) {
  const line = `${new Date().toLocaleTimeString("ar-EG")} — ${message}`;
  loginTrace.push(line);
  if (loginTrace.length > 80) loginTrace.shift();
  try {
    appendLog("info", `login: ${message}`);
  } catch {
    /* السجل مش حرج */
  }
  return line;
}

class LoginError extends Error {
  constructor(message, code = "unknown") {
    super(message);
    this.name = "LoginError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// نافذة تسجيل الدخول المرئية (بتشارك نفس الجلسة مع كل نوافذ الأتمتة)
// ---------------------------------------------------------------------------

let loginWin = null;

/** النافذة الرئيسية (الواجهة) — بنبعت منها الأحداث المباشرة */
let appWindow = null;

/**
 * بث خطوة حقيقية للواجهة عشان المستخدم يشوف النوافذ بتعمل إيه دلوقتي.
 * مش حالة وهمية: كل سطر هنا اتنفّذ فعلًا في نافذة نايس دير.
 */
function liveStep(message, extra = {}) {
  const line = {
    at: Date.now(),
    message: String(message == null ? "" : message).slice(0, 300),
    ...(extra && typeof extra === "object" ? { ref: extra.ref ? String(extra.ref).slice(0, 60) : undefined } : {}),
  };
  try {
    if (appWindow && !appWindow.isDestroyed() && !appWindow.webContents.isDestroyed()) {
      appWindow.webContents.send("nd:step", line);
    }
  } catch {
    /* لو الواجهة اتقفلت، مفيش داعي */
  }
  return line;
}

function getLoginWindow() {
  if (loginWin && !loginWin.isDestroyed()) return loginWin;
  loginWin = createBrowserWindow({
    partition: ND_PARTITION,
    title: "نايس دير — تسجيل الدخول",
    index: 0,
  });
  try {
    loginWin.setBounds({ width: 1180, height: 860 });
    loginWin.center();
  } catch {
    /* تجاهل */
  }
  const page = contentOf(loginWin);
  page.setUserAgent(UA);
  page.setWindowOpenHandler(DEFAULT_POPUP_HANDLER);
  setupResourceBlocking(page.session);
  loginWin.__rpContentId = page.id;
  labelWindow(loginWin, "تسجيل الدخول");
  loginWin.on("closed", () => {
    loginWin = null;
  });
  return loginWin;
}

/** فتح نافذة الدخول للمستخدم (تسجيل يدوي / عدّي التحقق) */
async function openLoginWindow(url = LOGIN_URL) {
  const win = getLoginWindow();
  try {
    win.setSkipTaskbar(false);
    win.center();
    win.show();
    win.focus();
  } catch {
    /* تجاهل */
  }
  if (url) await safeLoad(win, url, TIMEOUTS.pageLoad);
  return win;
}

function hideLoginWindow() {
  try {
    if (loginWin && !loginWin.isDestroyed() && loginWin.isVisible()) loginWin.hide();
  } catch {
    /* تجاهل */
  }
}

// ---------------------------------------------------------------------------
// قراءة حالة الصفحة
// ---------------------------------------------------------------------------

/** قراءة حالة صفحة الدخول وتصنيفها (فورم / داخل / تحقق بشري / رسالة رفض) */
async function probeLogin(win) {
  if (!win || win.isDestroyed()) return null;
  const raw = await run(win, S.LOGIN_PROBE_SCRIPT);
  if (!raw) return null;
  raw.errorText = RX.pickLoginError(raw.errorText);
  const verdict = RX.classifyLoginPage(raw);
  return { ...raw, state: verdict.state, message: verdict.message };
}

/** يستنى لحد ما الصفحة توصل لحالة معيّنة، وبيرجّع آخر قراءة على أي حال */
async function waitLoginState(win, wanted, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await probeLogin(win);
    if (last && wanted.includes(last.state)) return last;
    const loading = (() => {
      try {
        return wc(win).isLoadingMainFrame();
      } catch {
        return false;
      }
    })();
    await sleep(loading ? 220 : 160);
  }
  return last;
}

/** الدليل النهائي: هل صفحة البحث بتفتح فعلًا؟ (مش بس العنوان اتغيّر) */
async function verifySessionBySearchPage(win) {
  await safeLoad(win, SEARCH_URL, TIMEOUTS.login);
  const ok = await run(win, S.waitForSelectorScript("#SearchCode", 15000));
  if (!ok) return false;
  const hasPayer = await run(win, S.waitForSelectorScript("#payerId", 8000));
  traceStep(hasPayer ? "صفحة البحث والبـاير ظاهرين ✓" : "صفحة البحث ظاهرة (الباير مش ظاهر)");
  return true;
}

// ---------------------------------------------------------------------------
// تعبئة الفورم والضغط — بطريقة بتشتغل مع ASP.NET وjQuery
// ---------------------------------------------------------------------------

async function fillLoginForm(win, credentials) {
  return run(
    win,
    `(() => {
      const setVal = (sel, value) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        el.focus();
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
        if (window.jQuery) {
          try { window.jQuery(el).val(value).trigger('change').trigger('keyup'); } catch (e) {}
        }
        return el.value === value;
      };
      const a = setVal('#UserName', ${JSON.stringify(credentials.username)});
      const b = setVal('#passwordInput', ${JSON.stringify(credentials.password)});
      return { ok: a && b, user: a, pass: b };
    })()`,
  );
}

async function submitLogin(win, { viaEnter = false } = {}) {
  return run(
    win,
    viaEnter
      ? `(() => {
          const form = document.querySelector('#passwordInput') && document.querySelector('#passwordInput').form;
          if (!form) return false;
          form.requestSubmit ? form.requestSubmit() : form.submit();
          return true;
        })()`
      : `(() => {
          const btn = document.querySelector('#loginBTN') || [...document.querySelectorAll('button, input[type=submit]')].find((b) => /log\s*in|دخول|تسجيل/i.test(b.textContent || b.value || ''));
          if (!btn) return false;
          btn.click();
          return true;
        })()`,
  );
}

/** حفظ أدلة عند الفشل: HTML + صورة الشاشة */
async function dumpLoginDiagnostics(win, tag = "login") {
  const out = {};
  try {
    fs.mkdirSync(diagDir(), { recursive: true });
    const base = path.join(diagDir(), LG.diagnosticsName(tag));
    const html = await run(win, "(() => document.documentElement.outerHTML || '')()");
    if (typeof html === "string" && html.length) {
      const clean = credentials && credentials.password ? html.split(credentials.password).join("***") : html;
      out.html = `${base}.html`;
      fs.writeFileSync(out.html, clean.slice(0, 3 * 1024 * 1024), "utf8");
    }
    const shot = await captureScreenshot(win, { forceVisible: true });
    if (shot && shot.dataUrl) {
      const base64 = String(shot.dataUrl).split(",")[1] || "";
      if (base64) {
        out.image = `${base}.png`;
        fs.writeFileSync(out.image, Buffer.from(base64, "base64"));
      }
    }
  } catch {
    /* التشخيص مش حرج */
  }
  return out;
}

// ---------------------------------------------------------------------------
// مسار الدخول الكامل
// ---------------------------------------------------------------------------

/**
 * تسجيل الدخول في نافذة معيّنة.
 *
 * @param {BrowserWindow} win
 * @param {{username: string, password: string}} creds
 * @param {{challengeWaitMs?: number, interactive?: boolean, tag?: string}} [opts]
 */
async function runLoginSteps(win, creds, opts = {}) {
  const challengeWaitMs = Number(opts.challengeWaitMs) || 45000;
  const interactive = Boolean(opts.interactive);
  loginTrace = [];

  if (!creds.username || !creds.password) {
    throw new LoginError("بيانات دخول نايس دير غير محفوظة — اكتب اليوزر والباسورد في الإعداد", "no-credentials");
  }

  // النافذة لازم تكون مرئية: نايس دير/Cloudflare بيعلّقوا النافذة المخفية
  if (!interactive) presentInBackground(win, 0);
  else {
    try {
      win.setSkipTaskbar(false);
      win.show();
      win.focus();
    } catch {
      /* تجاهل */
    }
  }
  traceStep(`فتح صفحة الدخول (${interactive ? "نافذة مرئية" : "نافذة خلفية"})`);
  await safeLoad(win, LOGIN_URL, TIMEOUTS.pageLoad);

  let probe = await waitLoginState(win, ["form", "logged-in", "challenge", "error"], TIMEOUTS.login);
  if (!probe) {
    const files = await dumpLoginDiagnostics(win, opts.tag || "login");
    throw new LoginError(
      LG.buildLoginFailure({ outcome: "timeout", reason: "الصفحة مافتحتش أصلًا", files }),
      "timeout",
    );
  }
  traceStep(LG.describeProbe(probe));

  // الجلسة شغالة أصلًا
  if (probe.state === "logged-in") return { ok: true, already: true };

  // تحقق بشري: بنستنى (المستخدم ممكن يعدّيه في النافذة المرئية)
  if (probe.state === "challenge") {
    if (interactive) {
      try {
        win.setSkipTaskbar(false);
        win.show();
        win.focus();
      } catch {
        /* تجاهل */
      }
      traceStep("تحقق بشري ظاهر — النافذة مفتوحة قدامك، عدّي التحقق");
    }
    const started = Date.now();
    while (Date.now() - started < challengeWaitMs) {
      const next = await probeLogin(win);
      if (next && next.state === "logged-in") {
        traceStep("التحقق عدّى والدخول تم ✓");
        return { ok: true, already: true };
      }
      if (next && next.state === "form") break;
      await sleep(700);
    }
    const still = await probeLogin(win);
    if (!still || still.state === "challenge") {
      const files = await dumpLoginDiagnostics(win, "login-challenge");
      throw new LoginError(
        LG.buildLoginFailure({ outcome: "challenge", reason: still && still.message, probe: still, files }),
        "challenge",
      );
    }
  }

  probe = await probeLogin(win);
  if (probe && probe.state === "logged-in") return { ok: true, already: true };
  if (probe && probe.state === "error" && probe.errorText) {
    throw new LoginError(`نايس دير رفض الدخول قبل المحاولة: ${probe.errorText}`, "error");
  }
  if (!probe || !probe.hasUser || !probe.hasPass) {
    const files = await dumpLoginDiagnostics(win, "login-noform");
    throw new LoginError(
      LG.buildLoginFailure({
        outcome: "unknown",
        reason: "خانات الدخول (#UserName / #passwordInput) مش موجودة في الصفحة",
        probe,
        files,
      }),
      "no-form",
    );
  }

  const filled = await fillLoginForm(win, creds);
  if (!filled || !filled.ok) {
    const files = await dumpLoginDiagnostics(win, "login-fill");
    throw new LoginError(
      LG.buildLoginFailure({
        outcome: "unknown",
        reason: `تعذّر كتابة البيانات (يوزر: ${filled && filled.user ? "تم" : "فشل"}، باسورد: ${filled && filled.pass ? "تم" : "فشل"})`,
        probe,
        files,
      }),
      "fill-failed",
    );
  }
  traceStep("تم كتابة اليوزر والباسورد");

  const clicked = await submitLogin(win);
  traceStep(clicked ? "تم الضغط على زرار الدخول" : "زرار الدخول مش موجود — بنجرّب submit للفورم");
  if (!clicked) await submitLogin(win, { viaEnter: true });

  // انتظار النتيجة مع ضغط Enter كخطة بديلة مرة واحدة
  const started = Date.now();
  let enterTried = false;
  let verdict = { done: false, outcome: "unknown", reason: "بنستنى" };
  let lastProbe = null;

  while (!verdict.done) {
    await sleep(220);
    const elapsedMs = Date.now() - started;
    lastProbe = await probeLogin(win);
    verdict = LG.classifyAfterLogin(lastProbe, { elapsedMs, timeoutMs: TIMEOUTS.login + 15000 });

    if (!verdict.done && !enterTried && LG.shouldTryEnterFallback({ outcome: verdict.outcome, elapsedMs, alreadyTried: false })) {
      enterTried = true;
      traceStep("الصفحة لسه على الفورم — بنجرّب Enter على الفورم");
      await submitLogin(win, { viaEnter: true });
    }
  }

  traceStep(`نتيجة المحاولة: ${verdict.outcome} — ${verdict.reason}`);

  if (verdict.outcome === "success") return { ok: true, already: false };

  // أي نتيجة تانية: بنتأكد من صفحة البحث (الدليل الحقيقي)
  const verified = await verifySessionBySearchPage(win);
  if (verified) return { ok: true, already: false };

  const finalProbe = (await probeLogin(win)) || lastProbe;
  const files = await dumpLoginDiagnostics(win, `login-${verdict.outcome}`);
  const message = LG.buildLoginFailure({
    outcome: verdict.outcome === "error" ? "error" : verdict.outcome,
    reason: verdict.outcome === "error" ? finalProbe && finalProbe.errorText ? finalProbe.errorText : verdict.reason : verdict.reason,
    probe: finalProbe,
    files,
  });
  throw new LoginError(message, verdict.outcome);
}

/** دخول من نافذة الأتمتة (خلفية). لو الموقع طلب تحقق بشري بنفتح النافذة المرئية */
async function loginOnce(win, creds) {
  if (loginPromise) {
    const shared = await loginPromise.catch(() => null);
    if (!shared || !shared.ok) {
      throw new Error(shared && shared.message ? String(shared.message) : "محاولة الدخول من نافذة تانية فشلت — جرّب «اختبار الدخول» تاني");
    }
    return { ok: true, already: true, shared: true };
  }

  loginPromise = (async () => {
    try {
      return await runLoginSteps(win, creds, { challengeWaitMs: 30000, interactive: false, tag: "login-worker" });
    } catch (err) {
      const code = err instanceof LoginError ? err.code : "unknown";
      if (code === "challenge" || code === "no-form" || code === "timeout" || code === "unknown") {
        traceStep("الدخول المخفي ماحصلش — بنفتح نافذة الدخول المرئية");
        const visible = getLoginWindow();
        const res = await runLoginSteps(visible, creds, { challengeWaitMs: 180000, interactive: true, tag: "login-visible" });
        hideLoginWindow();
        return res;
      }
      throw err;
    }
  })().finally(() => {
    loginPromise = null;
  });

  return loginPromise;
}

/** هل الجلسة لسه شغالة؟ لو اتحوّلت لصفحة الدخول بندخل تاني مرة واحدة */
async function ensureSession(win, creds) {
  const check = await run(win, S.SESSION_CHECK_SCRIPT);
  if (check !== "logged-out") return check;
  await safeLoad(win, SEARCH_URL);
  const after = await run(win, S.SESSION_CHECK_SCRIPT);
  if (after === "ok") return "ok";
  await loginIntoIsolatedWindow(win, creds);
  return "relogin";
}

/** يضمن إن النافذة على صفحة البحث (بيستخدم كاش عشان ما يدفعش تكلفة كل مرة) */
async function ensureSearchPage(win, credentials) {
  const state = await pageState(win);
  if (state && state.hasCode) {
    win.__rpReady = true;
    return "ready";
  }

  const url = String(state?.url || "");

  // على صفحة روشتة/مطالبة قديمة: رجوع سريع بدل تحميل كامل
  if (isPrescriptionUrl(url) && (await backToResults(win))) {
    win.__rpReady = true;
    return "back";
  }

  /**
   * أي صفحة تانية — **حتى لو على نايس دير** (لوحة تحكم، الصفحة الرئيسية،
   * صفحة دخول): بنفتح صفحة البحث مباشرة.
   *
   * ده كان بيوقف البرنامج: لو النافذة كانت على أي صفحة نايس دير من غير
   * `#SearchCode`، الشرط القديم كان بيتخطى تحميل صفحة البحث ويروح يعمل
   * **دخول من أول وجديد** — فالمستخدم يشوف متصفح مفتوح على الموقع ومفيش أي
   * خطوة بتتعمل. الصح: تحميل صفحة البحث، والدخول بس لو الصفحة مارضيتش تفتح.
   */
  if (url !== SEARCH_URL) {
    await safeLoad(win, SEARCH_URL);
    if (await run(win, S.waitForSelectorScript("#SearchCode", 15000))) {
      win.__rpReady = true;
      return "loaded";
    }
  }

  const how = await loginIntoIsolatedWindow(win, credentials);
  if (!(await run(win, S.waitForSelectorScript("#SearchCode", 15000)))) {
    throw new Error("صفحة البحث في نايس دير لم تظهر");
  }
  win.__rpReady = true;
  return how;
}

// ---------------------------------------------------------------------------
// البحث — نداء واحد لكل ساب
// ---------------------------------------------------------------------------

async function searchSub(win, { sab, payerId, payerName, timeoutMs }) {
  const timeout = Math.max(4000, Math.min(60000, Number(timeoutMs) || TIMEOUTS.search));
  // الساب بيتنضف قبل ما يتحقن في الصفحة — مدخل غير موثوق من الواجهة
  const cleanSab = SEC.sanitizeSab(sab);
  if (!cleanSab) throw new Error("رقم الساب غير صالح");
  const res = await runStrict(
    win,
    S.fastSearchScript({ sab: cleanSab, payerId, payerName, timeoutMs: timeout }),
  );

  if (!res) throw new Error("الصفحة لم ترد على البحث — أعد المحاولة");
  if (!res.ok) {
    const err = new Error(res.message || "فشل البحث في نايس دير");
    err.code = res.error || "SEARCH_FAILED";
    throw err;
  }

  // الباير مهم: لو القائمة موجودة والباير مش فيها، النتائج ممكن تكون لباير تاني
  if (res.payer && res.payer.ok === false && res.payer.reason === "no-option") {
    const names = (res.payer.options || []).map((o) => o.text).filter(Boolean).join(" / ");
    throw new Error(`الباير المطلوب غير موجود في القائمة. المتاح: ${names}`);
  }

  liveStep(`الساب ${cleanSab}: ${(res.forms || []).length} استمارة`, { ref: cleanSab });
  const forms = (res.forms || []).map((f, index) => ({
    ...f,
    index,
    refId: `${sab}::${f.source}::${f.reference || index}`,
    dateISO: parseDateToISO(f.date),
    monthly: isMonthlyText(f.type) || isMonthlyText(f.claimType) || isMonthlyText(f.rowText),
  }));

  win.__rpSab = sab;
  win.__rpRefs = forms.map((f) => f.reference);
  // عنوان النافذة الحقيقية = الساب اللي بتشتغل عليه دلوقتي
  labelWindow(win, `ساب ${cleanSab} — ${forms.length} استمارة`);

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

/**
 * سجل التقاط الصور: سطر واحد لكل محاولة، في logs/capture.log.
 * موجود عشان أي «الصورة مش ظاهرة» يبقى ليها سبب مكتوب مش تخمين.
 */
function capLog(ref, message) {
  const line = `[${new Date().toISOString()}] ${ref} :: ${message}\n`;
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    const file = path.join(logsDir(), "capture.log");
    try {
      const st = fs.statSync(file);
      if (st.size > 2 * 1024 * 1024) fs.writeFileSync(file, "");
    } catch {
      /* الملف مش موجود بعد */
    }
    fs.appendFileSync(file, line);
  } catch {
    /* السجل مش حرج */
  }
  liveStep(String(message).slice(0, 300), { ref });
}

/**
 * جلب صورة الروشتة من الشبكة بنفس كوكيز الجلسة.
 *
 * ليه؟ لأن صفحة الروشتة مش مضمون إنها فيها <img> نقدر نرسمها على canvas
 * (ممكن تكون viewer أو PDF أو الصورة بتتحمّل بـXHR). هنا بنجيب نفس الرابط
 * اللي اتفتح، ولو رجع HTML بنستخرج منه مصادر الصور ونحاول تاني.
 */
async function fetchSource(win, url, { referrer } = {}) {
  // ١) جوّه الصفحة: نفس الأصل ⇒ نفس الكوكيز والـreferer ومن غير CORS
  if (win && !win.isDestroyed()) {
    let sameOrigin = false;
    try {
      const here = new URL(wc(win).getURL());
      const there = new URL(url);
      sameOrigin = here.origin === there.origin;
    } catch {
      sameOrigin = false;
    }
    if (sameOrigin) {
      const inPage = await run(win, S.FETCH_IN_PAGE_SCRIPT(url));
      if (inPage && !inPage.failed) return { ...inPage, via: "page" };
      if (inPage && inPage.failed) capLog("net", `fetch جوه الصفحة فشل: ${inPage.reason}`);
    }
  }

  // ٢) طبقة الشبكة في **نفس جلسة النافذة** (مش جلسة الدخول المشتركة).
  // كل نافذة معزولة ليها كوكيز وسيرفر-سايد سشن مستقلين؛ الجلب بجلسة تانية
  // بيرجّع صفحة دخول بدل الصورة، وده كان بيخلي «الصورة مش بتظهر».
  try {
    const ses = (win && !win.isDestroyed() && wc(win)?.session) || session.fromPartition(ND_PARTITION);
    if (typeof ses.fetch !== "function") return null;
    const res = await ses.fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...(referrer ? { Referer: referrer } : {}),
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res || !res.ok) return null;
    const type = String(res.headers.get("content-type") || "").toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    if (RX.isDisplayableImageType(type)) {
      return {
        type,
        size: buf.length,
        dataUrl: `data:${type.split(";")[0].trim()};base64,${buf.toString("base64")}`,
        via: "session",
      };
    }
    if (RX.isPdfType(type)) return { type, size: buf.length, pdf: true, via: "session" };
    return { type, size: buf.length, text: buf.toString("utf8").slice(0, 400000), via: "session" };
  } catch {
    return null;
  }
}

/**
 * جلب صورة الروشتة من الشبكة بنفس جلسة نايس دير.
 *
 * لو الرابط رجّع صفحة HTML (زي صفحة `PrescriptionImgs`)، بنستخرج منها مصادر
 * الصور بـ`RX.extractImageUrls` ونجرّبها بالترتيب — لأن الصورة الحقيقية غالبًا
 * جوه `<img>` في الصفحة دي، مش الصفحة نفسها.
 */
async function fetchImageViaSession(win, url, { referrer, depth = 0 } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const got = await fetchSource(win, url, { referrer });
  if (!got) return null;

  if (got.dataUrl && RX.isDisplayableImageType(got.type)) {
    return {
      dataUrl: got.dataUrl,
      method: `${got.via}-fetch${depth ? "-nested" : ""}`,
      src: url,
      bytes: got.size,
    };
  }
  if (got.pdf) return { none: true, lookedLikePdf: true, src: url, candidates: [] };
  if (!got.text || depth > 0) return null;

  const candidates = RX.extractImageUrls(got.text, url);
  const inline = candidates.find((u) => u.startsWith("data:image/"));
  if (inline) return { dataUrl: inline, method: "html-inline", src: url };

  for (const candidate of candidates.filter((u) => !u.startsWith("data:")).slice(0, 5)) {
    const nested = await fetchImageViaSession(win, candidate, { referrer: url, depth: 1 });
    if (nested && nested.dataUrl) return nested;
  }
  return { none: true, candidates, lookedLikePdf: RX.looksLikePdfViewer(got.text), src: url };
}

/**
 * لقطة شاشة للنافذة — بترفض اللقطة البيضاء، ولو النافذة مخفية ومش بترسم
 * بتظهر برّه الشاشة وتلقط تاني (Chromium مابيرسمش دايماً لنافذة مخفية).
 */
async function captureScreenshot(win, { forceVisible = false } = {}) {
  if (!win || win.isDestroyed()) return null;

  const shoot = async () => {
    try {
      if (win.isDestroyed()) return null;
      ensurePaintable(win);
      // الصفحة جوه WebContentsView — اللقطة من المحتوى مش من شريط المتصفح
      const page = contentOf(win);
      if (!page) return null;
      const img = await page.capturePage();
      if (!img || img.isEmpty()) return null;

      // الفحص الحقيقي: بكسلات الصفحة نفسها (صفحة بيضاء = لقطة فاضية)
      let bitmapBlank = false;
      try {
        bitmapBlank = RX.isBlankBitmap(img.getBitmap());
      } catch {
        bitmapBlank = false;
      }

      const resized = img.getSize().width > 1600 ? img.resize({ width: 1600, quality: "best" }) : img;
      const jpg = resized.toJPEG(82);
      if (jpg && jpg.length && !bitmapBlank) {
        return { dataUrl: `data:image/jpeg;base64,${jpg.toString("base64")}`, method: "screenshot-jpeg" };
      }
      const png = resized.toPNG();
      if (!png || !png.length || RX.isLikelyBlankShot(png.length) || bitmapBlank) return null;
      return { dataUrl: `data:image/png;base64,${png.toString("base64")}`, method: "screenshot" };
    } catch {
      return null;
    }
  };

  const first = await shoot();
  if (first || !forceVisible) return first;

  // نافذة مخفية مابتعملش paint في بعض الحالات → نعرضها بعيد عن الشاشة وبنلقط
  let shown = false;
  let original = null;
  try {
    original = win.getBounds();
    win.setBounds({
      x: -4000,
      y: 0,
      width: Math.max(original.width || 1000, 1000),
      height: Math.max(original.height || 800, 800),
    });
    win.showInactive();
    shown = true;
    await sleep(500);
  } catch {
    /* لو مش قادر يعرضها، بنكمل باللقطة العادية */
  }
  try {
    return await shoot();
  } finally {
    if (shown) {
      try {
        if (original) win.setBounds(original);
        // النافذة بترجع للخلفية (مرئية من غير تركيز) مش بتتقفل تمامًا —
        // الإخفاء الكامل بيمنع الرسم في اللقطات اللي بعدها
        presentInBackground(win, 0);
      } catch {
        /* تجاهل */
      }
    }
  }
}

/**
 * التقاط صورة الروشتة بثلاث مراحل:
 *   ١) من الـDOM (img / canvas / iframe) — الطريقة الأساسية والأنضف.
 *   ٢) من الشبكة بنفس الكوكيز — بتنجح لما الصورة مش قابلة للرسم على canvas.
 *   ٣) لقطة شاشة (مع إظهار النافذة بعيد عن الشاشة لو مخفية).
 */
async function captureImageInWindow(win, { timeoutMs = TIMEOUTS.image, minSide = 180, allowVisible = true } = {}) {
  if (!win || win.isDestroyed()) return null;
  const started = Date.now();
  const diag = { stage: "dom", attempts: 0 };

  // مرحلة ١: الـDOM
  while (Date.now() - started < timeoutMs) {
    if (!win || win.isDestroyed()) break;
    const remaining = Math.max(1500, timeoutMs - (Date.now() - started));
    diag.attempts += 1;
    const res = await run(win, S.captureImageScript({ timeoutMs: remaining, minSide }));
    if (res && res.diag) diag.last = res.diag;
    if (res && res.dataUrl) return { ...res, diag };
    if (res && res.failed) {
      diag.reason = res.reason;
      if (res.reason === "protected" || res.reason === "pdf-embed") break;
      let loading = false;
      try {
        loading = wc(win).isLoadingMainFrame();
      } catch {
        loading = false;
      }
      if (!loading) break;
    }
    await sleep(60);
  }

  // نفس المحاولة بحد أدنى أصغر (روشتة صغيرة أو صورة مصغّرة)
  if (minSide > 80) {
    const relaxed = await run(win, S.captureImageScript({ timeoutMs: 2500, minSide: 80 }));
    if (relaxed && relaxed.dataUrl) return { ...relaxed, diag: { ...diag, relaxed: true } };
  }

  // مرحلة ٢: الشبكة
  diag.stage = "network";
  let pageUrl = "";
  try {
    pageUrl = wc(win).getURL() || "";
  } catch {
    pageUrl = "";
  }
  const net = await fetchImageViaSession(win, pageUrl);
  if (net && net.dataUrl) return { ...net, diag };
  if (net && net.candidates) diag.candidates = net.candidates.slice(0, 5);

  // مرحلة ٣: لقطة شاشة
  diag.stage = "screenshot";
  const shot = await captureScreenshot(win, { forceVisible: allowVisible });
  if (shot) return { ...shot, diag };

  return { failed: true, reason: diag.reason || "unknown", diag, pageUrl };
}

/**
 * يجهّز اعتراض نافذة الصورة اللي هتفتح من الضغط على الرقم المرجعي.
 * النافذة بتتخلق بواسطة Electron نفسها (allow + override) وبتتلقط فورًا،
 * فمفيش تكلفة إنشاء نافذة إضافية ولا انتظار ثابت.
 */
/**
 * هل الصفحة دي صفحة مطالبة/روشتة (مش صفحة البحث ومش صفحة دخول)؟
 * النقر على الرقم المرجعي في `#Table2` بينقل النافذة لـ`Claim/OpenClaim`،
 * وفي `#Table` بينادي `CreatePreApprovalEprescription(...)`. الاتنين بيفتحوا
 * على نفس السيرفر، فأي صفحة نايس دير غير البحث/الدخول بتتحسب صفحة روشتة.
 */
const isClaimPage = (url) => {
  const text = String(url || "");
  if (!/nicedeer\.net/i.test(text)) return false;
  if (/Beneficiary\/Search/i.test(text)) return false;
  if (/Account\/Login/i.test(text)) return false;
  return true;
};

/**
 * بنستنى الصفحة تفتح فعلًا — **مش ٦٠٠ مللي**.
 * ده كان سبب «البرنامج مش عارف يعرض صورة الروشتة»: الصفحة بتاخد ثانيتين
 * تحميل، فالمحاولة القديمة كانت بتخلص قبل ما التنقّل يحصل، والمستخدم يشوف
 * الروشتة قدامه والبرنامج يقول مفيش صورة.
 */
async function waitForClaimPage(win, { from = "", timeoutMs = 14000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!win || win.isDestroyed()) return null;
    let url = "";
    try {
      url = wc(win).getURL() || "";
    } catch {
      url = "";
    }
    if (url && url !== from && isClaimPage(url)) return url;
    await sleep(100);
  }
  return null;
}

function armPopupCapture(win, ref = "") {
  const urls = [];
  /** روابط الروشتة الحقيقية اللي اتلقطت من صفحة المستندات (ملف الصورة نفسه) */
  const docUrls = [];
  let settled = false;
  let resolveChild;
  const childPromise = new Promise((resolve) => {
    resolveChild = resolve;
  });
  const settle = (value) => {
    if (settled) return;
    settled = true;
    resolveChild(value);
  };

  // نافذة الروشتة بتتفتح من **محتوى** الصفحة (مش من شريط المتصفح)
  //
  // **جلسة النافذة المنبثقة لازم تكون جلسة النافذة اللي فتحتها** (`__rpPartition`).
  // قبل كده كانت بتتفتح على `ND_PARTITION` المشتركة: لو الدخول حصل في جلسة النافذة
  // المعزولة (وده اللي بيحصل بعد العزل)، النافذة المنبثقة بتطلع صفحة دخول —
  // يعني «مفيش صورة روشتة» من غير أي رسالة خطأ مفهومة.
  wc(win).setWindowOpenHandler(({ url }) => {
    urls.push(url);
    capLog(ref, `نافذة صورة مطلوبة: ${String(url).slice(0, 160)}`);
    const popupOptions = hiddenWindowOptions({ show: false });
    popupOptions.webPreferences.partition = win.__rpPartition || ND_PARTITION;
    return {
      action: "allow",
      overrideBrowserWindowOptions: popupOptions,
    };
  });

  const grab = async (target, label) => {
    if (!target || target.isDestroyed()) return null;
    try {
      const image = await captureImageInWindow(target, { timeoutMs: TIMEOUTS.image });
      const ok = Boolean(image && image.dataUrl);
      capLog(
        ref,
        `${label}: ${ok ? `نجح (${image.method}) ${Math.round((image.diag?.ms ?? 0))}ms` : `فشل (${image?.reason || image?.diag?.reason || "بلا سبب"})`}`,
      );
      return ok ? image : null;
    } catch (err) {
      capLog(ref, `${label}: استثناء ${String(err?.message || err).slice(0, 120)}`);
      return null;
    }
  };

  const onChild = (child) => {
    child.webContents.setUserAgent(UA);
    // جلسة النافذة دي = جلسة اللي فتحتها (عشان نتعرّف على نوافذنا وقت الالتقاط)
    child.__rpPartition = win.__rpPartition || ND_PARTITION;
    // النافذة دي هي «نافذة الروشتة» — عنوانها بيقول للمستخدم هي بتعمل إيه
    labelWindow(child, ref ? `روشتة ${ref.split("::").pop()}` : "روشتة");
    // الصورة لازم الصفحة تترسم: بنعرضها في الخلفية لحظة الالتقاط وبعدها بتتقفل
    presentInBackground(child, 0);
    void (async () => {
      let captured = false;
      try {
        const image = await grab(child, "نافذة منبثقة");
        if (image) {
          captured = true;
          settle(image);
        }
      } finally {
        /**
         * رابط الروشتة: بيتلقط من **نفس النافذة** بعد الصورة وقبل قفلها
         * (Manage Documents → أيقونة التنزيل → رابط الملف).
         * من غير الخطوة دي كان البرنامج بيعرض لقطة شاشة بس، والمستخدم عايز
         * يفتح الروشتة الحقيقية من اللينك في مرحلة القرار.
         */
        try {
          const docUrl = await extractPrescriptionUrl(child);
          if (docUrl) {
            docUrls.push(docUrl);
            capLog(ref, `رابط الروشتة: ${docUrl.slice(0, 140)}`);
          }
        } catch {
          /* الرابط مش حرج — اللقطة موجودة كاحتياطي */
        }
        // لو الصورة اتجابت: النافذة اتقفلت فورًا (الشغل مستمر).
        // لو ماجاتش: النافذة تفضل **ظاهرة** دقيقة كاملة عشان المستخدم يشوف
        // الروشتة بعينه ويعرف إن المشكلة في القراءة/اللقطة مش في فتح الروشتة.
        if (!child.isDestroyed()) {
          if (captured) {
            // الروشتة تفضل ظاهرة في نافذتها لحظتين — المستخدم لازم يشوفها
            // بعينه وهي بتتقرا، وبعدها النافذة بتتقفل والشغل بيكمل.
            setTimeout(() => {
              try {
                if (!child.isDestroyed()) child.destroy();
              } catch {
                /* تجاهل */
              }
            }, 2500);
          } else setTimeout(() => {
            try {
              if (!child.isDestroyed()) child.destroy();
            } catch {
              /* تجاهل */
            }
          }, 60000);
        }
      }
    })();
  };

  wc(win).on("did-create-window", onChild);

  return {
    urls,
    childPromise,
    settle,
    /** نافذة صورة مفتوحة من محاولة سابقة (أو من المستخدم) — بنلقطها بدل ما نفتح جديدة */
    async adoptExisting() {
      if (settled) return null;
      const self = win.id;
      const myPartition = win.__rpPartition || ND_PARTITION;
      const candidates = BrowserWindow.getAllWindows().filter((w) => {
        if (!w || w.isDestroyed() || w.id === self) return false;
        // **نفس جلسة الساب** بس — نافذة ساب تاني مش بتاعتنا
        if ((w.__rpPartition || ND_PARTITION) !== myPartition) return false;
        try {
          return isPrescriptionUrl(contentOf(w)?.getURL() || "");
        } catch {
          return false;
        }
      });
      if (!candidates.length) return null;
      capLog(ref, `لقيت ${candidates.length} نافذة صورة مفتوحة مسبقًا — بلقطها`);
      for (const candidate of candidates) {
        const image = await grab(candidate, "نافذة مفتوحة مسبقًا");
        try {
          if (!candidate.isDestroyed()) candidate.destroy();
        } catch {
          /* تجاهل */
        }
        if (image) {
          try {
            const docUrl = await extractPrescriptionUrl(candidate);
            if (docUrl) docUrls.push(docUrl);
          } catch {
            /* تجاهل */
          }
          settle(image);
          return image;
        }
      }
      return null;
    },
    /** رابط الروشتة اللي اتلقط (أول واحد) */
    docUrl() {
      return docUrls[0] || null;
    },
    docUrls,
    dispose() {
      wc(win).off("did-create-window", onChild);
      if (!win.isDestroyed()) wc(win).setWindowOpenHandler(DEFAULT_POPUP_HANDLER);
    },
  };
}

/**
 * رابط الروشتة الحقيقي (ملف الصورة نفسه) من صفحة الروشتة.
 *
 * ترتيب الموقع نفسه (اللي المستخدم بيشرحه):
 *   الضغط على الرقم المرجعي → نافذة `PrescriptionImgs` فيها صورة الروشتة
 *   → زر **Manage Documents** → أيقونة التنزيل (`i.Ndcolor.fa.fa-download`)
 *   → تفتح تاب جديدة فيها رابط الملف:
 *   `https://storage.googleapis.com/nicedeer/Eprescreption/...jpg`
 *
 * الرابط ده هو اللي بيتحفظ ويتعرض في مرحلة القرار (المستخدم يضغط عليه يفتح
 * الروشتة ٣ ثواني وتتقفل). اللقطة الشاشية بقت احتياطي مش الأساس.
 *
 * الالتقاط من ٣ مسارات حقيقية، لأن زر التنزيل ممكن يفتح تاب أو ينزّل الملف:
 *   ١) نافذة/تاب جديد (`setWindowOpenHandler`).
 *   ٢) تنقّل في نفس الصفحة (`will-navigate` / `will-redirect`).
 *   ٣) تنزيل فعلي (`will-download`) — بنقرا رابطه وبنلغي التنزيل نفسه.
 */
async function extractPrescriptionUrl(win, { timeoutMs = 9000 } = {}) {
  const page = contentOf(win);
  if (!page || page.isDestroyed()) return null;
  const found = [];
  const take = (value) => {
    const abs = String(value || "").trim();
    if (!abs || found.includes(abs)) return;
    if (!/^https?:\/\//i.test(abs)) return;
    if (/storage\.googleapis\.com/i.test(abs) || /Eprescreption/i.test(abs) || /\.(jpe?g|png|webp|gif|pdf)(\?|$)/i.test(abs)) {
      found.push(abs);
    }
  };

  const previousHandler = page.__rpDocHandler || null;
  page.setWindowOpenHandler(({ url }) => {
    take(url);
    return { action: "deny" };
  });
  const onNav = (_event, url) => take(url);
  page.on("will-navigate", onNav);
  page.on("will-redirect", onNav);
  const ses = page.session;
  const onDownload = (_event, item) => {
    try {
      take(item.getURL());
    } catch {
      /* تجاهل */
    }
    try {
      item.cancel();
    } catch {
      /* تجاهل */
    }
  };
  ses.on("will-download", onDownload);

  try {
    // ١) الرابط ممكن يكون ظاهر أصلًا في الصفحة (لينك أو صورة)
    const direct = await run(win, S.DOC_LINK_SCRIPT);
    if (direct) take(direct);

    if (!found.length) {
      // ٢) Manage Documents
      const managed = await run(win, S.CLICK_MANAGE_DOCS_SCRIPT);
      if (managed === "clicked") capLog("docs", "Manage Documents: اتضغط");
      // نستنى ظهور المستندات (الشبكة بترجع الصفوف)
      const started = Date.now();
      while (!found.length && Date.now() - started < 4000) await sleep(120);
    }

    if (!found.length) {
      // ٣) أيقونة التنزيل
      const clicked = await run(win, S.CLICK_DOWNLOAD_DOC_SCRIPT);
      if (clicked && clicked !== "clicked" && clicked !== "not-found") take(clicked);
      if (clicked === "not-found") capLog("docs", "أيقونة التنزيل مش موجودة في الصفحة");
      const started = Date.now();
      while (!found.length && Date.now() - started < timeoutMs) await sleep(120);
    }
  } catch (err) {
    capLog("docs", `استخراج رابط الروشتة: ${String(err?.message || err).slice(0, 120)}`);
  } finally {
    try {
      page.off("will-navigate", onNav);
      page.off("will-redirect", onNav);
    } catch {
      /* تجاهل */
    }
    try {
      ses.off("will-download", onDownload);
    } catch {
      /* تجاهل */
    }
    if (!page.isDestroyed()) page.setWindowOpenHandler(previousHandler || DEFAULT_POPUP_HANDLER);
  }

  return found[0] || null;
}

/**
 * يفتح رابط صورة الروشتة في نافذة التقاط **بنفس جلسة النافذة اللي طلبتها**.
 *
 * ليه الجلسة مهمة؟ لأن رابط `PrescriptionImgs` بيشتغل بجلسة السيرفر بتاعت
 * النافذة اللي فتحته. أي نافذة تانية (أو جلسة تانية) بترجع صفحة دخول —
 * وده بالظبط سبب «البرنامج مش عارف يعرض صورة الروشتة».
 *
 * الترتيب: جلب مباشر بنفس الجلسة (أسرع) → نافذة حقيقية بنفس الـpartition →
 * جلب من الشبكة عبر نفس الجلسة.
 */
async function captureFromUrl(url, referrer, ref = "", sourceWin = null) {
  const partition = (sourceWin && sourceWin.__rpPartition) || null;

  // ١) جلب مباشر بنفس جلسة النافذة — من غير فتح أي نافذة
  if (sourceWin && !sourceWin.isDestroyed()) {
    const direct = await fetchImageViaSession(sourceWin, url, { referrer });
    if (direct && direct.dataUrl) {
      capLog(ref, `جلب بنفس جلسة النافذة: نجح (${direct.method})`);
      return direct;
    }
  }

  // ٢) نافذة التقاط حقيقية بنفس الـpartition (كوكيز الساب نفسه)
  if (partition) {
    const win = createBrowserWindow({
      partition,
      title: ref ? `روشتة ${ref}` : "روشتة",
      index: 1,
    });
    try {
      win.__rpPartition = partition;
      presentInBackground(win, 1);
      setResourceMode(win, "images");
      const loaded = await safeLoad(win, url, TIMEOUTS.pageLoad, referrer);
      if (loaded !== "error") {
        const shot = await captureImageInWindow(win, { timeoutMs: TIMEOUTS.image });
        if (shot && shot.dataUrl) {
          capLog(ref, `نافذة التقاط بنفس الجلسة: نجح (${shot.method})`);
          return shot;
        }
      }
      const net = await fetchImageViaSession(win, url, { referrer });
      if (net && net.dataUrl) {
        capLog(ref, `شبكة بنفس الجلسة: نجح (${net.method})`);
        return net;
      }
      capLog(ref, "نافذة التقاط بنفس الجلسة: فشل (مفيش صورة مقروءة)");
    } finally {
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch {
        /* تجاهل */
      }
    }
    return null;
  }

  // ٣) من غير نافذة مصدر: نافذة التقاط من الحوض (لما الجلسة مش معروفة)
  return captures.with(async (win) => {
    let shot = null;
    const loaded = await safeLoad(win, url, TIMEOUTS.pageLoad, referrer);
    if (loaded !== "error") {
      shot = await captureImageInWindow(win, { timeoutMs: TIMEOUTS.image });
      if (shot && shot.dataUrl) {
        capLog(ref, `نافذة التقاط مباشرة: نجح (${shot.method})`);
        return shot;
      }
    }
    const net = await fetchImageViaSession(win, url, { referrer });
    if (net && net.dataUrl) {
      capLog(ref, `جلب مباشر من الشبكة: نجح (${net.method})`);
      return net;
    }
    capLog(ref, `جلب مباشر: فشل (${shot?.reason || net?.reason || "مفيش مصدر"})`);
    return null;
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
  wc(win).on("will-navigate", onWillNavigate);

  // صفحة الروشتة محتاجة صور — نسمح بيها في النافذة دي بس
  setResourceMode(win, "images");
  const ref = `${sab}::${reference}`;
  labelWindow(win, `ساب ${sab} — صورة ${reference}`);
  const popup = armPopupCapture(win, ref);
  const tried = [];
  /**
   * هل إحنا اللي فتحنا الروشتة عشان ناخد الصورة؟
   * الإرجاع (#btn-DeleteClaim) مسموح **بس** في الحالة دي: إحنا اللي فتحنا
   * الاستمارة في الصرف، فإحنا اللي بنرجعها. لو الصورة جت من نافذة مفتوحة
   * أصلًا أو من غير ما نفتح الروشتة، مفيش حذف خالص.
   */
  let openedByUs = false;
  try {
    // نافذة صورة مفتوحة من محاولة سابقة/من المستخدم: بنلقطها بدل ما نضغط تاني
    let image = await popup.adoptExisting();

    if (!image) {
      const clicked = await runStrict(win, S.clickReferenceScript(reference));
      if (!clicked) {
        return { ok: false, error: `الرقم المرجعي ${reference} غير موجود في الصفحة`, timings };
      }
      openedByUs = true;
      let resultsUrl = "";
      try {
        resultsUrl = wc(win).getURL() || "";
      } catch {
        resultsUrl = "";
      }
      capLog(ref, `تم الضغط على الرقم المرجعي (${clicked})`);
      timings.clickMs = Date.now() - t0 - (timings.searchMs || 0);

      // مساران بالتوازي: نافذة الصورة المنبثقة، أو تنقّل الصفحة نفسها
      const mainPromise = (async () => {
        const nav = await waitForClaimPage(win, { from: resultsUrl, timeoutMs: 14000 });
        if (!nav || win.isDestroyed()) return null;
        capLog(ref, `الصفحة اتفتحت: ${String(nav).slice(0, 120)}`);
        await waitForLoad(win, 15000);
        return captureImageInWindow(win, { timeoutMs: 12000 });
      })();

      // مسار تالت: الروشتة بتفتح **جوه نفس الصفحة** (مودال/أوفرلاي) — من غيره
      // كان بيحصل «النافذة فتحت ومفيش صورة» لأن مفيش تنقّل ولا نافذة منبثقة.
      const inlinePromise = (async () => {
        await sleep(250);
        if (win.isDestroyed()) return null;
        // أي صفحة نايس دير غير البحث = صفحة روشتة/مطالبة (مش بس PrescriptionImgs)
        if (!isClaimPage(wc(win).getURL())) return null;
        const res = await run(win, S.captureNewImageScript({ timeoutMs: 9000 }));
        if (res && res.srcUrl) {
          capLog(ref, "صورة روشتة ظهرت جوه الصفحة — بجيبها من الشبكة بنفس الجلسة");
          const net = await fetchImageViaSession(win, res.srcUrl, { referrer: SEARCH_URL });
          if (net && net.dataUrl) return { ...net, method: `${net.method}-inline` };
          return null;
        }
        if (res && res.dataUrl) {
          capLog(ref, `صورة روشتة جوه الصفحة (${res.method || "inline"})`);
          return res;
        }
        return null;
      })();

      image = await firstSuccess([popup.childPromise, mainPromise, inlinePromise], TIMEOUTS.image + 12000);
      if (image) capLog(ref, `الصورة اتجابت من نافذة/تنقّل (${image.method || "؟"})`);
    }

    // شبكة: نفس الجلسة والكوكيز — بتنجح لما الصفحة نفسها مش قابلة للرسم
    // صورة مصدرها صفحة البحث أو صفحة الدخول = مش روشتة (لوجو/أيقونة) — تترفض
    if (
      image &&
      image.dataUrl &&
      image.src &&
      /^https?:/i.test(image.src) &&
      /Beneficiary\/Search|Account\/Login/i.test(String(image.src))
    ) {
      capLog(ref, `صورة مرفوضة: مصدرها صفحة مش روشتة (${String(image.src).slice(0, 120)})`);
      image = null;
    }
    if (!image || !image.dataUrl) {
      const candidates = [];
      if (navigatedTo) candidates.push(navigatedTo);
      for (const url of popup.urls) candidates.push(url);
      try {
        const current = wc(win).getURL();
        if (current) candidates.push(current);
      } catch {
        /* تجاهل */
      }
      for (const url of candidates.slice(0, 4)) {
        if (!/^https?:\/\//i.test(url)) continue;
        // أي رابط مش صفحة روشتة مابنجيبش منه — البحث فيه صور مش روشتات
        if (!isPrescriptionUrl(url)) continue;
        if (tried.includes(url)) continue;
        tried.push(url);
        const net = await fetchImageViaSession(win, url, { referrer: SEARCH_URL });
        if (net && net.dataUrl) {
          image = net;
          notes.push("جلب الصورة من الشبكة");
          capLog(ref, `شبكة: نجح (${net.method})`);
          break;
        }
        capLog(ref, `شبكة: فشل ${String(url).slice(0, 120)}`);
      }
    }

    // خطة أخيرة: رابط صورة داخل الصفحة نفسها
    if (!image && !win.isDestroyed()) {
      const link = await run(win, S.FIND_IMAGE_LINK_SCRIPT);
      if (link && link !== "click") {
        const abs = link.startsWith("http") ? link : `${BASE}${link}`;
        image = await captureFromUrl(abs, wc(win).getURL(), ref, win);
        if (image) notes.push("التقاط من رابط صورة الروشتة");
      }
    }

    timings.captureMs = Date.now() - t0 - (timings.searchMs || 0) - (timings.clickMs || 0);

    if (!image || !image.dataUrl) {
      const reason = image?.reason || image?.diag?.reason || "no-image";
      capLog(ref, `فشل نهائي (${reason}) — ${tried.length} رابط شبكة اتجرب`);
      // دليل حقيقي: الصفحة اللي كانت مفتوحة + صورتها وقت الفشل (من غير أي بيانات دخول)
      const evidence = await saveWindowEvidence(win, `image-${SEC.sanitizeSab(sab) || "sab"}-${reference}`);
      const files = evidence ? ` — الدليل: ${Object.values(evidence).join(" | ")}` : "";
      let openUrl = "";
      try {
        openUrl = wc(win).getURL() || "";
      } catch {
        openUrl = "";
      }
      capLog(
        ref,
        `الصفحة وقت الفشل: ${String(openUrl).slice(0, 140)} · نوافذ: ${popup.urls.length} · تفاصيل: ${JSON.stringify(image?.diag || {}).slice(0, 200)}`,
      );
      return {
        ok: false,
        error: `${
          reason === "protected"
            ? "صورة الروشتة محمية من العرض — جرّب «الموقع في المتصفح» وافتح الروشتة يدويًا"
            : popup.urls.length
              ? "نافذة الروشتة اتفتحت لكن مفيش صورة مقروءة فيها"
              : "مفيش صورة روشتة ظهرت بعد الضغط على الرقم المرجعي"
        }${files}`,
        reason,
        timings,
        popupUrls: popup.urls,
        files: evidence,
      };
    }

    // الإرجاع في الخلفية — مش بيوقف جلب الصورة اللي بعده
    let deleteState = "skipped";
    let deleteQueue = 0;
    if (!openedByUs) {
      // مفتحناش الروشتة في إحنا في مسار الصرف → مفيش إرجاع
      deleteState = "skipped-no-open";
      notes.push("الإرجاع اتخطى: الصورة ماجاتش من فتح الروشتة");
      capLog(ref, "مفيش إرجاع — الصورة ماجاتش من فتح الروشتة");
    } else if (preventDelete) {
      deleteState = "skipped-user";
      notes.push("الإرجاع متوقف من الإعدادات");
    } else {
      /**
       * روابط الإرجاع: لازم تكون روابط صفحات حقيقية (http أو /path).
       * أزرار Pre-Approval في `#Table` بتفتح `javascript:CreatePreApprovalEprescription(...)`
       * — الرابط ده مش صفحة، فلو دخلناه في الطابور كان الإرجاع بيروح لصفحة
       * مش موجودة ويتسجّل «مش موجود» والاستمارة تفضل مفتوحة في الصرف.
       */
      const candidates = [];
      const pushUrl = (value) => {
        const raw = String(value || "").trim();
        if (!raw || /^javascript:/i.test(raw) || raw === "#") return;
        const abs = /^https?:/i.test(raw) ? raw : raw.startsWith("/") ? `${BASE}${raw}` : "";
        if (abs && !candidates.includes(abs)) candidates.push(abs);
      };
      if (href) pushUrl(href);
      for (const url of popup.urls) pushUrl(url);

      if (candidates.length) {
        deleteQueue = enqueueDelete({ key: `${sab}::${reference}`, sab, reference, candidates });
        deleteState = "background";
      } else {
        const click = await run(win, S.CLICK_DELETE_SCRIPT);
        deleteState = click === "clicked" ? "done" : "not-found";
      }
    }

    /**
     * رابط الروشتة النهائي اللي بيتعرض في مرحلة القرار.
     * لو النافذة المنبثقة ماجاتش (الروشتة اتفتحت في نفس الصفحة/مودال)، بنعمل
     * نفس خطوات المستخدم: Manage Documents → التنزيل → نلقط رابط الملف.
     */
    let rxUrl = popup.docUrl();
    if (!rxUrl) {
      try {
        if (isPrescriptionUrl(wc(win).getURL())) {
          rxUrl = await extractPrescriptionUrl(win, { timeoutMs: 6000 });
          if (rxUrl) capLog(ref, `رابط الروشتة (نفس الصفحة): ${rxUrl.slice(0, 140)}`);
        }
      } catch {
        /* الرابط مش حرج */
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
      /** رابط ملف الروشتة الحقيقي — بيتحفظ ويتعرض في شاشة القرار */
      rxUrl: rxUrl || "",
      method: image.method || "unknown",
      width: image.width,
      height: image.height,
      deleted: deleteState === "done",
      deleteState,
      deleteQueue,
      reusedSearch: Boolean(prepared.reused),
      timings,
      notes,
    };
  } finally {
    popup.dispose();
    if (!win.isDestroyed()) {
      wc(win).off("will-navigate", onWillNavigate);
      // رجوع لوضع توفير الموارد بعد ما خلصنا الروشتة
      setResourceMode(win, "search");
    }
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

// الجهاز ما ينامش أثناء الجلسة (500 استمارة × دقائق = الشاشة بتقفل والجلسة بتقطع)
let powerBlocker = 0;

function setBusy(active) {
  try {
    if (active && !powerSaveBlocker.isStarted(powerBlocker)) {
      powerBlocker = powerSaveBlocker.start("prevent-display-sleep");
    } else if (!active && powerSaveBlocker.isStarted(powerBlocker)) {
      powerSaveBlocker.stop(powerBlocker);
      powerBlocker = 0;
    }
  } catch {
    /* تجاهل */
  }
  return Boolean(powerBlocker);
}

function systemInfo() {
  const totalMb = Math.round(os.totalmem() / 1024 ** 2);
  const freeMb = Math.round(os.freemem() / 1024 ** 2);
  return {
    maxWorkers: MAX_WORKERS,
    maxDeleters: MAX_DELETERS,
    cores: os.cpus()?.length || 0,
    totalMb,
    freeMb,
    workers: workers.max,
    captures: captures.max,
    platform: process.platform,
    electron: process.versions.electron,
  };
}

ipcMain.handle("nd:set-credentials", async (_e, payload) => {
  credentials = {
    username: String(payload?.username || "").slice(0, 200),
    password: String(payload?.password || "").slice(0, 400),
  };
  if (payload?.maxWorkers) workers.max = Math.max(1, Math.min(MAX_WORKERS, Number(payload.maxWorkers) || 5));
  return { ok: true };
});

ipcMain.handle("nd:set-workers", async (_e, payload) => {
  const n = Math.max(1, Math.min(MAX_WORKERS, Number(payload?.maxWorkers) || 5));
  workers.max = n;
  // نوافذ التصوير بتتوسّع مع نوافذ البحث عشان مفيش نافذة تقف مستنية
  captures.max = Math.max(1, Math.min(n, MAX_WORKERS, 8));
  return { ok: true, maxWorkers: n, captures: captures.max, info: systemInfo() };
});

/**
 * الضبط التلقائي: المحرك بيحسب الرقم من القياس الحقيقي، وهنا بنطبّقه.
 * لو الذاكرة الحرة قربت تخلص بنرفض الزيادة (بدل ما الجهاز يهنّج).
 */
ipcMain.handle("nd:tune", async (_e, payload) => {
  const freeMb = os.freemem() / 1024 ** 2;
  const asked = Number(payload?.workers) || workers.max;
  const wanted = Math.max(
    1,
    Math.min(MAX_WORKERS, freeMb < 900 ? Math.min(asked, workers.max) : asked),
  );
  if (wanted !== workers.max) {
    workers.max = wanted;
    captures.max = Math.max(1, Math.min(wanted, MAX_WORKERS, 8));
    // تقليل فعلي للنوافذ الفاضية عشان الرام تتحرر فورًا
    if (wanted < workers.size) workers.prune();
  }
  return { ok: true, workers: workers.max, captures: captures.max, rejected: wanted !== asked, freeMb: Math.round(freeMb) };
});

// حظر نوم الجهاز أثناء الجلسة
ipcMain.handle("nd:busy", async (_e, payload) => ({ ok: true, active: setBusy(Boolean(payload?.active)) }));

ipcMain.handle("nd:warmup", async (_e, payload) => {
  const count = Math.max(1, Math.min(MAX_WORKERS, Number(payload?.workers) || workers.max));
  workers.max = count;
  captures.max = Math.max(1, Math.min(count, MAX_WORKERS, 8));
  const started = Date.now();
  setBusy(true);
  // التسخين بالتوازي مع تباعد ١٢٠ مللي بين كل نافذة:
  // قبل كده كان حلقة `await` متسلسلة — ٨ نوافذ كانت بتاخد وقت مجموع الخطوات
  // بدل أقصى خطوة. التباعد لسه موجود عشان ما نعملش قفزة في الرام مرة واحدة.
  const results = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      if (i > 0) await sleep(i * 120);
      try {
        const win = await workers.acquire(60000);
        try {
          const t0 = Date.now();
          const state = await pageState(win);
          if (!state || !state.hasCode) {
            await ensureSearchPage(win, credentials);
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
  if (payload?.username) {
    credentials = {
      username: String(payload.username).slice(0, 200),
      password: String(payload.password || "").slice(0, 400),
    };
  }
  const started = Date.now();
  const reply = (data) => ({
    trace: LG.summarizeTrace(loginTrace, 30),
    ms: Date.now() - started,
    ...data,
  });

  try {
    // أسرع طريق: الجلسة شغالة أصلًا (بنفحص في نافذة الدخول نفسها — نفس الجلسة)
    const win = getLoginWindow();
    await safeLoad(win, SEARCH_URL, TIMEOUTS.login);
    const ready = await pageState(win);
    if (ready && ready.hasCode) {
      setBusy(true);
      traceStep("الجلسة شغالة أصلًا — صفحة البحث فتحت");
      return reply({ ok: true, already: true, verified: true });
    }

    // الدخول بيتم في نافذة **مرئية**: Cloudflare والتحقق البشري مش بيشتغلوا في نافذة مخفية
    traceStep("بدء الدخول من النافذة المرئية");
    await openLoginWindow(LOGIN_URL);
    const res = await runLoginSteps(win, credentials, { challengeWaitMs: 240000, interactive: true, tag: "login-test" });

    const verified = await verifySessionBySearchPage(win);
    if (!verified) {
      const last = await probeLogin(win);
      const files = await dumpLoginDiagnostics(win, "login-unverified");
      return reply({
        ok: false,
        verified: false,
        state: last ? last.state : "unknown",
        files,
        error: [
          "الدخول اتقبل لكن صفحة البحث مش بتفتح.",
          last ? `آخر قراءة: ${LG.describeProbe(last)}` : "",
          "راجع صلاحية الحساب على نايس دير (لازم يكون مفعّل عليه صرف الصيدلية).",
          files.html || files.image ? `ملفات التشخيص: ${[files.html, files.image].filter(Boolean).join(" · ")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }

    setBusy(true);
    traceStep("الدخول نجح ✓");
    // النافذة بتتقفل بعد النجاح (الجلسة محفوظة في الـ partition)
    hideLoginWindow();
    return reply({ ok: true, already: Boolean(res && res.already), verified: true });
  } catch (err) {
    const files = null;
    return reply({
      ok: false,
      verified: false,
      code: err instanceof LoginError ? err.code : "error",
      state: err instanceof LoginError ? err.code : "error",
      files,
      error: String(err?.message || err),
    });
  }
});

/** فتح نافذة نايس دير المرئية (تسجيل يدوي / عدّي التحقق) — نفس الجلسة */
ipcMain.handle("nd:open-login-window", async (_e, payload) => {
  try {
    const win = await openLoginWindow(payload?.url === "search" ? SEARCH_URL : LOGIN_URL);
    const state = await pageState(win);
    return { ok: true, data: { url: wc(win).getURL(), hasCode: Boolean(state && state.hasCode) } };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

/** وضع النوافذ: خلفية مرئية (الافتراضي) أو مخفية تمامًا */
ipcMain.handle("nd:set-window-mode", async (_e, payload) => {
  backgroundWindows = payload?.background !== false;
  try {
    loginWin?.setSkipTaskbar?.(!backgroundWindows);
  } catch {
    /* تجاهل */
  }
  for (const [index, win] of workers.windows.entries()) {
    if (!win || win.isDestroyed()) continue;
    if (backgroundWindows) presentInBackground(win, index);
    else win.hide();
  }
  return { ok: true, data: { background: backgroundWindows } };
});

/** آخر خطوات محاولة الدخول — للتشخيص */
ipcMain.handle("nd:login-trace", async () => ({ ok: true, data: { trace: LG.summarizeTrace(loginTrace, 40) } }));

/**
 * رسائل الموقع (alert/confirm/prompt) اللي اتمنعت من إنها تجمّد النافذة:
 * بتتسجل هنا وكمان بتظهر في الواجهة — غالبًا فيها سبب رفض الموقع نفسه.
 */
ipcMain.on("nd:page-dialog", (_e, payload) => {
  const kind = String(payload?.kind || "dialog").slice(0, 20);
  const message = String(payload?.message || "").slice(0, 400);
  const answer = payload?.answer == null || payload.answer === "" ? "" : ` → ${String(payload.answer).slice(0, 40)}`;
  const text = `الموقع قال (${kind}): ${message || "بدون نص"}${answer}`;
  appendLog("info", text);
  capLog("page-dialog", text);
});

/**
 * «شوف النوافذ» — بيطلّع نوافذ الأتمتة فوق كل حاجة في الشاشة عشان المستخدم
 * يشوف المتصفح بيعمل الخطوات بنفسه. بيقفل الوضع ده وبيرجّعها للخلفية.
 */
ipcMain.handle("nd:watch-windows", async (_e, payload) => {
  const on = payload?.on !== false;
  let count = 0;
  for (const [index, win] of workers.windows.entries()) {
    if (!win || win.isDestroyed()) continue;
    try {
      if (on) {
        win.setSkipTaskbar(false);
        win.setBounds(backgroundBounds(index));
        win.setAlwaysOnTop(true, "normal");
        win.showInactive();
      } else {
        win.setAlwaysOnTop(false);
        win.setSkipTaskbar(true);
        presentInBackground(win, index);
      }
      count += 1;
    } catch {
      /* تجاهل النافذة اللي اتحرّكت */
    }
  }
  liveStep(on ? `وضع المتابعة: ${count} نافذة ظاهرة قدامك` : `رجّعت ${count} نافذة للخلفية`);
  return { ok: true, data: { on, windows: count } };
});

/**
 * شريط المتصفح جوه كل نافذة: رجوع/تقدم/تحديث/تثبيت فوق.
 * الأوامر دي بتتنفذ على **محتوى الصفحة الحقيقي** (الـWebContentsView) مش على
 * النافذة نفسها، فالمستخدم بيشوف نفس اللي المتصفح بيعمله بالظبط.
 */
function chromeWindowOf(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !win.__rpView) return null;
  return win;
}

ipcMain.on("nd:chrome-ready", (event) => {
  const win = chromeWindowOf(event);
  if (!win) return;
  pushChromeState(win);
  layoutContent(win);
});

ipcMain.on("nd:chrome-action", (event, payload) => {
  const win = chromeWindowOf(event);
  if (!win) return;
  const page = contentOf(win);
  if (!page) return;
  const action = String(payload?.action || "");
  try {
    if (action === "back") {
      const nh = page.navigationHistory;
      if (nh && typeof nh.canGoBack === "function" ? nh.canGoBack() : page.canGoBack?.()) {
        if (nh && typeof nh.goBack === "function") nh.goBack();
        else page.goBack();
      }
    } else if (action === "forward") {
      const nh = page.navigationHistory;
      if (nh && typeof nh.canGoForward === "function" ? nh.canGoForward() : page.canGoForward?.()) {
        if (nh && typeof nh.goForward === "function") nh.goForward();
        else page.goForward();
      }
    } else if (action === "reload") {
      page.reload();
    } else if (action === "watch") {
      // تثبيت النافذة فوق كل البرامج — نفس معنى «المتابعة» في نافذة واحدة
      win.setAlwaysOnTop(!win.isAlwaysOnTop(), "normal");
      if (win.isAlwaysOnTop()) win.showInactive();
    }
    pushChromeState(win);
    setTimeout(() => pushChromeState(win), 250);
  } catch (err) {
    appendLog("warn", `شريط المتصفح: ${action} فشل — ${err?.message || err}`);
  }
});

// ---------------------------------------------------------------------------
// ٩٦) التحديث من GitHub Releases: فحص + تنزيل + تشغيل المثبّت
// ---------------------------------------------------------------------------

const UPDATE_REPO = "moazeliangama-jpg/rosheta-pro";
let updateState = { checkedAt: 0, info: null, downloading: 0, file: "" };

async function fetchLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "RoshettaPro-Updater" },
    // من غير timeout، الشبكة البطيئة بتخلّي الزرار «بيفحص» للأبد
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new Error("مفيش إصدارات منشورة على GitHub لسه — ارفع أول Release.");
  if (!res.ok) throw new Error(`GitHub ردّ بـ ${res.status}`);
  return res.json();
}

/** مجلد التحديث الوحيد المسموح — أي مسار براه مرفوض */
const updateDir = () => path.join(app.getPath("temp"), "roshetta-update");

/** حراسة المسار والرابط في updates.cjs (متاختبرة) */
const isInsideUpdateDir = (file) => UPD.isInsideDir(file, updateDir());
const hostAllowedForUpdate = (url) => UPD.isAllowedUpdateUrl(url);
const MAX_UPDATE_BYTES = UPD.MAX_UPDATE_BYTES;

ipcMain.handle("app:check-update", async () => {
  try {
    const release = await fetchLatestRelease();
    const latest = String(release?.tag_name || release?.name || "").replace(/^v/i, "");
    const asset = UPD.pickInstallerAsset(release?.assets || []);
    const info = UPD.describeUpdate({ current: app.getVersion(), latest, asset });
    updateState = { ...updateState, checkedAt: Date.now(), info };
    appendLog("info", `update: ${info.message}`);
    return {
      ok: true,
      data: { ...info, current: app.getVersion(), htmlUrl: release?.html_url || "" },
    };
  } catch (err) {
    const message = String(err?.message || err);
    appendLog("warn", `update check failed: ${message}`);
    return { ok: false, error: message };
  }
});

ipcMain.handle("app:download-update", async (_e, payload) => {
  try {
    // الرابط لازم يكون https + من مضيفات GitHub نفسها (مش أي رابط آمن شكله)
    if (!SEC.isSafeExternalUrl(payload?.url) || !hostAllowedForUpdate(payload.url)) {
      return { ok: false, error: "رابط التحديث غير مسموح" };
    }
    const name = String(payload?.asset || "RoshettaPro-Setup.exe").replace(/[^\w.\-]/g, "_");
    const dir = updateDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    const res = await fetch(payload.url, {
      headers: { "User-Agent": "RoshettaPro-Updater" },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!res.ok) throw new Error(`فشل تنزيل التحديث (${res.status})`);
    // سقف حجم: ملف ضخم/مضلّل مايملاش القرص ولا يعلّق الذاكرة
    const declared = Number(res.headers?.get?.("content-length") || 0);
    if (declared > MAX_UPDATE_BYTES) throw new Error("حجم التحديث أكبر من المسموح");
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_UPDATE_BYTES) throw new Error("حجم التحديث أكبر من المسموح");
    fs.writeFileSync(file, buffer);
    updateState = { ...updateState, downloading: 0, file };
    appendLog("ok", `update downloaded: ${file} (${Math.round(buffer.length / 1024 / 1024)} ميجا)`);
    return { ok: true, data: { file, bytes: buffer.length } };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

/** تشغيل المثبّت اللي اتنزّل — NSIS بيقبل /S للتثبيت الصامت */
ipcMain.handle("app:run-update", async (_e, payload) => {
  try {
    const requested = String(payload?.file || updateState.file || "");
    // أي مسار برّه مجلد التحديث (أو مش exe) مرفوض — حتى لو الواجهة اتبعتت لها قيمة غريبة
    if (!isInsideUpdateDir(requested)) return { ok: false, error: "مسار التحديث غير مسموح" };
    if (updateState.file && path.resolve(requested) !== path.resolve(updateState.file)) {
      return { ok: false, error: "الملف مش هو اللي اتنزّل من الإصدار" };
    }
    if (!fs.existsSync(requested)) return { ok: false, error: "ملف التحديث مش موجود" };
    const file = requested;
    const child = spawn(file, ["/S"], { detached: true, stdio: "ignore" });
    child.unref();
    appendLog("ok", `installer started: ${file}`);
    // بنقفل البرنامج عشان المثبّت يقدر يستبدل الملفات
    setTimeout(() => app.quit(), 1500);
    return { ok: true, data: { file } };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("app:preflight", async () => {
  try {
    return { ok: true, data: await preflight() };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

/**
 * ٦٠) نسخة احتياطية يومية: الريندرر بيبعت الحالة كـ JSON، والملف بيتحفظ في
 * مجلد بيانات البرنامج (مش مجلد التثبيت — عشان مثبّت لكل المستخدمين ما يمنعش الكتابة).
 */
ipcMain.handle("app:save-credentials", async (_e, payload) => saveCredentialsSecure(payload || {}));

ipcMain.handle("app:load-credentials", async () => {
  const res = loadCredentialsSecure();
  // بنحطها في الذاكرة كمان عشان الجلسة تشتغل من غير ما تتبعت تاني
  if (res.ok && res.data) credentials = { username: res.data.username, password: res.data.password };
  return res;
});


ipcMain.handle("app:backup", async (_e, payload) => {
  try {
    const json = String(payload?.json || "");
    if (!json) return { ok: false, error: "مفيش بيانات للنسخة الاحتياطية" };
    // نسخة احتياطية أكبر من ٦٤ ميجا معناها حالة تالفة — مش بنكتبها
    if (json.length > 64 * 1024 * 1024) return { ok: false, error: "حجم النسخة الاحتياطية أكبر من المسموح" };
    const name = String(payload?.name || `rosheta-backup-${new Date().toISOString().slice(0, 10)}.json`).replace(
      /[^\w.\-]/g,
      "_",
    );
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    // كتابة آمنة: ملف مؤقت وبعدين إعادة تسمية (مايبوظش نسخة قديمة لو الجهاز قفل فجأة)
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, file);
    appendLog("info", `backup: ${name} (${Math.round(json.length / 1024)} ك.ب)`);
    try {
      const backups = dirFiles(dir).sort((a, b) => b.mtime - a.mtime);
      for (const f of backups.slice(7)) fs.rmSync(f.full, { force: true });
    } catch {
      /* تجاهل */
    }
    return { ok: true, data: { file, bytes: json.length } };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("app:maintenance", async (_e, payload) => {
  try {
    const action = payload?.action || "stats";
    if (action === "prune") return { ok: true, data: pruneRuntime({ all: false }) };
    if (action === "clear") return { ok: true, data: pruneRuntime({ all: true }) };
    if (action === "open-bug-reports") {
      fs.mkdirSync(bugDir(), { recursive: true });
      await shell.openPath(bugDir());
      return { ok: true, data: { dir: bugDir() } };
    }
    if (action === "open-logs") {
      ensureRuntimeDirs();
      const err = await shell.openPath(logsDir());
      return err ? { ok: false, error: err } : { ok: true, data: { dir: logsDir() } };
    }
    if (action === "open-backups") {
      ensureRuntimeDirs();
      const err = await shell.openPath(backupDir());
      return err ? { ok: false, error: err } : { ok: true, data: { dir: backupDir() } };
    }
    if (action === "open-diagnostics") {
      ensureRuntimeDirs();
      const err = await shell.openPath(diagDir());
      return err ? { ok: false, error: err } : { ok: true, data: { dir: diagDir() } };
    }
    return {
      ok: true,
      data: {
        logs: filesStats(logsDir()),
        diagnostics: filesStats(diagDir()),
        backups: filesStats(backupDir()),
        retention: RETENTION_DAYS,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("nd:log", async (_e, payload) => {
  appendLog(payload?.level || "info", payload?.msg || "");
  return { ok: true };
});

/**
 * ١١٩/١٢٠) فحص السلكتورات على الموقع الحقيقي.
 * لو نايس دير غيّر صفحة، الفحص بيقول أي سلكتور اختفى — مش تخمين.
 */
ipcMain.handle("nd:probe", async () => {
  try {
    return await workers.with(async (win) => {
      await ensureSearchPage(win, credentials);
      const res = await run(win, S.PROBE_SELECTORS_SCRIPT);
      if (!res) return { ok: false, error: "الصفحة لم ترد على الفحص" };
      appendLog("warn", `probe: missing=${(res.missing || []).join(",") || "none"}`);
      return { ok: true, data: res };
    }, 60000);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

/**
 * ١١٨) لقطة HTML للتشخيص — بتتحفظ في مجلد diagnostics داخل بيانات البرنامج.
 */
let lastSearchWin = null;
/** آخر نافذة جلب صور — عشان دليل الفشل يتاخد من النافذة الصح */
let lastImageWin = null;

ipcMain.handle("nd:dump-html", async (_e, payload) => {
  try {
    const win = lastSearchWin && !lastSearchWin.isDestroyed() ? lastSearchWin : null;
    const html = win ? await run(win, "document.documentElement.outerHTML") : "";
    if (!html) return { ok: false, error: "مفيش صفحة مفتوحة لحفظها" };
    const dir = diagDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // رقم الساب بييجي من الواجهة — بيتنضف قبل ما يدخل في اسم ملف (منع path traversal)
    const sabTag = SEC.sanitizeSab(payload?.sab) || "page";
    const file = path.join(dir, `dump-${sabTag}-${stamp}.html`);
    fs.writeFileSync(file, html, "utf8");
    appendLog("warn", `dump-html: ${file}`);
    return { ok: true, data: { file } };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("nd:status", async () => {
  try {
    return await workers.with(async (win) => {
      const state = await pageState(win);
      return {
        ok: true,
        loggedIn: Boolean(state && state.hasCode),
        workers: workers.size,
        info: systemInfo(),
        deletes: deleteBacklog(),
      };
    }, 20000);
  } catch (err) {
    return { ok: false, loggedIn: false, error: String(err?.message || err) };
  }
});

/** بحث ساب على نافذة **محددة** — النافذة دي بتتحجز للساب بعد كده */
async function runSearchOn(win, { sab, payerId, payerName, timeoutMs }) {
  lastSearchWin = win;
  // ربط النافذة بالساب **قبل** أي خطوة: كل استمارات الساب بتكمل على
  // نفس المتصفح ده، ونتايج بحثه بتفضل موجودة (من غير بحث جديد لكل استمارة)
  win.__rpSab = String(sab);
  win.__rpSabDone = false;
  labelWindow(win, `ساب ${String(sab).slice(0, 20)} — بحث`);
  await ensureSearchPage(win, credentials);
  // كشف انتهاء الجلسة قبل البحث بدل ما نفشل ونعيد بلا داعي
  const sessionState = await ensureSession(win, credentials);
  let res;
  try {
    res = await searchSub(win, { sab, payerId, payerName, timeoutMs });
  } catch (err) {
    // الجلسة انتهت في نص الشغل: دخول تاني مرة واحدة بنفس النافذة وبعدها بحث
    if (err && err.code === "NEED_LOGIN") {
      traceStep(`الساب ${sab}: الجلسة انتهت — إعادة دخول في نفس النافذة`);
      await loginOnce(win, credentials);
      await ensureSearchPage(win, credentials);
      res = await searchSub(win, { sab, payerId, payerName, timeoutMs });
    } else if (err && err.code === "PRECONDITION") {
      // النافذة مش على صفحة البحث (صفحة قديمة/مودال/تحويل) — تحميل جديد
      // وإعادة المحاولة مرة واحدة بدل ما الساب يفشل على صفحة غلط.
      traceStep(`الساب ${sab}: النافذة مش على صفحة البحث — تحميل جديد ومحاولة تانية`);
      await safeLoad(win, SEARCH_URL, TIMEOUTS.pageLoad);
      const ready = await run(win, S.waitForSelectorScript("#SearchCode", 15000));
      if (!ready) throw err;
      res = await searchSub(win, { sab, payerId, payerName, timeoutMs });
    } else {
      throw err;
    }
  }
  leaseWindowForSab(sab, win);
  return { ok: true, data: res, session: sessionState };
}

ipcMain.handle("nd:search", async (_e, payload) => {
  const { sab, payerId, payerName, timeoutMs } = payload || {};
  if (!sab) return { ok: false, error: "رقم الساب مطلوب" };
  const t0 = Date.now();
  const job = { sab, payerId, payerName, timeoutMs };
  try {
    // الساب ليه متصفح محجوز؟ نكمل عليه. لأ؟ ناخد نافذة حرة ونحجزها له.
    const leased = leasedWindowForSab(sab);
    const result = leased
      ? await workers.withWindow(leased, (win) => runSearchOn(win, job))
      : await workers.with((win) => runSearchOn(win, job));
    return { ...result, ms: Date.now() - t0 };
  } catch (err) {
    // فشل البحث: بنحفظ الصفحة اللي كانت مفتوحة فعلًا (صورة + HTML) ونرفق مسارها
    const evidence = await saveWindowEvidence(lastSearchWin, `search-${SEC.sanitizeSab(sab) || "sab"}`);
    const files = evidence ? ` — الدليل: ${Object.values(evidence).join(" | ")}` : "";
    return { ok: false, error: `${String(err?.message || err)}${files}`, ms: Date.now() - t0, files: evidence };
  }
});

/** استمارة واحدة على نافذة محددة (مع حجزها للساب) */
async function runImageOn(win, payload) {
  lastImageWin = win;
  leaseWindowForSab(payload.sab, win);
  return processForm(win, {
    sab: payload.sab,
    reference: payload.reference,
    source: payload.source,
    href: payload.href,
    payerId: payload.payerId,
    payerName: payload.payerName,
    preventDelete: Boolean(payload.preventDelete),
    credentials,
  });
}

ipcMain.handle("nd:form-image", async (_e, payload) => {
  const { sab, reference } = payload || {};
  if (!sab || !reference) return { ok: false, error: "الساب والرقم المرجعي مطلوبين" };
  try {
    // **نفس متصفح الساب** دايمًا: الصورة بتتفتح بجلسة سرڤر الساب، ونتايج
    // بحثه لسه في نفس النافذة (من غير بحث جديد لكل استمارة).
    const leased = leasedWindowForSab(sab);
    if (leased) return await workers.withWindow(leased, (win) => runImageOn(win, payload));
    return await workers.with((win) => runImageOn(win, payload));
  } catch (err) {
    const evidence = await saveWindowEvidence(lastImageWin, `image-${SEC.sanitizeSab(sab) || "sab"}`);
    const files = evidence ? ` — الدليل: ${Object.values(evidence).join(" | ")}` : "";
    return { ok: false, error: `${String(err?.message || err)}${files}`, files: evidence };
  }
});

/**
 * خلاص الساب: بنفكّ حجز المتصفح اللي كان شايله.
 * النافذة بتفضل موجودة (بتتقفل لما الحوض يقرر) — بس بقت حرة لساب تاني،
 * والمحرك بيبدأ الساب الجديد من صفحة بحث نظيفة.
 */
ipcMain.handle("nd:release-sab", async (_e, payload) => {
  const sab = String(payload?.sab || "").trim();
  if (!sab) return { ok: false, error: "رقم الساب مطلوب" };
  const win = releaseWindowLease(sab);
  let released = 0;
  for (const candidate of workers.windows) {
    if (!candidate || candidate.isDestroyed()) continue;
    if (candidate.__rpSab !== sab) continue;
    candidate.__rpSabDone = true;
    candidate.__rpSab = null;
    setResourceMode(candidate, "search");
    labelWindow(candidate, "متصفح جاهز");
    released += 1;
  }
  if (released) capLog("session", `الساب ${sab}: ${released} متصفح خلّص ورجع للحوض`);
  return { ok: true, data: { sab, released, window: Boolean(win) } };
});

ipcMain.handle("nd:deletes", async () => {
  return {
    ok: true,
    pending: deleteJobs.length,
    running: deleteRunning,
    retryable: deleteRetry.size,
    backlogLimit: DELETE_BACKLOG_LIMIT,
    results: Object.fromEntries(deleteResults),
  };
});

/**
 * إلغاء الإرجاعات — بيتنادى لما المستخدم يوقف/يلغي العملية.
 * الإلغاء معناه: مفيش #btn-DeleteClaim بيتضغط على أي استمارة لسه ما اترجعتش.
 */
ipcMain.handle("nd:cancel-deletes", async (_e, payload) => {
  const res = cancelPendingDeletes(String(payload?.reason || "المستخدم لغى العملية"));
  return { ok: true, data: res };
});

/** إعادة محاولة الإرجاعات الفاشلة — آخر الجلسة، مرة واحدة */
ipcMain.handle("nd:retry-deletes", async () => {
  const count = retryFailedDeletes();
  return { ok: true, retried: count };
});

/** إشعار ويندوز عند انتهاء الجلسة — تعرف إن الشغل خلص وانت بعيد عن الجهاز */
ipcMain.handle("app:notify", async (_e, payload) => {
  try {
    if (!Notification.isSupported()) return { ok: false, error: "الإشعارات غير مدعومة" };
    const n = new Notification({
      // سقف أطوال: إشعار ضخم من الواجهة مايعلّقش نظام الإشعارات
      title: String(payload?.title || "روشتة برو").slice(0, 120),
      body: String(payload?.body || "").slice(0, 500),
      silent: false,
    });
    n.on("click", () => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (win) {
        win.show();
        win.focus();
      }
    });
    n.show();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

/** فتح مجلد التنزيلات اللي فيه ملفات الإكسل */
/** مجلد التصدير: كل ملف بيكتبه البرنامج بيتحفظ هنا وبيرجّع مساره للمستخدم */
const exportDir = () => path.join(app.getPath("downloads"), "Roshetta Pro");

const EXPORT_EXT = new Set(["xlsx", "csv", "json", "png", "jpg", "pdf"]);

ipcMain.handle("app:open-export-folder", async () => {
  const dir = exportDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* لو مش قادر ينشئه، بنفتح التنزيلات */
  }
  const err = await shell.openPath(fs.existsSync(dir) ? dir : app.getPath("downloads"));
  return { ok: !err, dir, error: err || undefined };
});

/**
 * كتابة ملف تصدير حقيقي على القرص.
 *
 * ليه مش تنزيل متصفح؟ لأن التنزيل بيسيب الملف في مجلد مبهم ومفيش تأكيد إنه
 * اتكتب فعلًا. هنا بنكتب، بنقرا الحجم بعد الكتابة، وبنرجّع المسار للمستخدم.
 */
ipcMain.handle("app:save-file", async (_e, payload) => {
  try {
    const rawName = String(payload?.name || "").trim();
    const base64 = String(payload?.base64 || "");
    const text = typeof payload?.text === "string" ? payload.text : "";
    if (!rawName) return { ok: false, error: "اسم الملف مطلوب" };
    if (!base64 && !text) return { ok: false, error: "مفيش بيانات للكتابة" };

    const ext = (rawName.split(".").pop() || "").toLowerCase();
    if (!EXPORT_EXT.has(ext)) return { ok: false, error: `صيغة غير مسموحة: ${ext || "بدون امتداد"}` };

    let bytes;
    if (base64) {
      bytes = Buffer.from(base64, "base64");
    } else {
      bytes = Buffer.from(text, "utf8");
    }
    if (!bytes.length) return { ok: false, error: "الملف فاضي" };
    if (bytes.length > 32 * 1024 * 1024) return { ok: false, error: "الملف أكبر من ٣٢ ميجا" };

    const safe = rawName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
    const dir = exportDir();
    fs.mkdirSync(dir, { recursive: true });

    // الاسم المكرر بياخد رقم بدل ما يكتب فوق ملف قديم
    const dot = safe.lastIndexOf(".");
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const suffix = dot > 0 ? safe.slice(dot) : "";
    let file = path.join(dir, safe);
    for (let i = 2; fs.existsSync(file) && i < 500; i += 1) {
      file = path.join(dir, `${stem} (${i})${suffix}`);
    }

    fs.writeFileSync(file, bytes);
    const size = fs.statSync(file).size;
    if (!size) return { ok: false, error: "الملف اتكتب بحجم صفر" };

    appendLog("info", `تصدير: ${path.basename(file)} (${Math.round(size / 1024)} ك.ب)`);
    return { ok: true, data: { file, bytes: size, name: path.basename(file), dir } };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("nd:logout-everything", async () => {
  setBusy(false);
  await workers.closeAll();
  if (loginWin && !loginWin.isDestroyed()) {
    try {
      await wc(loginWin).session.clearStorageData();
    } catch {
      /* تجاهل */
    }
    loginWin.destroy();
  }
  loginWin = null;
  await session.fromPartition(ND_PARTITION).clearStorageData();
  deleteResults.clear();
  loginTrace = [];
  return { ok: true };
});

// قفل البرنامج = إلغاء أي إرجاع لسه في الطابور (مفيش حذف بعد ما المستخدم يقفل)
app.on("before-quit", () => {
  try {
    cancelPendingDeletes("البرنامج بيتقفل");
  } catch {
    /* تجاهل */
  }
});

ipcMain.handle("nd:close-all", async () => {
  const before = BrowserWindow.getAllWindows().length;
  await workers.closeAll();
  await captures.closeAll();
  await deleters.closeAll();
  deleteJobs.length = 0;
  // قفل النوافذ = إلغاء العملية → مفيش أي إرجاع لسه في الطابور بيتنفذ
  cancelPendingDeletes("اتقفلت النوافذ");
  if (waWin && !waWin.isDestroyed()) waWin.destroy();
  waWin = null;
  // نافذة الدخول المرئية بتتقفل كمان — الجلسة محفوظة في الـ partition
  if (loginWin && !loginWin.isDestroyed()) loginWin.destroy();
  loginWin = null;
  return before > 1;
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
  const { text } = payload || {};
  // الرقم بيتنضف لأرقام بس (مدخل غير موثوق) — وقبل أي بناء رابط
  const phone = SEC.sanitizePhone(payload?.phone);
  if (!phone || !text) return { ok: false, error: "رقم الهاتف والنص مطلوبين" };
  if (phone.length < 8) return { ok: false, error: "رقم الهاتف غير صالح" };
  const body = String(text).slice(0, 4000);
  const win = await waEnsureOpen();
  let state = await waState(win);
  if (state !== "ready") state = await waWaitReady(25000);
  if (state !== "ready") return { ok: false, error: "واتساب غير متصل — امسح كود QR من بطاقة واتساب" };

  const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(body)}`;
  await safeLoad(win, url, 40000);
  const res = await run(win, S.WA_SEND_SCRIPT(body));
  // النجاح مش بيتقال غير لما الرسالة تبان فعلًا في المحادثة
  if (res && res.ok && res.verified) return { ok: true, ms: res.ms, verified: true };
  return {
    ok: false,
    verified: false,
    reason: (res && res.reason) || "unverified",
    error: (res && res.error) || "فشل الإرسال — مش متأكد إن الرسالة وصلت",
  };
});

ipcMain.handle("wa:replies", async (_e, payload) => {
  const phone = SEC.sanitizePhone(payload?.phone);
  if (!phone) return { ok: false, error: "رقم الهاتف غير صالح" };
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
  const phone = SEC.sanitizePhone(payload?.phone);
  const text = payload?.text ? String(payload.text).slice(0, 4000) : "";
  if (!phone) return { ok: false, error: "رقم الهاتف غير صالح" };
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
// الإبلاغ التلقائي عن الأخطاء على GitHub
//
// القواعد:
//   • مفيش أي إرسال إلا عند خطأ غير متوقع.
//   • التوكن من متغير بيئة بس (ROSHTA_GITHUB_TOKEN) — مش على القرص ولا في اللوج.
//   • كل النص بيتنقّح (توكنات/أرقام/مسارات/إيميلات) قبل ما يتحول لبلاغ.
//   • نفس الخطأ مرة واحدة كل ٢٤ ساعة، وسقف ٥ بلاغات في اليوم.
//   • لو مفيش نت/توكن: البلاغ بيتحفظ في طابور ويتبعت لما يبقى متاح.
// ---------------------------------------------------------------------------

const bugConfig = BUG.readConfig();
const bugDir = () => path.join(dataDir(), "bug-reports");
const bugReportsDir = () => path.join(bugDir(), "reports");
const bugStateFile = () => path.join(bugDir(), "state.json");
const bugQueueFile = () => path.join(bugDir(), "queue.json");
const MAX_QUEUE = 10;
const MAX_LOCAL_REPORTS = 30;
let lastBugSent = { at: 0, url: "", status: "" };
let bugFlushing = false;

/** قراءة JSON بأمان — أي ملف تالف بيرجع القيمة الافتراضية */
function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** كتابة JSON بشكل ذرّي (ملف مؤقت ثم rename) */
function writeJsonSafe(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

const loadBugState = () => BUG.normalizeState(readJsonSafe(bugStateFile(), null));
const saveBugState = (state) => writeJsonSafe(bugStateFile(), state);

function loadBugQueue() {
  const raw = readJsonSafe(bugQueueFile(), []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && item.issue && typeof item.issue.title === "string" && typeof item.issue.body === "string")
    .slice(-MAX_QUEUE);
}

function saveBugQueue(queue) {
  return writeJsonSafe(bugQueueFile(), queue.slice(-MAX_QUEUE));
}

/** آخر سطور ملف اللوج — سياق مفيد في البلاغ */
function readLogTail(max = 4000) {
  try {
    const file = appLogPath || path.join(logsDir(), "rosheta.log");
    if (!fs.existsSync(file)) return "";
    const size = fs.statSync(file).size;
    if (!size) return "";
    const start = Math.max(0, size - max * 3);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - start);
    try {
      fs.readSync(fd, buf, 0, buf.length, start);
    } finally {
      fs.closeSync(fd);
    }
    return buf.toString("utf8").slice(-max);
  } catch {
    return "";
  }
}

/**
 * أي نصوص معروفة الحساسية بتتشال من البلاغ.
 * بيانات نايس دير بتعيش في الذاكرة هنا في main — فمفيش طريقة تظهر في بلاغ.
 */
function bugSecrets() {
  return [credentials.username, credentials.password].filter(Boolean);
}

function buildBugContext(source, extra = {}) {
  return {
    appVersion: app.getVersion(),
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    source,
    memoryMb: Math.round(os.totalmem() / 1024 ** 2),
    portable: PORTABLE,
    workers: workers?.max,
    phase: extra?.phase,
    screen: extra?.screen,
    notes: extra?.notes,
    logTail: readLogTail(3000),
  };
}

/** نسخة محلية من كل بلاغ (للمراجعة والتشخيص حتى لو مفيش توكن) */
function saveLocalReport(issue, source, at) {
  try {
    const dir = bugReportsDir();
    fs.mkdirSync(dir, { recursive: true });
    const name = `${new Date(at).toISOString().replace(/[:.]/g, "-")}-${issue.fingerprint}.json`;
    writeJsonSafe(path.join(dir, name), { at, source, ...issue });
    // تنضيف: نحتفظ بآخر ٣٠ بلاغ
    const files = dirFiles(dir).sort((a, b) => b.mtime - a.mtime);
    for (const f of files.slice(MAX_LOCAL_REPORTS)) fs.rmSync(f.full, { force: true });
  } catch {
    /* البلاغ المحلي مش أساسي — الفشل هنا مايوقفش البرنامج */
  }
}

function enqueueBugReport(issue, source, at, reason) {
  const queue = loadBugQueue();
  queue.push({ issue, source, at, reason: String(reason || ""), attempts: 0 });
  saveBugQueue(queue);
}

/**
 * المعالجة الكاملة لخطأ: بناء البلاغ → فحص التكرار → إرسال أو طابور.
 * عمرها ما بترمي استثناء — الإبلاغ نفسه مايكونش سبب انهيار.
 */
async function sendBugReport({ error, source = "main", extra = {}, settingsEnabled = true }) {
  try {
    const at = Date.now();
    const issue = BUG.buildIssuePayload(
      { error, context: buildBugContext(source, extra), secrets: bugSecrets() },
      { now: at },
    );
    saveLocalReport(issue, source, at);

    if (!settingsEnabled) return { ok: true, status: "disabled", fingerprint: issue.fingerprint };

    const state = loadBugState();
    const gate = BUG.shouldReport(state, issue.fingerprint, at);
    if (!gate.ok) return { ok: true, status: gate.reason, fingerprint: issue.fingerprint };

    if (!bugConfig.enabled) {
      enqueueBugReport(issue, source, at, bugConfig.reason);
      return { ok: true, status: "queued", reason: bugConfig.reason, fingerprint: issue.fingerprint };
    }

    // نفس الخطأ ممكن يكون متبلّغ عنه من جهاز تاني — منفتحش بلاغ مكرر
    const existing = await BUG.findExistingIssue({
      token: bugConfig.token,
      repo: bugConfig.repo,
      fp: issue.fingerprint,
    });
    if (existing) {
      saveBugState(BUG.recordReport(state, issue.fingerprint, at, existing.url));
      lastBugSent = { at, url: existing.url, status: "existing" };
      appendLog("info", `bugreport: خطأ معروف من قبل — ${existing.url}`);
      return { ok: true, status: "existing", url: existing.url, fingerprint: issue.fingerprint };
    }

    const res = await BUG.postIssue({
      token: bugConfig.token,
      repo: bugConfig.repo,
      issue,
      log: (level, msg) => appendLog(level, msg),
    });
    if (res.ok) {
      saveBugState(BUG.recordReport(state, issue.fingerprint, at, res.url));
      lastBugSent = { at, url: res.url, status: "sent" };
      appendLog("warn", `bugreport: اتفتح بلاغ #${res.number} — ${res.url}`);
      return { ok: true, status: "sent", url: res.url, number: res.number, fingerprint: issue.fingerprint };
    }
    enqueueBugReport(issue, source, at, res.error);
    appendLog("warn", `bugreport: الإرسال فشل (${res.error}) — البلاغ اتحفظ في الطابور`);
    return { ok: true, status: "queued", reason: res.error, fingerprint: issue.fingerprint };
  } catch (err) {
    // أي فشل في الإبلاغ بيتكتب في اللوج بس — مفيش تعطيل للبرنامج
    appendLog("warn", `bugreport: تعذّر تكوين البلاغ — ${String(err?.message || err)}`);
    return { ok: false, status: "error", error: String(err?.message || err) };
  }
}

/** محاولة إرسال كل اللي في الطابور (بتتنادى بعد الإقلاع أو بكليك من الواجهة) */
async function flushBugQueue() {
  if (bugFlushing || !bugConfig.enabled) return { ok: true, sent: 0, remaining: loadBugQueue().length };
  bugFlushing = true;
  let sent = 0;
  try {
    const queue = loadBugQueue();
    const remaining = [];
    for (const item of queue) {
      const state = loadBugState();
      const gate = BUG.shouldReport(state, item.issue.fingerprint, Date.now());
      if (!gate.ok) continue; // مكرر أو تعدّى السقف اليومي — بيتشال
      const res = await BUG.postIssue({
        token: bugConfig.token,
        repo: bugConfig.repo,
        issue: item.issue,
        log: (level, msg) => appendLog(level, msg),
      });
      if (res.ok) {
        sent += 1;
        saveBugState(BUG.recordReport(state, item.issue.fingerprint, Date.now(), res.url));
        lastBugSent = { at: Date.now(), url: res.url, status: "sent" };
      } else {
        remaining.push({ ...item, attempts: (item.attempts || 0) + 1, reason: res.error });
      }
    }
    saveBugQueue(remaining);
    if (sent) appendLog("ok", `bugreport: اتبعت ${sent} بلاغ من الطابور`);
    return { ok: true, sent, remaining: loadBugQueue().length };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), remaining: loadBugQueue().length };
  } finally {
    bugFlushing = false;
  }
}

function bugReportInfo() {
  const state = loadBugState();
  return {
    ...BUG.describeConfig(bugConfig),
    sentToday: BUG.countRecent(state, Date.now()),
    maxPerDay: BUG.MAX_REPORTS_PER_DAY,
    pending: loadBugQueue().length,
    lastSentAt: lastBugSent.at || 0,
    lastSentUrl: lastBugSent.url || "",
    dir: bugDir(),
  };
}

ipcMain.handle("app:report-error", async (_e, payload) => {
  const raw = payload || {};
  // مدخلات غير موثوقة من الواجهة: بنقصّرها وبنبني Error حقيقي منها
  const message = String(raw.message || "خطأ غير معروف").slice(0, 2000);
  const stack = String(raw.stack || "").slice(0, 12000);
  const source = String(raw.source || "renderer").slice(0, 80);
  const err = new Error(message);
  err.name = String(raw.name || "Error").slice(0, 60);
  err.stack = stack || `Error: ${message}`;
  return sendBugReport({
    error: err,
    source,
    extra: {
      screen: String(raw.screen || "").slice(0, 40),
      phase: String(raw.phase || "").slice(0, 40),
      notes: String(raw.notes || "").slice(0, 500),
    },
    settingsEnabled: raw.enabled !== false,
  });
});

ipcMain.handle("app:bug-report-info", async () => {
  try {
    return { ok: true, data: bugReportInfo() };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("app:flush-bug-reports", async () => {
  try {
    return { ok: true, data: await flushBugQueue() };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
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
      // النافذة الرئيسية مش محتاجة أي وصول لـ Node — الـ preload بيكلم main بالـ IPC بس
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  const devUrl = process.env.ROSHETTA_DEV_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  appWindow = win;
  win.on("closed", () => {
    if (appWindow === win) appWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (SEC.isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // التنقّل برة ملفات البرنامج (أو سيرفر التطوير) بيتمنع، والرابط الآمن بس بيتفتح برة
  win.webContents.on("will-navigate", (event, url) => {
    if (SEC.isInternalAppUrl(url)) return;
    event.preventDefault();
    if (SEC.isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  return win;
}

app.whenReady().then(() => {
  // البرنامج بيجهّز نفسه: مجلدات البيانات واللوج والتشخيص
  ensureRuntimeDirs();
  appendLog(
    "info",
    `بدء التشغيل — Roshetta Pro v${app.getVersion()}${PORTABLE ? " (نسخة محمولة — البيانات جنب الملف)" : ""} · Electron ${process.versions.electron} · ${os.platform()} ${os.arch()} · رام ${Math.round(os.totalmem() / 1024 ** 3)} جيجا · ${os.cpus()?.length || 0} أنوية`,
  );
  // حالة الإبلاغ التلقائي بنقولها في اللوج — من غير أي جزء من التوكن
  appendLog(
    "info",
    bugConfig.enabled
      ? `bugreport: مفعّل → ${bugConfig.repo} (التوكن من ${bugConfig.tokenVar})`
      : `bugreport: مقفول (${bugConfig.reason}) — البلاغات بتتحفظ محليًا في ${bugDir()}`,
  );
  // خطأ غير متوقع في العملية الرئيسية: بيتسجل + بيتبعت بلاغ واحد (بحدود التكرار)
  process.on("uncaughtException", (err) => {
    appendLog("error", `uncaught: ${err?.stack || err}`);
    void sendBugReport({ error: err, source: "main:uncaughtException" });
  });
  process.on("unhandledRejection", (err) => {
    appendLog("error", `unhandled: ${String(err)}`);
    void sendBugReport({ error: err, source: "main:unhandledRejection" });
  });

  // انهيار ريندرر/عملية مساعدة = عيب في البرنامج مش في المستخدم — بيتبعت كبلاغ
  app.on("render-process-gone", (_event, webContents, details) => {
    const reason = String(details?.reason || "unknown");
    // الإغلاق العادي (clean-exit) مش خطأ
    if (reason === "clean-exit") return;
    const err = new Error(`انهيار الريندرر: ${reason} (exitCode=${details?.exitCode ?? "?"})`);
    void sendBugReport({ error: err, source: `renderer-gone:${reason}` });
  });
  app.on("child-process-gone", (_event, details) => {
    const type = String(details?.type || "child");
    if (String(details?.reason || "") === "clean-exit") return;
    const err = new Error(`انهيار عملية ${type}: ${details?.reason || "unknown"}`);
    void sendBugReport({ error: err, source: `child-gone:${type}` });
  });
  session.fromPartition(ND_PARTITION).setUserAgent(UA);
  session.fromPartition(WA_PARTITION).setUserAgent(UA);
  createMainWindow();

  // بلاغات اتحفظت في طابور (مفيش نت/توكن وقتها) بتتحاول تتبعت بهدوء بعد الإقلاع
  setTimeout(() => {
    void flushBugQueue();
  }, 6000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
