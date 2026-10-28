// ============================================================================
// حراسة الروابط والأسماء — دوال نقية بتتاختبر من غير Electron.
//
// السبب: كل اللي بيوصل من صفحة نايس دير (أو من الواجهة) بيعتبر **مدخل غير موثوق**.
// قبل كده كان فيه فلترة بـ regex على نص الرابط، والفلترة دي بتتقفل بأي دومين
// شبه الاسم: https://nicedeer.net.evil.com بيمشي على إنه «داخلي».
// هنا بنفكك الرابط بـ URL ونقارن الـ hostname نفسه.
// ============================================================================

const INTERNAL_HOST = "nicedeer.net";

/** المضيفين الداخليين المسموح للنوافذ تتنقل بينهم (نايس دير بس) */
function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** هل الرابط تابع لنايس دير فعلًا؟ (المضيف نفسه أو subdomain حقيقي) */
function isNiceDeerUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  return host === INTERNAL_HOST || host.endsWith(`.${INTERNAL_HOST}`);
}

/** هل الرابط https لواتساب ويب؟ */
function isWhatsAppUrl(url) {
  const host = hostOf(url);
  return host === "web.whatsapp.com";
}

/**
 * هل نسمح للنافذة الرئيسية تتنقل له؟ (ملفات البرنامج المحلية أو سيرفر التطوير)
 * المقارنة بالـ origin مش بـ includes — عشان «...?x=localhost:» ما تعديش.
 */
function isInternalAppUrl(url, devUrl = process.env.ROSHETTA_DEV_URL) {
  const raw = String(url || "");
  if (raw.startsWith("file://")) return true;
  if (!devUrl) return false;
  try {
    return new URL(raw).origin === new URL(devUrl).origin;
  } catch {
    return false;
  }
}

/**
 * هل نفتح الرابط ده في المتصفح الخارجي؟
 * http/https بس، ومن غير بيانات دخول جوه الرابط، ومن غير أي scheme غريبة
 * (file: / smb: / ms-msdt: …) — دي كانت ثغرة تنفيذ كود على الجهاز.
 */
function isSafeExternalUrl(url) {
  const raw = String(url || "").trim();
  if (!raw || raw.length > 2048) return false;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  return Boolean(parsed.hostname) && parsed.hostname.includes(".");
}

/** تنظيف رقم الساب اللي جاي من الواجهة قبل ما يتحقن في الصفحة */
function sanitizeSab(raw) {
  return String(raw ?? "").replace(/[^\d]/g, "").slice(0, 24);
}

/** رقم تليفون للواتساب: أرقام بس، بحد أقصى ١٥ رقم */
function sanitizePhone(raw) {
  return String(raw ?? "").replace(/[^\d]/g, "").slice(0, 15);
}

module.exports = {
  hostOf,
  isNiceDeerUrl,
  isWhatsAppUrl,
  isInternalAppUrl,
  isSafeExternalUrl,
  sanitizeSab,
  sanitizePhone,
  INTERNAL_HOST,
};
