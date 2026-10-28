/**
 * preload لشريط المتصفح (الواجهة اللي فوق كل نافذة أتمتة).
 *
 * الشريط ده هو اللي بيخلي النافذة **متصفح حقيقي**: عنوان الصفحة الحقيقي،
 * أزرار رجوع/تقدم/تحديث، ومؤشر تحميل — وكل الأوامر بتروح للعملية الرئيسية
 * اللي بتنفذها على محتوى الصفحة الفعلي (مش محاكاة).
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rpChrome", {
  act: (action) => ipcRenderer.send("nd:chrome-action", { action: String(action || "") }),
  onState: (cb) => {
    const handler = (_e, state) => {
      try {
        cb(state && typeof state === "object" ? state : {});
      } catch {
        /* الواجهة مش مسؤولة */
      }
    };
    ipcRenderer.on("nd:chrome-state", handler);
    return () => ipcRenderer.removeListener("nd:chrome-state", handler);
  },
  ready: () => ipcRenderer.send("nd:chrome-ready"),
});
