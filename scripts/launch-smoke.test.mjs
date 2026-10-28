/**
 * اختبار «البرنامج بيفتح»: بنحمّل العملية الرئيسية الحقيقية (`electron/main.cjs`)
 * بمحاكي لـ`electron` (مش بيئة سطح مكتب)، ونتأكد إن:
 *   • كل ملف بيتطلبه main موجود (سكربتات، preloads، إلخ).
 *   • الإقلاع نفسه مابيرميش استثناء.
 *   • قنوات الـIPC اتسجّلت كلها (الواجهة مش هتلاقي زرار ميت).
 *
 * ليه محاكي؟ لأن Electron نفسه مابيشتغلش في بيئة الاختبار (محتاج شاشة وباينري).
 * الاختبار ده بيمسك أشهر أسباب «البرنامج مش بيفتح خالص»: ملف ناقص، أو require غلط،
 * أو خطأ في أول سطر من الإقلاع.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roshetta-smoke-"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const listeners = new Map();

function makeElectronStub() {
  const handled = [];
  const onEvents = [];

  const webContents = () => {
    const wc = {
      id: Math.floor(Math.random() * 1e6),
      session: fakeSession(),
      on: () => wc,
      once: () => wc,
      off: () => wc,
      send: () => {},
      executeJavaScript: async () => null,
      setWindowOpenHandler: () => {},
      setUserAgent: () => {},
      getURL: () => "about:blank",
      isLoadingMainFrame: () => false,
      isLoading: () => false,
      close: () => {},
      navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack: () => {}, goForward: () => {} },
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => {},
      goForward: () => {},
      reload: () => {},
      capturePage: async () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }),
      isDestroyed: () => false,
      openDevTools: () => {},
      setZoomFactor: () => {},
      removeAllListeners: () => {},
      debugger: { attach: () => {}, sendCommand: async () => ({}) },
    };
    return wc;
  };

  class FakeBrowserWindow {
    constructor(options = {}) {
      this.options = options;
      this.webContents = webContents();
      this.id = Math.floor(Math.random() * 1e6);
      this.__events = new Map();
      this.__children = [];
      this.contentView = { addChildView: (view) => this.__children.push(view) };
    }
    static getAllWindows() {
      return [];
    }
    static fromWebContents() {
      return null;
    }
    static fromId() {
      return null;
    }
    on(name, fn) {
      this.__events.set(name, fn);
      return this;
    }
    once(name, fn) {
      this.__events.set(name, fn);
      return this;
    }
    off() {
      return this;
    }
    removeAllListeners() {
      return this;
    }
    loadURL() {
      return Promise.resolve();
    }
    loadFile() {
      return Promise.resolve();
    }
    isDestroyed() {
      return false;
    }
    destroy() {}
    show() {}
    hide() {}
    showInactive() {}
    focus() {}
    blur() {}
    isVisible() {
      return true;
    }
    isMinimized() {
      return false;
    }
    restore() {}
    maximize() {}
    center() {}
    setTitle() {}
    setBounds() {}
    getBounds() {
      return { x: 0, y: 0, width: 1000, height: 700 };
    }
    getContentSize() {
      return [1000, 700];
    }
    setSkipTaskbar() {}
    setAlwaysOnTop() {}
    setOpacity() {}
    setMenu() {}
    isAlwaysOnTop() {
      return false;
    }
    static getFocusedWindow() {
      return null;
    }
  }

  const fakeSession = () => ({
    webRequest: { onBeforeRequest: () => {}, onHeadersReceived: () => {}, onCompleted: () => {} },
    clearStorageData: async () => {},
    setUserAgent: () => {},
    setPermissionRequestHandler: () => {},
    cookies: { get: async () => [], set: async () => {}, flushStore: async () => {} },
    fetch: async () => ({ ok: false, status: 0, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) }),
    protocol: { handle: () => {} },
    setProxy: async () => {},
  });

  const app = {
    whenReady: () => Promise.resolve(),
    on: (name, fn) => {
      onEvents.push(name);
      return app;
    },
    once: (name, fn) => {
      onEvents.push(name);
      return app;
    },
    off: () => app,
    emit: () => true,
    quit: () => {},
    exit: () => {},
    getPath: (name) => path.join(tmp, name),
    setPath: () => {},
    getVersion: () => pkg.version,
    getName: () => "Roshetta Pro",
    getAppPath: () => root,
    getLocale: () => "ar-EG",
    isPackaged: false,
    disableHardwareAcceleration: () => {},
    requestSingleInstanceLock: () => true,
    releaseSingleInstanceLock: () => {},
    setAppUserModelId: () => {},
    setName: () => {},
    commandLine: { appendSwitch: () => {}, appendArgument: () => {} },
    setLoginItemSettings: () => {},
    getLoginItemSettings: () => ({ openAtLogin: false }),
    dock: { hide: () => {} },
  };

  // WebContentsView الحقيقي: المحتوى بيبقى webContents منفصل جوه النافذة
  class FakeWebContentsView {
    constructor(options = {}) {
      this.options = options;
      this.webContents = webContents();
      this.bounds = null;
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
  }

  const electron = {
    app,
    BrowserWindow: FakeBrowserWindow,
    WebContentsView: FakeWebContentsView,
    ipcMain: {
      handle: (channel, fn) => {
        handled.push({ channel, fn });
      },
      on: (channel) => {
        onEvents.push(`ipc:${channel}`);
      },
      removeHandler: () => {},
      removeAllListeners: () => {},
    },
    session: { fromPartition: () => fakeSession(), defaultSession: fakeSession() },
    shell: { openExternal: async () => {}, openPath: async () => "", showItemInFolder: () => {} },
    powerSaveBlocker: { start: () => 1, stop: () => {}, isStarted: () => false },
    Notification: Object.assign(function Notification() {}, { isSupported: () => false }),
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(""),
      decryptString: () => "",
    },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
      getAllDisplays: () => [],
    },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}), getApplicationMenu: () => null },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }), createFromPath: () => ({ isEmpty: () => true }) },
    dialog: { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: true }) },
    net: { fetch: async () => ({ ok: false, status: 0 }) },
    Tray: function Tray() {
      return { setToolTip: () => {}, setContextMenu: () => {}, on: () => {} };
    },
    clipboard: { writeText: () => {}, readText: () => "" },
  };

  return { electron, handled, onEvents };
}

test("العملية الرئيسية بتحمّل من غير أخطاء وكل قنوات الـIPC بتتسجّل", async () => {
  const { electron, handled, onEvents } = makeElectronStub();
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return electron;
    return originalLoad.apply(this, arguments);
  };

  try {
    const require = Module.createRequire(path.join(root, "package.json"));
    // مسح أي نسخة محمّلة قبل كده
    delete require.cache[path.join(root, "electron/main.cjs")];
    assert.doesNotThrow(() => require("./electron/main.cjs"), "تحميل main.cjs رمى استثناء");
  } finally {
    Module._load = originalLoad;
  }

  assert.ok(handled.length >= 40, `عدد قنوات IPC قليل: ${handled.length}`);
  const channels = new Set(handled.map((h) => h.channel));
  for (const ch of ["nd:login", "nd:search", "nd:form-image", "app:preflight", "app:save-file", "wa:send"]) {
    assert.ok(channels.has(ch), `القناة ${ch} مش مسجّلة`);
  }
  // شريط المتصفح بيرسل أوامر بـipcMain.on (مش handle) — لازم يكون مسجّل
  for (const ch of ["nd:chrome-action", "nd:chrome-ready"]) {
    assert.ok(onEvents.includes(`ipc:${ch}`), `قناة شريط المتصفح ${ch} مش مسجّلة`);
  }
  // نسخة واحدة بس من كل قناة — التسجيل المكرر بيرمي في Electron
  const dupes = handled.map((h) => h.channel).filter((c, i, arr) => arr.indexOf(c) !== i);
  assert.deepEqual([...new Set(dupes)], [], `قنوات مسجّلة مرتين: ${[...new Set(dupes)].join(", ")}`);
});

test("كل ملف بيطلبه main موجود على القرص (preloads + سكربتات)", () => {
  const files = fs.readdirSync(path.join(root, "electron")).filter((f) => f.endsWith(".cjs"));
  const mainSrc = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
  const requires = [...mainSrc.matchAll(/require\("(\.\/[^"]+)"\)/g)].map((m) => m[1]);
  for (const rel of requires) {
    assert.ok(fs.existsSync(path.join(root, "electron", rel)), `main.cjs بيطلب ملف مش موجود: ${rel}`);
  }
  for (const rel of mainSrc.matchAll(/path\.join\(__dirname,\s*"([^"]+\.cjs)"\)/g)) {
    assert.ok(fs.existsSync(path.join(root, "electron", rel[1])), `مسار مش موجود: ${rel[1]}`);
  }
  // كل ملفات electron لازم تكون جوه files في إعدادات التغليف
  const yml = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  assert.match(yml, /electron\/\*\*\/\*/, "إعدادات التغليف لازم تشمل electron/**/*");
  assert.ok(files.length >= 5);
});
