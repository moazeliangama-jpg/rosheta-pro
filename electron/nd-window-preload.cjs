/**
 * سكربت بيتحمّل قبل أي سكربت في نوافذ نايس دير (preload).
 *
 * المشكلة اللي بيحلها:
 *  • `alert()` و`confirm()` و`prompt()` بتفتح نافذة نظام **بتوقف الصفحة كلها**
 *    لحد ما حد يضغط عليها. في نافذة مفتوحة في الخلفية النافذة دي مش باينة،
 *    فالأتمتة بتفضل مستنية للأبد → «النافذة فتحت ومفيش أي خطوة بتتعمل».
 *  • نفس الحكاية مع `beforeunload` و`window.print`.
 *
 * الحل: بنستبدل الدوال دي بنسخة بترجّع رد فوري وبتبلّغ العملية الرئيسية بيه،
 * فالنص اللي الموقع بيقوله (سبب الرفض مثلًا) بيتسجل بدل ما يعلّق البرنامج.
 * كل ده بيحصل **في الصفحة** بدون أي محاكاة للبيانات — الرسائل اللي بترجع هي
 * نفس اللي كانت هتظهر للمستخدم.
 */
const { ipcRenderer } = require("electron");

let budget = 40;

function report(kind, message, answer) {
  if (budget <= 0) return;
  budget -= 1;
  try {
    ipcRenderer.send("nd:page-dialog", {
      kind,
      message: String(message == null ? "" : message).slice(0, 400),
      answer: answer === undefined ? null : String(answer).slice(0, 80),
      url: (() => {
        try {
          return String(location.href).slice(0, 300);
        } catch {
          return "";
        }
      })(),
    });
  } catch {
    /* لو القناة مش متاحة، بنكمل بالرد الافتراضي */
  }
}

const define = (name, value) => {
  try {
    Object.defineProperty(window, name, { configurable: true, writable: true, value });
  } catch {
    try {
      window[name] = value;
    } catch {
      /* تجاهل */
    }
  }
};

// alert: بيتسجل وبيرجع فورًا بدل ما يوقف الصفحة
define("alert", (message) => {
  report("alert", message);
});

// confirm: بيرجّع true (الموقع بيستخدمها للتأكيد على الحفظ/الإرجاع)
define("confirm", (message) => {
  report("confirm", message, "true");
  return true;
});

// prompt: بيرجّع القيمة الافتراضية بدل ما يستنى إدخال مستحيل
define("prompt", (message, fallback) => {
  const value = fallback == null ? "" : String(fallback);
  report("prompt", message, value);
  return value;
});

// print: مفيش طابعة في الأتمتة — كانت بتفتح نافذة بتوقف الصفحة
define("print", () => {
  report("print", "");
});

// «متأكد إنك عايز تسيب الصفحة؟» بتوقف التنقل في النوافذ المخفية
try {
  window.addEventListener(
    "beforeunload",
    (event) => {
      try {
        delete event.returnValue;
      } catch {
        event.returnValue = undefined;
      }
    },
    true,
  );
} catch {
  /* تجاهل */
}

// بعض الصفحات بتستخدم window.onbeforeunload مباشرة
try {
  window.onbeforeunload = null;
} catch {
  /* تجاهل */
}
