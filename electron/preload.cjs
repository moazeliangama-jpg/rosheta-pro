// الجسر الآمن بين الواجهة والعملية الرئيسية — كل استدعاء بيوصل لأتمتة حقيقية
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("roshetta", {
  platform: process.platform,
  version: "1.0.0",

  // نايس دير
  setCredentials: (payload) => ipcRenderer.invoke("nd:set-credentials", payload),
  setWorkers: (maxWorkers) => ipcRenderer.invoke("nd:set-workers", { maxWorkers }),
  warmup: (workersCount) => ipcRenderer.invoke("nd:warmup", { workers: workersCount }),
  login: (payload) => ipcRenderer.invoke("nd:login", payload),
  status: () => ipcRenderer.invoke("nd:status"),
  searchSub: (payload) => ipcRenderer.invoke("nd:search", payload),
  fetchFormImage: (payload) => ipcRenderer.invoke("nd:form-image", payload),
  deleteForm: (payload) => ipcRenderer.invoke("nd:delete", payload),
  deletes: () => ipcRenderer.invoke("nd:deletes"),
  logoutNiceDeer: () => ipcRenderer.invoke("nd:logout-everything"),
  openSearchSite: () => ipcRenderer.invoke("app:open-search-site"),

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
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
});
