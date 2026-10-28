// ============================================================================
// الإبلاغ التلقائي عن الأخطاء على GitHub — الجزء النقي اللي بيتاختبر لوحده
//
// المبدأ:
//   • البلاغ بيتعمل بس لما يحصل خطأ غير متوقع (استثناء مش متعالج / رد وعد مرفوض /
//     Interface crash) — مفيش أي إرسال دوري ولا تتبع استخدام.
//   • التوكن بيتقرأ من **متغيرات البيئة** بس (ROSHTA_GITHUB_TOKEN / GITHUB_TOKEN)،
//     وعمره ما بيتكتب على القرص ولا في اللوج ولا جوه جسم البلاغ.
//   • قبل الإرسال كل النص بيعدّي على `redact`: توكنات، كلمات سر، أرقام سواب
//     وتليفونات، إيميلات، مسارات المستخدم، صور base64.
//   • نفس الخطأ مش بيتبعت مرتين في ٢٤ ساعة، وفيه سقف يومي (٥ بلاغات).
//   • لو النت/التوكن مش متاح، البلاغ بيتحفظ في طابور على الجهاز وبيتبعت بعدين.
//
// كل الدوال هنا نقية (بتاخد fetch و now كمدخلات) عشان تتاختبر من غير Electron.
// ============================================================================

const crypto = require("node:crypto");

const DEFAULT_REPO = "moazeliangama-jpg/rosheta-pro";
/** أسماء متغيرات البيئة المقبولة (الأول اللي فيه قيمة هو المستخدم) */
const TOKEN_VARS = ["ROSHTA_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"];
/** @type {string} متغير لتعطيل الإرسال نهائيًا */
const DISABLE_VAR = "ROSHTA_NO_BUG_REPORT";
/** @type {string} متغير لاختيار مستودع تاني */
const REPO_VAR = "ROSHTA_ISSUE_REPO";
const LABEL = "auto-bug";
const MAX_REPORTS_PER_DAY = 5;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TITLE = 110;
const MAX_STACK = 6000;
const MAX_LOG_TAIL = 4000;
const MAX_BODY = 20000;

// ---------------------------------------------------------------------------
// الإعدادات — من البيئة بس
// ---------------------------------------------------------------------------

function isTruthyFlag(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** `owner/name` صالح؟ (بنمنع أي حاجة غريبة تتحقن في رابط الـ API) */
function isValidRepo(repo) {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(String(repo || ""));
}

/**
 * قراءة إعداد الإبلاغ من البيئة.
 * ملاحظة أمنية: مفيش أي مسار تاني للتوكن (لا ملف، لا إعدادات، لا localStorage).
 */
function readConfig(env = process.env) {
  const source = env || {};
  if (isTruthyFlag(source[DISABLE_VAR])) {
    return { enabled: false, reason: "disabled-by-env", token: "", tokenVar: "", repo: DEFAULT_REPO };
  }
  const tokenVar = TOKEN_VARS.find((name) => String(source[name] || "").trim().length >= 20) || "";
  const token = tokenVar ? String(source[tokenVar]).trim() : "";
  const repoEnv = String(source[REPO_VAR] || "").trim();
  const repo = isValidRepo(repoEnv) ? repoEnv : DEFAULT_REPO;
  if (!token) {
    return {
      enabled: false,
      reason: "missing-token",
      token: "",
      tokenVar: "",
      repo,
      hint: `عرّف متغير بيئة ${TOKEN_VARS[0]} بتوكن فيه صلاحية Issues: write على ${repo}`,
    };
  }
  return { enabled: true, reason: "ok", token, tokenVar, repo };
}

// ---------------------------------------------------------------------------
// التنقيح — أهم دالة في الملف
// ---------------------------------------------------------------------------

const REDACTIONS = [
  // توكنات GitHub بكل أشكالها (ghp_ / gho_ / ghu_ / ghs_ / ghr_ / github_pat_)
  [/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, "<github-token>"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<github-token>"],
  // أي توكن جاي في هيدر Authorization
  [/(Bearer|token)\s+[A-Za-z0-9._\-]{10,}/gi, "$1 <token>"],
  // بيانات دخول جوه رابط: scheme://user:pass@host
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi, "$1<user>:<pass>@"],
  // مفتاح/قيمة حساسة في نص: password=... / pass: ... / token=...
  [/(pass(word)?|pwd|secret|token|api[_-]?key)(\s*[=:]\s*)(["']?)[^\s,;"'}]{2,}\4/gi, "$1$3$4<redacted>$4"],
  // مسارات المستخدم في ويندوز و ماك/لينكس
  [/([A-Za-z]:\\Users\\)[^\\\s"']+/g, "$1<user>"],
  [/(\/home\/|\/Users\/)[^/\s"']+/g, "$1<user>"],
  // إيميلات
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
  // صور base64 (روشتات أو أيقونات) — ممكن تكون مئات الكيلوبايتات
  [/data:[^,;\s]{0,60};base64,[A-Za-z0-9+/=]+/g, "data:<blob>"],
  // أي blob طويل (توكن مجهول، hash، base64)
  [/[A-Za-z0-9+/=_-]{64,}/g, "<blob>"],
  // أرقام طويلة = ساب أو تليفون أو رقم قومي (٥ أرقام وأكتر)
  [/\d{5,}/g, "<num>"],
  // نفس القاعدة للأرقام العربية-الهندية (١٢٣٤٥) والفارسية (۱۲۳۴۵)
  [/[\u0660-\u0669\u06F0-\u06F9]{5,}/g, "<num>"],
];

/**
 * تنقيح أي نص قبل ما يتحول لبلاغ.
 * `secrets` اختيارية: نصوص معروفة الحساسية (اسم مستخدم/كلمة سر نايس دير) بتتشال حرفيًا.
 */
function redact(input, secrets = []) {
  let text = String(input ?? "");
  if (!text) return "";
  for (const secret of secrets) {
    const s = String(secret || "");
    // أقل من 4 حروف بيدوّر على حاجات كتير بلا داعي
    if (s.length < 4) continue;
    text = text.split(s).join("<secret>");
  }
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  // مسافة زيادة وأسطر فاضية متكررة
  return text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** تقصير نص مع علامة واضحة إنه اتفصل */
function clamp(text, max) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… (اتقصّر — الطول الأصلي ${value.length} حرف)`;
}

// ---------------------------------------------------------------------------
// البصمة — أساس منع تكرار البلاغات
// ---------------------------------------------------------------------------

/** بصمة قصيرة لنفس الخطأ (النوع + الرسالة + أول سطر في الـ stack) */
function fingerprint({ name, message, stack } = {}) {
  const firstFrame = String(stack || "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^\s*at\s/.test(l));
  const basis = `${name || "Error"}|${message || ""}|${firstFrame || ""}`;
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 12);
}

/** عنوان مختصر من رسالة الخطأ (سطر واحد) */
function shortMessage(message, max = 80) {
  const text = String(message || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "(بدون رسالة)";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * تفكيك أي حاجة بترمى (Error أو string أو object) لشكل موحّد.
 * الحاجات الغريبة (null / رقم) ما تكسرش البلاغ.
 */
function normalizeError(err) {
  if (err instanceof Error) {
    return {
      name: String(err.name || "Error"),
      message: String(err.message || ""),
      stack: String(err.stack || ""),
      code: err.code ? String(err.code) : "",
    };
  }
  if (typeof err === "string") return { name: "Error", message: err, stack: "", code: "" };
  try {
    const json = JSON.stringify(err);
    return { name: "Unknown", message: String(json ?? ""), stack: "", code: "" };
  } catch {
    return { name: "Unknown", message: String(err), stack: "", code: "" };
  }
}

// ---------------------------------------------------------------------------
// بناء البلاغ
// ---------------------------------------------------------------------------

/**
 * يبني عنوان ووصف بلاغ GitHub.
 *
 * @param {{ error: unknown, context?: object, secrets?: string[] }} input
 * @param {{ now?: number }} [opts]
 */
function buildIssuePayload({ error, context = {}, secrets = [] }, opts = {}) {
  const at = Number(opts.now) || Date.now();
  const norm = normalizeError(error);
  const fp = fingerprint(norm);
  const safeMessage = redact(norm.message, secrets);
  const stack = clamp(redact(norm.stack, secrets) || "(مفيش stack trace)", MAX_STACK);
  const logTail = clamp(redact(context.logTail || "", secrets), MAX_LOG_TAIL);

  const title = clamp(`[auto] ${shortMessage(`${norm.name}: ${safeMessage}`)} (rp:${fp})`, MAX_TITLE).replace(/\n/g, " ");

  const rows = [
    ["الإصدار", context.appVersion || "غير معروف"],
    ["النظام", `${context.platform || process.platform} ${context.arch || process.arch}${context.osRelease ? ` · ${context.osRelease}` : ""}`],
    ["Electron / Chrome / Node", `${context.electron || "?"} / ${context.chrome || "?"} / ${context.node || "?"}`],
    ["المصدر", context.source || "غير معروف"],
    ["وقت الحدوث", new Date(at).toISOString()],
    ["الذاكرة", context.memoryMb ? `${Math.round(context.memoryMb)} ميجا` : "غير معروف"],
    ["نسخة محمولة", context.portable ? "نعم" : "لا"],
    ["البصمة", fp],
  ];
  if (context.workers) rows.push(["نوافذ التشغيل", String(context.workers)]);
  if (context.phase) rows.push(["مرحلة التشغيل", String(context.phase)]);
  if (context.screen) rows.push(["الشاشة", String(context.screen)]);
  if (norm.code) rows.push(["كود الخطأ", norm.code]);

  const table = rows.map(([k, v]) => `| ${k} | \`${String(v).replace(/`/g, "'")}\` |`).join("\n");

  const body = [
    `<!-- rp-fingerprint: ${fp} -->`,
    "بلاغ تلقائي من **روشتة برو** — اتعمل لوحده لحظة خطأ غير متوقع.",
    "",
    "| البيان | القيمة |",
    "| --- | --- |",
    table,
    "",
    `**الخطأ:** \`${shortMessage(`${norm.name}: ${safeMessage}`, 300).replace(/`/g, "'")}\``,
    "",
    "<details open><summary>Stack trace</summary>",
    "",
    "```text",
    stack,
    "```",
    "",
    "</details>",
  ];

  if (logTail) {
    body.push(
      "<details><summary>آخر سطور السجل (منقّحة)</summary>",
      "",
      "```text",
      logTail,
      "```",
      "",
      "</details>",
    );
  }

  if (context.notes) {
    body.push("", `> ${redact(context.notes, secrets).slice(0, 500)}`);
  }

  body.push(
    "",
    "---",
    "> الأرقام الطويلة (سواب/تليفونات)، الإيميلات، مسارات المستخدم، وبيانات الدخول بتتشال تلقائيًا قبل الإرسال.",
    "> تقدر تقفل الإبلاغ التلقائي من إعدادات البرنامج أو بمتغير `ROSHTA_NO_BUG_REPORT=1`.",
  );

  return {
    title,
    body: clamp(body.join("\n"), MAX_BODY),
    labels: [LABEL],
    fingerprint: fp,
  };
}

// ---------------------------------------------------------------------------
// منع التكرار + السقف اليومي
// ---------------------------------------------------------------------------

function freshState() {
  return { history: [], updatedAt: 0 };
}

/** فلترة أي حالة تالفة جاية من القرص (ملف اتقطع / نسخة قديمة) */
function normalizeState(raw) {
  const history = Array.isArray(raw?.history)
    ? raw.history
        .filter((e) => e && typeof e.fp === "string" && Number.isFinite(Number(e.at)))
        .map((e) => ({ fp: e.fp, at: Number(e.at), url: typeof e.url === "string" ? e.url : "" }))
    : [];
  return { history: history.slice(-200), updatedAt: Number(raw?.updatedAt) || 0 };
}

/**
 * هل يستحق البلاغ يتنفّذ؟
 * @returns {{ok: boolean, reason: "ok"|"duplicate"|"rate-limit"}}
 */
function shouldReport(state, fp, now, limits = {}) {
  const maxPerDay = Number(limits.maxPerDay) || MAX_REPORTS_PER_DAY;
  const windowMs = Number(limits.windowMs) || DEDUPE_WINDOW_MS;
  const history = normalizeState(state).history.filter((e) => now - e.at < windowMs);
  if (history.some((e) => e.fp === fp)) return { ok: false, reason: "duplicate" };
  if (history.length >= maxPerDay) return { ok: false, reason: "rate-limit" };
  return { ok: true, reason: "ok" };
}

/** تسجيل بلاغ اتبعت (بيرجع حالة جديدة — مفيش تعديل في المكان) */
function recordReport(state, fp, at, url = "") {
  const prev = normalizeState(state);
  return {
    history: [...prev.history, { fp, at, url }].slice(-200),
    updatedAt: at,
  };
}

/** عدد البلاغات في آخر ٢٤ ساعة */
function countRecent(state, now, windowMs = DEDUPE_WINDOW_MS) {
  return normalizeState(state).history.filter((e) => now - e.at < windowMs).length;
}

// ---------------------------------------------------------------------------
// عميل GitHub REST
// ---------------------------------------------------------------------------

const API = "https://api.github.com";

function withTimeout(ms) {
  // AbortSignal.timeout موجود من Node 17.3 — لو مش موجود بنكمل بدون timeout
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

async function githubFetch({ token, path, method = "GET", body, fetchImpl, timeoutMs = 15000 }) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") throw new Error("fetch غير متاح في هذا الإصدار");
  const res = await doFetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "RoshettaPro-BugReporter",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: withTimeout(timeoutMs),
  });
  return res;
}

/**
 * إرسال بلاغ جديد.
 * لو الليبل مش موجود في المستودع GitHub بيرد 422 — بنعيد المحاولة من غير ليبل
 * (أحسن من إن البلاغ يضيع عشان ليبّل ناقص).
 */
async function postIssue({ token, repo, issue, fetchImpl, timeoutMs = 15000, log = () => {} }) {
  if (!token) return { ok: false, error: "missing-token" };
  if (!isValidRepo(repo)) return { ok: false, error: "invalid-repo" };
  const payloadBase = { title: issue.title, body: issue.body };
  const labels = Array.isArray(issue.labels) ? issue.labels.filter(Boolean) : [];

  const send = async (withLabels) => {
    const body = withLabels && labels.length ? { ...payloadBase, labels } : payloadBase;
    return githubFetch({ token, path: `/repos/${repo}/issues`, method: "POST", body, fetchImpl, timeoutMs });
  };

  let res = await send(true);
  if (res.status === 422 && labels.length) {
    log("warn", "bugreport: الليبل مرفوض — إعادة المحاولة من غيره");
    res = await send(false);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const text = await res.text();
      detail = String(text || "").slice(0, 300);
    } catch {
      /* تجاهل */
    }
    return { ok: false, status: res.status, error: `GitHub ردّ بـ ${res.status}${detail ? `: ${detail}` : ""}` };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, number: data.number, url: data.html_url || "", status: res.status };
}

/**
 * هل فيه بلاغ مفتوح بنفس البصمة؟ (بحث في العناوين)
 * فشل البحث مش بيمنع الإرسال — بنكمّل.
 */
async function findExistingIssue({ token, repo, fp, fetchImpl, timeoutMs = 12000 }) {
  if (!token || !isValidRepo(repo)) return null;
  try {
    const q = `repo:${repo} is:issue in:title "rp:${fp}"`;
    const res = await githubFetch({
      token,
      path: `/search/issues?q=${encodeURIComponent(q)}&per_page=5`,
      fetchImpl,
      timeoutMs,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const items = Array.isArray(data?.items) ? data.items : [];
    const open = items.find((it) => it && it.state === "open");
    return open ? { number: open.number, url: open.html_url || "" } : null;
  } catch {
    return null;
  }
}

/** معلومات مختصرة للواجهة (بدون أي جزء من التوكن) */
function describeConfig(config) {
  return {
    enabled: Boolean(config?.enabled),
    reason: config?.reason || "unknown",
    repo: config?.repo || DEFAULT_REPO,
    tokenVar: config?.tokenVar || "",
    hint: config?.hint || "",
  };
}

module.exports = {
  DEFAULT_REPO,
  TOKEN_VARS,
  DISABLE_VAR,
  REPO_VAR,
  LABEL,
  MAX_REPORTS_PER_DAY,
  DEDUPE_WINDOW_MS,
  readConfig,
  isValidRepo,
  redact,
  clamp,
  fingerprint,
  shortMessage,
  normalizeError,
  buildIssuePayload,
  freshState,
  normalizeState,
  shouldReport,
  recordReport,
  countRecent,
  postIssue,
  findExistingIssue,
  describeConfig,
};
