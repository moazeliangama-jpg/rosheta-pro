// ============================================================================
// منطق تسجيل الدخول في نايس دير — دوال نقية بتتاختبر من غير Electron
//
// الهدف: بدل ما «الدخول فشل» تبقى رسالة واحدة مبهمة، كل محاولة بتوصف نفسها:
//   • إحنا في أنهي مرحلة (فورم / تحقق بشري / اترفض / خرجنا من صفحة الدخول)
//   • ليه وقفنا (مهلة / رفض / تحقق)
//   • إيه اللي المستخدم يعمله دلوقتي (خطوة واحدة واضحة)
// ============================================================================

/** عنوان صفحة الدخول؟ */
function isLoginUrl(url) {
  const text = String(url || "").toLowerCase();
  if (!text) return false;
  return text.includes("/account/login") || text.includes("/account/signin");
}

/**
 * تصنيف الصفحة بعد الضغط على «Log in».
 *
 * @param {{state?: string, url?: string, hasUser?: boolean, errorText?: string} | null} probe
 * @param {{elapsedMs?: number, timeoutMs?: number}} [timing]
 * @returns {{done: boolean, outcome: "success"|"error"|"challenge"|"maybe"|"form"|"unknown"|"timeout", reason: string}}
 */
function classifyAfterLogin(probe, timing = {}) {
  const elapsed = Number(timing.elapsedMs) || 0;
  const timeout = Number(timing.timeoutMs) || 0;

  if (!probe || typeof probe !== "object") {
    if (timeout && elapsed >= timeout) {
      return { done: true, outcome: "timeout", reason: "الصفحة مش بترد — مفيش استجابة من نايس دير" };
    }
    return { done: false, outcome: "unknown", reason: "لسه بنستنى رد الموقع" };
  }

  const state = String(probe.state || "unknown");
  if (state === "logged-in") return { done: true, outcome: "success", reason: "صفحة البحث ظاهرة" };
  if (state === "error") {
    return { done: true, outcome: "error", reason: String(probe.errorText || "الموقع رفض الدخول").slice(0, 200) };
  }
  if (state === "challenge") {
    if (timeout && elapsed >= timeout) {
      return { done: true, outcome: "challenge", reason: "تحقق بشري (Cloudflare) ماحلّش لوحده" };
    }
    return { done: false, outcome: "challenge", reason: "الموقع بيعمل تحقق بشري — بنستنى" };
  }
  if (state === "form") {
    if (timeout && elapsed >= timeout) {
      return { done: true, outcome: "form", reason: "الفورم رجع تاني بعد الضغط — البيانات غالبًا مش مقبولة" };
    }
    return { done: false, outcome: "form", reason: "لسه على صفحة الدخول" };
  }

  // حالة غير معروفة: لو ساب صفحة الدخول، خلاص — التأكيد النهائي بصفحة البحث
  if (probe.url && !isLoginUrl(probe.url)) {
    return { done: true, outcome: "maybe", reason: "الصفحة اتغيّرت — بنتأكد من صفحة البحث" };
  }
  if (timeout && elapsed >= timeout) {
    return { done: true, outcome: "timeout", reason: "الصفحة واقفة من غير أي إشارة نجاح أو رفض" };
  }
  return { done: false, outcome: "unknown", reason: "بنستنى تغيّر الصفحة" };
}

/** وصف قصير لحالة الصفحة — بيتكتب في سجل المحاولة */
function describeProbe(probe) {
  if (!probe || typeof probe !== "object") return "مفيش قراءة من الصفحة";
  const bits = [];
  bits.push(`الحالة: ${probe.state || "unknown"}`);
  if (probe.url) {
    try {
      const u = new URL(String(probe.url));
      bits.push(`الصفحة: ${u.pathname}${u.search ? "؟" : ""}`);
    } catch {
      bits.push(`الصفحة: ${String(probe.url).slice(0, 60)}`);
    }
  }
  if (probe.hasUser && probe.hasPass) bits.push("خانات الدخول ظاهرة");
  if (probe.challenge) bits.push("تحقق بشري ظاهر");
  if (probe.errorText) bits.push(`رسالة الموقع: ${String(probe.errorText).slice(0, 80)}`);
  if (probe.title) bits.push(`العنوان: ${String(probe.title).slice(0, 40)}`);
  return bits.join(" · ");
}

/**
 * رسالة الفشل النهائية: السبب + الخطوة الجاية + ملفات التشخيص لو موجودة.
 * @param {{outcome?: string, reason?: string, probe?: object, files?: {html?:string, image?:string}, durationMs?: number}} input
 */
function buildLoginFailure(input = {}) {
  const outcome = String(input.outcome || "unknown");
  const reason = String(input.reason || "").trim();
  const probe = input.probe || {};

  const heads = {
    error: "نايس دير رفض الدخول",
    challenge: "نايس دير طالب تحقق بشري (Cloudflare) والدخول ماحصلش",
    form: "الدخول ماقبلش — الصفحة رجعت للفورم",
    timeout: "الدخول لم يكتمل — مفيش رد واضح من نايس دير",
    maybe: "الصفحة اتغيّرت بس صفحة البحث مش بتفتح",
    unknown: "الدخول لم يكتمل",
  };

  const next = {
    error: "اتأكد من اليوزر والباسورد. لو البيانات صح، الحساب ممكن يكون مقفول أو مش مفعّل عليه صرف نايس دير.",
    challenge: "افتح «نافذة نايس دير» (زر واحد في الإعداد)، عدّي التحقق بإيدك مرة واحدة، وبعدها الأتمتة بتكمل بنفس الجلسة.",
    form: "جرّب «افتح نافذة نايس دير» وسجّل الدخول بإيدك مرة — لو نجح، المشكلة في البيانات مش في البرنامج.",
    timeout: "اتأكد من الإنترنت، وبعدها جرّب «افتح نافذة نايس دير» وشوف الصفحة بتفتح ولا لأ.",
    maybe: "الحساب دخل بس صفحة الصرف مش بتفتح — راجع صلاحية الحساب على نايس دير.",
    unknown: "جرّب «افتح نافذة نايس دير» وشوف إيه اللي بيظهر على الشاشة.",
  };

  const lines = [heads[outcome] || heads.unknown];
  if (reason) lines.push(`السبب: ${reason}`);
  const detail = describeProbe(probe);
  if (detail) lines.push(`آخر قراءة: ${detail}`);
  lines.push(`الخطوة الجاية: ${next[outcome] || next.unknown}`);

  const files = input.files || {};
  if (files.html || files.image) {
    lines.push(
      `حفظت ملفات التشخيص: ${[files.html, files.image].filter(Boolean).join(" و ")} — ابعتها لو الدخول فضل فاشل.`,
    );
  }
  return lines.join("\n");
}

/** تلخيص سجل المحاولة لآخر N سطر (بيظهر في الواجهة وبيتكتب في السجل) */
function summarizeTrace(trace, max = 12) {
  const list = Array.isArray(trace) ? trace.filter((x) => typeof x === "string" && x.trim()) : [];
  const limit = Math.max(1, Number(max) || 12);
  return list.slice(-limit);
}

/**
 * هل نحاول ضغط Enter كخطة بديلة؟
 * بنحتاجها لما الفورم بيفضل مكانه بعد الضغط على الزرار (بعض الصفحات بتربط الدخول
 * بـ submit الفورم مش بزرار).
 */
function shouldTryEnterFallback({ outcome, elapsedMs, alreadyTried }) {
  if (alreadyTried) return false;
  if (outcome !== "form" && outcome !== "unknown") return false;
  return Number(elapsedMs) >= 6000;
}

/** اسم ملف التشخيص — آمن على أي نظام ملفات */
function diagnosticsName(kind, when = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  const safeKind = String(kind || "login").replace(/[^a-z0-9-]/gi, "-").slice(0, 24);
  return `${safeKind}-${stamp}`;
}

module.exports = {
  isLoginUrl,
  classifyAfterLogin,
  describeProbe,
  buildLoginFailure,
  summarizeTrace,
  shouldTryEnterFallback,
  diagnosticsName,
};
