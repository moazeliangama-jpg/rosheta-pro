// ============================================================================
// تحليل صفحات نايس دير — دوال نقية بتتاختبر من غير Electron ولا شبكة
//
// المشكلتين اللي الملف ده بيحلهم:
//   ١) تسجيل الدخول: الصفحة ممكن تكون «فورم» أو «متسجل بالفعل» أو «تحقق بشري»
//      (Cloudflare) أو «خطأ بيانات». لازم نفرّق بينهم بدقة بدل ما نقول «فشل».
//   ٢) صورة الروشتة: الصورة مش لازم تكون <img> في الصفحة الرئيسية — ممكن تكون
//      جوه iframe أو canvas أو <embed> PDF أو خلفية CSS. هنا بنستخرج كل المصادر
//      الممكنة من الـHTML عشان البرنامج يجيبها من الشبكة لو الالتقاط من الواجهة فشل.
// ============================================================================

const CHALLENGE_TITLES = /just a moment|attention required|checking your browser|verify(ing)? you are human|cloudflare|security check/i;
const CHALLENGE_HOSTS = /challenges\.cloudflare\.com|__cf_chl|captcha|turnstile|hcaptcha|recaptcha/i;

/**
 * تصنيف صفحة الدخول.
 *
 * @param {object} info
 * @param {string} [info.url]
 * @param {string} [info.title]
 * @param {boolean} [info.hasUser]  خانة المستخدم ظاهرة
 * @param {boolean} [info.hasPass]
 * @param {boolean} [info.hasBtn]   زرار Log in ظاهر
 * @param {boolean} [info.hasCode]  صفحة البحث ظاهرة (يعني متسجل بالفعل)
 * @param {string}  [info.errorText] نص رسالة الخطأ في الصفحة
 * @param {boolean} [info.challenge] فيه iframe/عنصر تحقق بشري في الصفحة
 * @returns {{state: "logged-in"|"form"|"challenge"|"error"|"unknown", message: string}}
 */
function classifyLoginPage(info = {}) {
  const url = String(info.url || "");
  const title = String(info.title || "");
  const hasUser = Boolean(info.hasUser);
  const hasPass = Boolean(info.hasPass);
  const hasBtn = Boolean(info.hasBtn);
  const hasCode = Boolean(info.hasCode);
  const errorText = String(info.errorText || "").trim();
  const challenge = Boolean(info.challenge) || CHALLENGE_TITLES.test(title) || CHALLENGE_HOSTS.test(url);

  if (hasCode) return { state: "logged-in", message: "مسجّل بالفعل — صفحة البحث ظاهرة." };
  if (challenge) {
    return {
      state: "challenge",
      message: "الموقع طلب تحقق بشري (Cloudflare/كابتشا) — لازم تتحل في النافذة المفتوحة.",
    };
  }
  if (errorText) return { state: "error", message: `نايس دير رفض الدخول: ${errorText}` };
  if (hasUser && hasPass) {
    return {
      state: "form",
      message: hasBtn ? "صفحة الدخول ظاهرة — بنكتب البيانات وندوس Log in." : "صفحة الدخول ظاهرة بدون زرار معروف.",
    };
  }
  return { state: "unknown", message: "الصفحة مش صفحة دخول ولا صفحة بحث — ممكن يكون الموقع بطيء أو اتغيّر." };
}

/** هل النص ده رسالة خطأ من نايس دير؟ (بيتجاهل الأخطاء الفاضية والتحذيرات العامة) */
function pickLoginError(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length < 4) return "";
  if (/please (enter|fill)|required|مطلوب/i.test(clean) && clean.length < 30) return clean;
  return clean.slice(0, 300);
}

// ---------------------------------------------------------------------------
// استخراج مصادر الصور من HTML
// ---------------------------------------------------------------------------

const IMG_ATTRS = [
  /<img[^>]+src\s*=\s*["']([^"']+)["']/gi,
  /<img[^>]+data-src\s*=\s*["']([^"']+)["']/gi,
  /<embed[^>]+src\s*=\s*["']([^"']+)["']/gi,
  /<object[^>]+data\s*=\s*["']([^"']+)["']/gi,
  /<source[^>]+src\s*=\s*["']([^"']+)["']/gi,
  /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]+content\s*=\s*["']([^"']+)["']/gi,
  /url\(\s*["']?([^)"']+)["']?\s*\)/gi,
];

/** أول مرشح من srcset */
function firstFromSrcset(value) {
  const first = String(value || "").split(",")[0] || "";
  return first.trim().split(/\s+/)[0] || "";
}

/**
 * كل روابط الصور/المستندات المحتملة في صفحة HTML، بترتيب أولوية:
 * ١) اللي اسمه/رابطه بيقول «روشتة / prescription / image»
 * ٢) بقية الصور
 * ٣) الملفات (pdf) في الآخر
 *
 * @param {string} html
 * @param {string} baseUrl الرابط اللي اتحمّلت منه الصفحة (لتحويل الروابط النسبية)
 * @returns {string[]}
 */
function extractImageUrls(html, baseUrl = "") {
  const text = String(html || "");
  if (!text) return [];
  const raw = [];

  for (const re of IMG_ATTRS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) raw.push(m[1]);
  }
  const srcsetRe = /<img[^>]+srcset\s*=\s*["']([^"']+)["']/gi;
  let sm;
  while ((sm = srcsetRe.exec(text))) {
    const first = firstFromSrcset(sm[1]);
    if (first) raw.push(first);
  }

  const base = String(baseUrl || "");
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    let value = String(item || "").trim().replace(/&amp;/g, "&");
    if (!value) continue;
    // حاجات مش صور خالص
    if (/^(about:|javascript:|mailto:|#)/i.test(value)) continue;
    // أصول واجهة مش صور روشتات: ستايلات، سكربتات، خطوط، وأيقونات SVG
    if (/\.(css|js|woff2?|ttf|svg)(\?|#|$)/i.test(value)) continue;
    if (/google-analytics|googletagmanager|doubleclick|hotjar|clarity\.ms|sentry\.io|facebook\.net|favicon/i.test(value)) {
      continue;
    }
    if (value.startsWith("data:")) {
      if (/^data:image\//i.test(value) && value.length > 2000) {
        if (!seen.has(value)) {
          seen.add(value);
          out.push(value);
        }
      }
      continue;
    }
    let abs = value;
    if (!/^https?:\/\//i.test(value)) {
      try {
        abs = new URL(value, base || "https://nicedeer.net/").href;
      } catch {
        continue;
      }
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }

  const score = (url) => {
    const u = url.toLowerCase();
    if (/^data:image\//.test(u)) return 0;
    // PDF آخر حاجة: بيتعرض بلقطة شاشة بعد فشل باقي الطرق
    if (/\.pdf(\?|#|$)/.test(u)) return 9;
    if (/prescription|pre-?approval|rximage|rx-image|claimimage/i.test(u)) return 1;
    if (/\.(png|jpe?g|webp|bmp|gif)(\?|#|$)/i.test(u)) return 2;
    if (/image|img|photo|scan|upload/i.test(u)) return 3;
    return 5;
  };

  return out.sort((a, b) => score(a) - score(b));
}

/** نوع المحتوى ده صورة نقدر نعرضها؟ */
function isDisplayableImageType(contentType) {
  return /^image\/(png|jpe?g|webp|bmp|gif)/i.test(String(contentType || "").split(";")[0].trim());
}

/** نوع المحتوى ده PDF؟ (محتاج لقطة شاشة بدل تحويل) */
function isPdfType(contentType) {
  return /application\/pdf/i.test(String(contentType || ""));
}

/**
 * لقطة الشاشة فاضية؟
 * الصفحة البيضاء الفاضية بتضغط JPEG لحجم صغير جدًا — بنستخدم ده كفحص سريع
 * عشان ما نخزّنش صورة بيضاء ونقول للمستخدم «اتجابت».
 */
function isLikelyBlankShot(bytes) {
  const size = Number(bytes) || 0;
  return size < 12000;
}

/**
 * اللقطة فاضية؟ (نسخة أدق من حجم الملف: بنقرأ وحدات البكسل)
 *
 * الصفحة الفاضية/البيضاء أو اللون الواحد معناها إن الالتقاط حصل قبل الرسم.
 * بنحسب انحراف الإضاءة على عيّنة من البكسلات: انحراف صغير جدًا = صورة بلا محتوى.
 *
 * @param {Buffer|Uint8Array} bitmap BGRA من NativeImage.getBitmap()
 * @param {{step?: number, minStdDev?: number}} [opts]
 */
function isBlankBitmap(bitmap, { step = 7, minStdDev = 6 } = {}) {
  const buf = bitmap;
  if (!buf || typeof buf.length !== "number" || buf.length < 16) return true;
  const pixels = Math.floor(buf.length / 4);
  if (pixels < 16) return true;
  const stride = Math.max(1, Math.floor(step));
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < pixels; i += stride) {
    const o = i * 4;
    const lum = 0.114 * buf[o] + 0.587 * buf[o + 1] + 0.299 * buf[o + 2];
    sum += lum;
    sumSq += lum * lum;
    count += 1;
  }
  if (!count) return true;
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return Math.sqrt(variance) < minStdDev;
}

/** هل الـHTML ده صفحة PDF مدمجة (Electron PDF viewer)؟ */
function looksLikePdfViewer(html) {
  const text = String(html || "");
  return /<embed[^>]+type\s*=\s*["']application\/pdf/i.test(text) || /application\/pdf/i.test(text.slice(0, 4000));
}

module.exports = {
  classifyLoginPage,
  pickLoginError,
  extractImageUrls,
  isDisplayableImageType,
  isPdfType,
  isLikelyBlankShot,
  isBlankBitmap,
  looksLikePdfViewer,
};
