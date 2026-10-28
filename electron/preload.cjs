// الجسر الآمن بين الواجهة والعملية الرئيسية — كل استدعاء بيوصل لأتمتة حقيقية
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("roshetta", {
  platform: process.platform,
  version: "1.0.4",

  // نايس دير
  setCredentials: (payload) => ipcRenderer.invoke("nd:set-credentials", payload),
  setWorkers: (maxWorkers) => ipcRenderer.invoke("nd:set-workers", { maxWorkers }),
  tune: (workers) => ipcRenderer.invoke("nd:tune", { workers }),
  busy: (active) => ipcRenderer.invoke("nd:busy", { active }),
  warmup: (workersCount) => ipcRenderer.invoke("nd:warmup", { workers: workersCount }),
  login: (payload) => ipcRenderer.invoke("nd:login", payload),
  /** نافذة نايس دير المرئية — تسجيل يدوي / عدّي أي تحقق بشري مرة واحدة */
  openLoginWindow: (payload) => ipcRenderer.invoke("nd:open-login-window", payload),
  /** وضع النوافذ: خلفية مرئية (افتراضي) أو مخفية تمامًا */
  setWindowMode: (payload) => ipcRenderer.invoke("nd:set-window-mode", payload),
  /** آخر خطوات محاولة الدخول — بتظهر في الإعدادات */
  loginTrace: () => ipcRenderer.invoke("nd:login-trace"),
  status: () => ipcRenderer.invoke("nd:status"),
  searchSub: (payload) => ipcRenderer.invoke("nd:search", payload),
  fetchFormImage: (payload) => ipcRenderer.invoke("nd:form-image", payload),
  deletes: () => ipcRenderer.invoke("nd:deletes"),
  retryDeletes: () => ipcRenderer.invoke("nd:retry-deletes"),
  logoutNiceDeer: () => ipcRenderer.invoke("nd:logout-everything"),
  openSearchSite: () => ipcRenderer.invoke("app:open-search-site"),
  preflight: () => ipcRenderer.invoke("app:preflight"),
  /**
   * الإبلاغ التلقائي: بيتبعت للعملية الرئيسية، وهي اللي بتتكلم مع GitHub.
   * التوكن عمره ما بيوصل هنا — بيقرأ من متغيرات البيئة في main بس.
   */
  reportError: (payload) => ipcRenderer.invoke("app:report-error", payload),
  bugReport: {
    info: () => ipcRenderer.invoke("app:bug-report-info"),
    flush: () => ipcRenderer.invoke("app:flush-bug-reports"),
  },
  /** ٩٦) تحديث البرنامج من GitHub Releases */
  updates: {
    check: () => ipcRenderer.invoke("app:check-update"),
    download: (payload) => ipcRenderer.invoke("app:download-update", payload),
    run: (payload) => ipcRenderer.invoke("app:run-update", payload),
  },
  /** بيانات الدخول: بتتحفظ مشفّرة بمفتاح النظام مش في ملف الإعدادات */
  credentials: {
    save: (payload) => ipcRenderer.invoke("app:save-credentials", payload),
    load: () => ipcRenderer.invoke("app:load-credentials"),
    clear: () => ipcRenderer.invoke("app:clear-credentials"),
  },
  /** ٦٠) نسخة احتياطية يومية للحالة */
  backup: (payload) => ipcRenderer.invoke("app:backup", payload),
  /** ١٢٧) صيانة ملفات اللوج والتشخيص */
  maintenance: (payload) => ipcRenderer.invoke("app:maintenance", payload),
  probe: () => ipcRenderer.invoke("nd:probe"),
  dumpHtml: (payload) => ipcRenderer.invoke("nd:dump-html", payload),
  log: (payload) => ipcRenderer.invoke("nd:log", payload),

  // واتساب ويب
  wa: {
    status: () => ipcRenderer.invoke("wa:status"),
    pair: () => ipcRenderer.invoke("wa:pair"),
    logout: () => ipcRenderer.invoke("wa:logout"),
    send: (payload) => ipcRenderer.invoke("wa:send", payload),
    replies: (payload) => ipcRenderer.invoke("wa:replies", payload),
    openChat: (payload) => ipcRenderer.invoke("wa:open-chat", payload),
  },

  closeAll: () => ipcRenderer.invoke("nd:close-all"),
  /** كتابة ملف تصدير حقيقي على القرص وبرجوع المسار */
  saveFile: (payload) => ipcRenderer.invoke("app:save-file", payload),
  openExportFolder: () => ipcRenderer.invoke("app:open-export-folder"),
  notify: (payload) => ipcRenderer.invoke("app:notify", payload),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
});
