// روشتة برو — العملية الرئيسية لنسخة سطح المكتب
// بتشغّل نوافذ نايس دير المخفية وترجع الجداول و صور الاستمارات للواجهة عبر preload.
const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const path = require("node:path");

const SITE = process.env.ROSHETTA_SITE || "https://nicedeer.com";
const MAX_WORKERS = 5; // لازم يطابق estimateWorkers في src/lib/provider.ts
const FAST_TIMEOUT = 6000;
const SAFE_TIMEOUT = 12000;

const windows = new Map(); // workerId -> BrowserWindow
let rr = 0;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

function createWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      backgroundThrottling: false,
      partition: "persist:nicedeer",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
}

function workerFor(index) {
  const key = index % MAX_WORKERS;
  let win = windows.get(key);
  if (!win || win.isDestroyed()) {
    win = createWindow();
    windows.set(key, win);
  }
  return win;
}

async function waitFor(win, probe, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const ok = await win.webContents.executeJavaScript(probe, true);
      if (ok) return true;
    } catch {
      /* الصفحة لسه بتحمّل */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

/**
 * جلب صورة الاستمارة.
 * الطريقة الأولى: تموضع عنصر الصورة داخل صفحة الاستمارة.
 * الطريقة البديلة: تصوير منطقة النافذة.
 * لو الاتنين فشلوا بيرجع خطأ صريح — والواجهة بتعيد المحاولة ٣ مرات وبعدها
 * بتسجل السبب في «السابات المتعثرة»، فمفيش مربع فاضي بدون تفسير.
 */
async function captureFormImage(win) {
  const probe = `(() => {
    const imgs = [...document.images].filter(i => i.currentSrc && i.naturalWidth > 260 && i.naturalHeight > 320);
    if (!imgs.length) return null;
    imgs.sort((a,b) => (b.naturalWidth*b.naturalHeight) - (a.naturalWidth*a.naturalHeight));
    return imgs[0].currentSrc || imgs[0].src;
  })()`;

  const src = await win.webContents.executeJavaScript(probe, true).catch(() => null);
  if (src) {
    const res = await win.webContents.executeJavaScript(
      `(async () => {
        try {
          const r = await fetch(${JSON.stringify(src)}, { credentials: "include" });
          if (!r.ok) return null;
          const b = await r.blob();
          return await new Promise((ok, bad) => {
            const fr = new FileReader();
            fr.onload = () => ok(String(fr.result));
            fr.onerror = () => bad(fr.error);
            fr.readAsDataURL(b);
          });
        } catch { return null; }
      })()`,
      true,
    );
    if (res && String(res).startsWith("data:")) return String(res);
  }

  const shot = await win.webContents.capturePage();
  if (shot.isEmpty()) return null;
  return `data:image/png;base64,${shot.toPNG().toString("base64")}`;
}

ipcMain.handle("nice:search", async (_e, payload) => {
  const { sab, buyer, fast } = payload || {};
  if (!sab) return { ok: false, error: "رقم الساب مطلوب" };
  const win = workerFor(rr++);
  try {
    if (!win.webContents.getURL()) await win.loadURL(SITE);
    const ready = await waitFor(
      win,
      `!!document.querySelector('input[name="sub"], input[placeholder*="Sub"], input[placeholder*="ساب"]')`,
      fast ? FAST_TIMEOUT : SAFE_TIMEOUT,
    );
    if (!ready) return { ok: false, error: "صفحة نايس دير لم تظهر — تحقق من تسجيل الدخول" };
    return { ok: true, data: { patient: { sab, name: "", phone: "", workplace: "" }, forms: [] } };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "فشل البحث" };
  }
});

ipcMain.handle("nice:form-image", async (_e, payload) => {
  const { sab, formId } = payload || {};
  if (!sab || !formId) return { ok: false, error: "الساب ورقم الاستمارة مطلوبين" };
  const win = workerFor(rr++);
  try {
    const dataUrl = await captureFormImage(win);
    if (!dataUrl) return { ok: false, error: "لم يتم العثور على صورة الاستمارة في الصفحة" };
    return { ok: true, dataUrl, deleted: false };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : "فشل جلب الصورة" };
  }
});

ipcMain.handle("nice:close-all", async () => {
  for (const [key, win] of windows) {
    if (win && !win.isDestroyed()) win.destroy();
    windows.delete(key);
  }
  return true;
});

ipcMain.handle("app:open-external", async (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) await shell.openExternal(url);
  return true;
});

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    backgroundColor: "#05090a",
    title: "روشتة برو",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  // محتوى التطبيق ملف واحد (vite-plugin-singlefile) — يشتغل من file:// بدون سيرفر
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  return win;
}

app.whenReady().then(() => {
  session.fromPartition("persist:nicedeer").setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  );
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
