// ============================================================================
// أكواد JavaScript اللي بتتنفذ جوه صفحات نايس دير / واتساب.
// منفصلة عن main.cjs عشان تتفحص وتتاختبر بدون تشغيل Electron.
//
// النسخة السريعة: كل خطوة بترجع Promise بيتحل بمجرد ما الشرط يتحقق
// (requestAnimationFrame / MutationObserver) — مفيش polling من Node ولا sleeps ثابتة.
// ============================================================================

// ---------------------------------------------------------------------------
// دوال مساعدة بتتحقن في الصفحة
// ---------------------------------------------------------------------------
const HELPERS = `
  const rpSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rpRaf = (cb) => (window.requestAnimationFrame ? window.requestAnimationFrame(cb) : setTimeout(cb, 16));
  // يستنى شرط يتحقق ويرجع قيمته بأسرع ما يمكن
  const rpWait = (pred, timeout) => new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      let value = null;
      try { value = pred(); } catch (e) { value = null; }
      if (value) { resolve(value); return; }
      if (performance.now() - started >= timeout) { resolve(null); return; }
      rpRaf(tick);
    };
    tick();
  });
  const rpVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
`;

// ---------------------------------------------------------------------------
// قراءة الجدولين (مصدر واحد للحقيقة — مستخدم في البحث وفي الفحص)
// ---------------------------------------------------------------------------
const PARSE_FN_SRC = `
  const rpClean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const rpParse = () => {
    const forms = [];

    // جدول 1: Pre-Approvals
    const t1 = document.querySelector('#Table');
    if (t1) {
      for (const tr of t1.querySelectorAll('tbody tr')) {
        const hidden = tr.querySelector('input[name="approval.PreApprovalId"]');
        const link = tr.querySelector('a.hyperLink');
        if (!link && !hidden) continue;
        const cells = [...tr.querySelectorAll('td')].map((td) => rpClean(td.textContent));
        const onclick = link ? (link.getAttribute('onclick') || '') : '';
        const argsMatch = onclick.match(/CreatePreApprovalEprescription\\(([^)]*)\\)/);
        let args = [];
        if (argsMatch) args = argsMatch[1].split(',').map((a) => a.trim().replace(/^'/, '').replace(/'$/, ''));
        forms.push({
          source: 'pre-approval',
          reference: rpClean(link ? link.textContent : (hidden ? hidden.value : '')) || (hidden ? hidden.value : ''),
          tableId: 'Table',
          rowText: cells.join(' | '),
          cells,
          type: cells[2] || '',
          claimType: '',
          date: cells[1] || '',
          code: args[5] || '',
          onclick,
          args,
          href: '',
        });
      }
    }

    // جدول 2: Claims
    const t2 = document.querySelector('#Table2');
    if (t2) {
      for (const tr of t2.querySelectorAll('tbody tr')) {
        const link = tr.querySelector('a.hyperLink');
        if (!link) continue;
        const cells = [...tr.querySelectorAll('td')].map((td) => rpClean(td.textContent));
        const href = link.getAttribute('href') || '';
        forms.push({
          source: 'claim',
          reference: rpClean(link.textContent),
          tableId: 'Table2',
          rowText: cells.join(' | '),
          cells,
          ndClaimId: rpClean(link.textContent),
          code: cells[2] || '',
          claimType: cells[3] || '',
          type: cells[3] || '',
          date: cells[4] || '',
          status: cells[5] || '',
          href,
          raw: href,
        });
      }
    }

    const phoneEl = document.querySelector('.NDClaimIDResult');
    const phone = phoneEl ? rpClean(phoneEl.textContent) : '';
    const nameEl = document.querySelector('.BeneficiaryName, .beneficiary-name, h4.mb-0');
    const name = nameEl ? rpClean(nameEl.textContent) : '';

    // قراءة innerText بتجبر الصفحة تحسب Layout كامل — بنعملها بس لما مفيش نتائج
    const emptyMsg = forms.length ? '' : rpClean(document.body.innerText || '').slice(0, 400);
    return { forms, phone, name, emptyMsg, url: location.href };
  };
`;

const PARSE_RESULTS_SCRIPT = `(() => {
  ${PARSE_FN_SRC}
  return rpParse();
})()`;

// ---------------------------------------------------------------------------
// البحث الكامل في نداء واحد: باير → إغلاق → تنظيف الجداول → الساب → Search → ثبات النتائج
// ---------------------------------------------------------------------------
const fastSearchScript = ({ sab, payerId, payerName, timeoutMs = 15000, emptyWaitMs = 3500 }) => `(async () => {
  ${HELPERS}
  ${PARSE_FN_SRC}

  const wantSab = ${JSON.stringify(String(sab))};
  const wantPayer = ${JSON.stringify(String(payerId || ""))};
  const wantPayerName = ${JSON.stringify(String(payerName || "").trim())};
  const timeout = ${Number(timeoutMs)};
  const emptyWait = ${Number(emptyWaitMs)};

  const t0 = performance.now();
  const timings = {};

  // 1) الصفحة جاهزة؟
  const codeInput = await rpWait(() => document.querySelector('#SearchCode'), timeout);
  if (!codeInput) return { ok: false, error: 'PRECONDITION', message: 'خانة الساب (#SearchCode) غير موجودة — الصفحة لسه بتحمل أو الجلسة انتهت' };

  // 2) الباير
  let payer = { ok: false, reason: 'no-select' };
  const sel = document.querySelector('#payerId');
  if (sel) {
    const opts = [...sel.options];
    const opt = (wantPayer && opts.find((o) => o.value === wantPayer)) || (wantPayerName && opts.find((o) => (o.textContent || '').trim() === wantPayerName));
    if (opt && sel.value === opt.value) {
      // الباير مختار فعلًا — تغييره بيعمل reload للقائمة وبيضيّع وقت
      payer = { ok: true, value: opt.value, text: (opt.textContent || '').trim(), skipped: true };
    } else if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.jQuery) { try { window.jQuery(sel).val(opt.value).trigger('change'); } catch (e) {} }
      payer = { ok: true, value: opt.value, text: (opt.textContent || '').trim() };
    } else {
      payer = { ok: false, reason: 'no-option', options: opts.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })) };
    }
  }

  // 3) إغلاق أي نافذة منبثقة (بأسرع شكل: مفيش انتظار)
  const closers = [...document.querySelectorAll('.close-icon, .modal.show [data-bs-dismiss="modal"], [data-bs-dismiss="modal"]')];
  const closer = closers.find(rpVisible);
  if (closer) closer.click();

  // 4) تنظيف نتائج الساب السابق قبل البحث (أسرع وأأمن من إعادة تحميل الصفحة)
  const clearTables = () => {
    try {
      const jq = window.jQuery;
      if (jq && jq.fn && jq.fn.dataTable && jq.fn.dataTable.isDataTable) {
        let used = false;
        for (const id of ['#Table', '#Table2']) {
          if (jq.fn.dataTable.isDataTable(id)) {
            jq(id).DataTable().clear().draw(false);
            used = true;
          }
        }
        if (used) return 'datatables';
      }
    } catch (e) { /* تجاهل */ }
    for (const tb of document.querySelectorAll('#Table tbody, #Table2 tbody')) tb.innerHTML = '';
    return 'dom';
  };
  timings.clear = clearTables();

  // 5) كتابة الساب
  const codeEl = document.querySelector('#SearchCode');
  codeEl.focus();
  codeEl.value = wantSab;
  codeEl.dispatchEvent(new Event('input', { bubbles: true }));
  codeEl.dispatchEvent(new Event('change', { bubbles: true }));
  if (window.jQuery) { try { window.jQuery(codeEl).val(wantSab).trigger('change'); } catch (e) {} }

  // 6) زرار البحث
  const btn = document.querySelector('#SearchId');
  if (!btn) return { ok: false, error: 'PRECONDITION', message: 'زرار البحث (#SearchId) غير موجود' };

  window.__rpRowSig = null;
  window.__rpRowSeenAt = null;
  window.__rpSearch = { sab: wantSab, startedAt: Date.now() };
  btn.click();
  timings.searchClickMs = Math.round(performance.now() - t0);

  // 7) انتظار النتائج: انتهاء طلب الجدول (ajaxComplete) + ثبات عدد الصفوف وآخر صف
  //    مفيش انتظار أعمى، ومفيش مقارنة innerHTML كامل في كل frame.
  let ajaxDone = 0;
  let canWatchAjax = Boolean(window.jQuery && window.jQuery.fn);
  const onAjax = () => {
    ajaxDone += 1;
  };
  if (canWatchAjax) {
    try {
      window.jQuery(document).on('ajaxComplete.rpSearch', onAjax);
    } catch (e) {
      canWatchAjax = false;
    }
  }

  const clickAt = performance.now();
  const rowCount = () => document.querySelectorAll('#Table tbody tr, #Table2 tbody tr').length;
  const lastRowSig = () => {
    const tr =
      document.querySelector('#Table2 tbody tr:last-child') ||
      document.querySelector('#Table tbody tr:last-child');
    if (!tr) return '';
    const a = tr.querySelector('a.hyperLink');
    return ((a ? a.textContent : '') || tr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  };
  const emptyShown = () => document.querySelector('#Table .dataTables_empty, #Table2 .dataTables_empty');

  window.__rpRowSig = '';
  window.__rpStableAt = 0;
  window.__rpEmptyAt = 0;

  const settled = await rpWait(() => {
    const n = rowCount();
    const now = performance.now();
    // عرفنا إن الطلب خلص؟ (أو مفيش jQuery نراقبه، أو اتأخر زيادة عن اللزوم)
    const ready = ajaxDone > 0 || !canWatchAjax || now - clickAt > 800;
    if (!ready) return false;

    if (n === 0) {
      if (emptyShown()) return 'empty';
      if (!window.__rpEmptyAt) window.__rpEmptyAt = now;
      const grace = canWatchAjax ? 300 : emptyWait;
      return now - window.__rpEmptyAt > grace ? 'empty' : false;
    }

    const sig = n + '|' + lastRowSig();
    if (window.__rpRowSig !== sig) {
      window.__rpRowSig = sig;
      window.__rpStableAt = now;
      return false;
    }
    return now - (window.__rpStableAt || now) >= 80 ? 'rows' : false;
  }, timeout);

  if (canWatchAjax) {
    try {
      window.jQuery(document).off('ajaxComplete.rpSearch', onAjax);
    } catch (e) { /* تجاهل */ }
  }

  const parsed = rpParse();
  timings.totalMs = Math.round(performance.now() - t0);
  timings.rows = parsed.forms.length;

  return {
    ok: true,
    ...parsed,
    settled: Boolean(settled),
    settle: settled || '',
    ajax: ajaxDone,
    payer,
    timings,
  };
})()`;

// ---------------------------------------------------------------------------
// قراءة سريعة بدون بحث (لو الصفحة الحالية عليها نتائج الساب نفسه)
// ---------------------------------------------------------------------------
const quickParseScript = `(() => { ${HELPERS} ${PARSE_FN_SRC} return rpParse(); })()`;

// ---------------------------------------------------------------------------
// الضغط على الرقم المرجعي
// ---------------------------------------------------------------------------
const clickReferenceScript = (reference) => `(() => {
  const target = ${JSON.stringify(String(reference))};
  for (const id of ['#Table', '#Table2']) {
    const table = document.querySelector(id);
    if (!table) continue;
    for (const tr of table.querySelectorAll('tbody tr')) {
      const link = tr.querySelector('a.hyperLink');
      if (!link) continue;
      if ((link.textContent || '').trim() === target) {
        link.click();
        return id;
      }
    }
  }
  return '';
})()`;

// ---------------------------------------------------------------------------
// انتظار الصورة والتقاطها (Promise بيتحل أول ما الصورة تحمّل)
// ---------------------------------------------------------------------------
const captureImageScript = ({ timeoutMs = 12000, minSide = 180, maxWidth = 1600, quality = 0.84 } = {}) => `(async () => {
  ${HELPERS}

  // أكبر صورة بدون sort: لفة واحدة على document.images في كل frame
  const pickLargest = () => {
    let best = null;
    let bestArea = 0;
    for (const img of document.images) {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (w < ${Number(minSide)} || h < ${Number(minSide)}) continue;
      if (!img.complete) continue;
      const area = w * h;
      if (area > bestArea) {
        bestArea = area;
        best = img;
      }
    }
    return best;
  };

  const t0 = performance.now();
  const img = await rpWait(pickLargest, ${Number(timeoutMs)});

  // انتظار فك الترميز الفعلي بدل sleep عشوائي
  if (img) {
    try {
      if (img.decode) await img.decode();
    } catch (e) { /* مفيش فك ترميز — بنكمل بالصورة المحمّلة */ }
  }

  if (!img) {
    const anyImg = [...document.images].some((i) => (i.naturalWidth || 0) > 40);
    return { failed: true, reason: anyImg ? 'small-or-loading' : 'no-image', ms: Math.round(performance.now() - t0) };
  }

  const src = img.currentSrc || img.src;
  const size = { width: img.naturalWidth, height: img.naturalHeight };

  // 1) canvas — بنعيد الترميز JPEG بجودة عالية: أوضح من كفاية وأسرع بكتير في النقل
  try {
    const maxW = ${Number(maxWidth)};
    const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL('image/jpeg', ${Number(quality)});
    if (!dataUrl || dataUrl.length < 3000) dataUrl = canvas.toDataURL('image/png');
    if (dataUrl && dataUrl.length > 2000) {
      return {
        ...size,
        scaled: canvas.width !== img.naturalWidth,
        dataUrl,
        src,
        method: scale < 1 ? 'canvas-jpeg-scaled' : 'canvas-jpeg',
        ms: Math.round(performance.now() - t0),
      };
    }
  } catch (e) { /* الصورة محمية (tainted) */ }

  // 2) fetch بنفس الكوكيز
  try {
    const res = await fetch(src, { credentials: 'include' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob && blob.size > 1500) {
        const dataUrl = await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => resolve(null);
          fr.readAsDataURL(blob);
        });
        if (dataUrl) return { ...size, dataUrl, src, method: 'fetch', ms: Math.round(performance.now() - t0) };
      }
    }
  } catch (e) { /* تجاهل */ }

  // 3) خلفية العنصر
  try {
    const bg = getComputedStyle(img).backgroundImage;
    if (bg && bg.startsWith('url(')) {
      const bgUrl = bg.slice(5, -2).replace(/["']/g, '');
      const res = await fetch(bgUrl, { credentials: 'include' });
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.readAsDataURL(blob);
        });
        if (dataUrl) return { ...size, dataUrl, src: bgUrl, method: 'background', ms: Math.round(performance.now() - t0) };
      }
    }
  } catch (e) { /* تجاهل */ }

  return { failed: true, reason: 'protected', src, ...size, ms: Math.round(performance.now() - t0) };
})()`;

// ---------------------------------------------------------------------------
// الإرجاع (Delete) — ضغطة واحدة بدون انتظار
// ---------------------------------------------------------------------------
const CLICK_DELETE_SCRIPT = `(() => {
  window.confirm = () => true;
  window.alert = () => {};
  const btn = document.querySelector('#btn-DeleteClaim');
  if (!btn) return 'no-button';
  const r = btn.getBoundingClientRect();
  const st = getComputedStyle(btn);
  if (r.width === 0 && r.height === 0) return 'hidden';
  if (st.visibility === 'hidden' || st.display === 'none') return 'hidden';
  btn.click();
  return 'clicked';
})()`;

const HAS_DELETE_SCRIPT = `!!document.querySelector('#btn-DeleteClaim')`;

/** يستنى انتهاء كل طلبات jQuery/ajax في الصفحة (تأكيد إن العملية خلصت فعلًا) */
const WAIT_AJAX_IDLE_SCRIPT = (timeoutMs = 6000) => `(async () => {
  ${HELPERS}
  const jq = window.jQuery;
  if (!jq || typeof jq.active !== 'number') return 'no-jquery';
  const idle = await rpWait(() => (jq.active === 0 ? 'idle' : null), ${Number(timeoutMs)});
  return idle || 'timeout';
})()`;

/** هل الصفحة اتحولت لشاشة الدخول؟ (الجلسة انتهت في نايس دير) */
const SESSION_CHECK_SCRIPT = `(() => {
  if (document.querySelector('#SearchCode')) return 'ok';
  if (document.querySelector('#UserName, #passwordInput, #loginBTN')) return 'logged-out';
  const body = (document.body && document.body.innerText) || '';
  if (/تسجيل الدخول|Sign in|Login/i.test(body.slice(0, 400)) && !document.querySelector('#Table, #Table2')) return 'logged-out';
  return 'unknown';
})()`;

/** نتيجة الإرجاع: هل الزرار اختفى/ظهرت رسالة نجاح بعد الضغط؟ */
const DELETE_OUTCOME_SCRIPT = `(() => {
  const btn = document.querySelector('#btn-DeleteClaim');
  const body = (document.body && document.body.innerText) || '';
  const success = /تم الحذف|تم الإرجاع|تم الالغاء|تم الإلغاء|deleted successfully|success/i.test(body.slice(0, 4000));
  const error = /خطأ|error|لا يمكن|غير مسموح|can not|cannot/i.test(body.slice(0, 4000));
  if (success && !error) return 'confirmed';
  if (error && !success) return 'error';
  if (!btn) return 'confirmed';
  return 'unknown';
})()`;

/** Promise بيتحل أول ما السلكتور يظهر */
const waitForSelectorScript = (selector, timeoutMs = 8000) => `(async () => {
  ${HELPERS}
  const el = await rpWait(() => document.querySelector(${JSON.stringify(String(selector))}), ${Number(timeoutMs)});
  return Boolean(el);
})()`;

const CLOSE_MODAL_SCRIPT = `(() => {
  const cands = [...document.querySelectorAll('.close-icon, .modal.show [data-bs-dismiss="modal"], [data-bs-dismiss="modal"]')];
  const visible = cands.find((el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  });
  if (visible) { visible.click(); return true; }
  return false;
})()`;

const FIND_IMAGE_LINK_SCRIPT = `(() => {
  const cands = [...document.querySelectorAll('a, button, img')];
  const hit = cands.find((el) => /PrescriptionImgs|Prescription\\s*Img|صورة\\s*الروشتة|view\\s*image/i.test((el.getAttribute('href') || '') + ' ' + (el.textContent || '') + ' ' + (el.getAttribute('alt') || '')));
  if (!hit) return '';
  return hit.getAttribute('href') || 'click';
})()`;

const PAGE_STATE_SCRIPT = `(() => ({
  url: location.href,
  hasCode: !!document.querySelector('#SearchCode'),
  hasLogin: !!document.querySelector('#UserName, #passwordInput, #loginBTN'),
  hasDelete: !!document.querySelector('#btn-DeleteClaim'),
  hasRows: document.querySelectorAll('#Table tbody tr, #Table2 tbody tr').length,
  refs: [...document.querySelectorAll('#Table tbody td:first-child a.hyperLink, #Table2 tbody td.dt-type-numeric a.hyperLink')]
    .map((a) => (a.textContent || '').trim())
    .filter(Boolean)
    .slice(0, 300),
  markedSab: window.__rpSearch ? window.__rpSearch.sab : '',
  title: document.title,
}))()`;

// ---------------------------------------------------------------------------
// واتساب
// ---------------------------------------------------------------------------
const WA_STATE_SCRIPT = `(() => {
  if (document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]')) return 'ready';
  if (document.querySelector('canvas')) return 'qr';
  return 'loading';
})()`;

const WA_SEND_SCRIPT = `(async () => {
  ${HELPERS}
  const findSend = () => {
    const sels = [
      '[data-testid="send"]',
      'button[aria-label="Send"]',
      'button[aria-label="إرسال"]',
      'span[data-icon="send"]',
      'span[data-icon="wds-ic-send-filled"]',
      '[data-icon="send"]',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el) return el.closest('button') || el;
    }
    return null;
  };
  const bodyText = () => document.body.innerText || '';
  const started = performance.now();
  const btn = await rpWait(() => {
    if (/invalid|غير صالح|phone number shared via url is invalid/i.test(bodyText())) return 'invalid';
    return findSend();
  }, 12000);
  if (btn === 'invalid') return { ok: false, error: 'رقم الواتساب غير صالح أو غير مسجل' };
  if (!btn) return { ok: false, error: 'زرار الإرسال لم يظهر — تأكد إن واتساب متصل' };
  btn.click();
  return { ok: true, ms: Math.round(performance.now() - started) };
})()`;

const WA_LAST_REPLIES_SCRIPT = `(() => {
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const bubbles = [...document.querySelectorAll('div.message-in, div.message-out, [data-testid="msg-container"]')];
  if (!bubbles.length) return [];
  const out = [];
  for (const b of bubbles.slice(-40)) {
    const incoming = b.classList.contains('message-in') || Boolean(b.querySelector('[data-testid="tail-in"]'));
    const txtEl = b.querySelector('span.selectable-text, [data-testid="msg-text"]');
    const txt = txtEl ? clean(txtEl.textContent) : '';
    if (!txt) continue;
    out.push({ text: txt, incoming });
  }
  return out;
})()`;

module.exports = {
  waitForSelectorScript,
  fastSearchScript,
  quickParseScript,
  clickReferenceScript,
  captureImageScript,
  CLICK_DELETE_SCRIPT,
  HAS_DELETE_SCRIPT,
  WAIT_AJAX_IDLE_SCRIPT,
  SESSION_CHECK_SCRIPT,
  DELETE_OUTCOME_SCRIPT,
  CLOSE_MODAL_SCRIPT,
  FIND_IMAGE_LINK_SCRIPT,
  PAGE_STATE_SCRIPT,
  PARSE_RESULTS_SCRIPT,
  WA_STATE_SCRIPT,
  WA_SEND_SCRIPT,
  WA_LAST_REPLIES_SCRIPT,
};
