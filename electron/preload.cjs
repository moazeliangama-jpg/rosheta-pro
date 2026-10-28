// الجسر الآمن بين الواجهة والعملية الرئيسية — بدون أي وصول مباشر لـ node
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("roshetta", {
  version: "1.0.0",
  searchSub: (payload) => ipcRenderer.invoke("nice:search", payload),
  fetchFormImage: (payload) => ipcRenderer.invoke("nice:form-image", payload),
  closeWindows: () => ipcRenderer.invoke("nice:close-all"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
});
