// ============================================================================
// تحديث البرنامج من GitHub Releases (بند ٩٦)
//
// الفكرة: البرنامج بيسأل آخر إصدار منشور، بيقارن الأرقام، ولو فيه أحدث بينزّل
// ملف التثبيت ويشغّله — كله من غير أي مكتبة إضافية (fetch + fs بس).
//
// الجزء النقي هنا (مقارنة الإصدارات واختيار الملف) بيتاختبر بحاله،
// والجزء الشبكي في main.cjs بيتنادى منه.
// ============================================================================

/** يحوّل "v1.2.3-beta.1" إلى { major, minor, patch, pre } */
function parseVersion(raw) {
  const text = String(raw || "")
    .trim()
    .replace(/^v/i, "");
  const m = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] || "",
  };
}

/**
 * هل `candidate` أحدث من `current`؟
 * النسخة النهائية أحدث من الـ pre-release بنفس الأرقام (1.0.0 > 1.0.0-beta).
 */
function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key];
  }
  if (a.pre === b.pre) return false;
  if (!a.pre) return true; // 1.0.0 أحدث من 1.0.0-beta
  if (!b.pre) return false;
  return a.pre > b.pre;
}

/** يختار ملف التثبيت المناسب من أصول الإصدار */
function pickInstallerAsset(assets = [], platform = process.platform) {
  if (!Array.isArray(assets)) return null;
  const exe = assets.filter((a) => /\.exe$/i.test(a?.name || "") && a?.browser_download_url);
  if (!exe.length) return null;
  if (platform === "win32") {
    const setup = exe.find((a) => /setup/i.test(a.name));
    if (setup) return setup;
  }
  // أي exe متاح (المحمول كخيار أخير)
  return exe.find((a) => /setup/i.test(a.name)) || exe[0];
}

/** ملخص التحديث اللي بيتعرض في الواجهة */
function describeUpdate({ current, latest, asset }) {
  if (!latest) return { available: false, message: "مفيش إصدارات منشورة على GitHub لسه." };
  if (!isNewer(latest, current)) {
    return { available: false, message: `البرنامج محدّث (${current}) — آخر إصدار ${latest}.` };
  }
  if (!asset) {
    return {
      available: true,
      canInstall: false,
      latest,
      message: `فيه إصدار أحدث (${latest}) بس مفيش ملف تثبيت .exe في الإصدار — افتح صفحة الإصدارات.`,
    };
  }
  return {
    available: true,
    canInstall: true,
    latest,
    asset: asset.name,
    url: asset.browser_download_url,
    size: asset.size || 0,
    message: `فيه إصدار أحدث (${latest}) — جاهز للتنزيل (${Math.round((asset.size || 0) / 1024 / 1024)} ميجا).`,
  };
}

module.exports = { parseVersion, isNewer, pickInstallerAsset, describeUpdate };
