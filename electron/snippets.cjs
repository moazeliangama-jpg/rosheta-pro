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
  /**
   * الانتظار بيتعمل بمؤقت (setTimeout) مش بـ requestAnimationFrame.
   *
   * ليه؟ لأن rAF بيستنى «فريم» من محرّك الرسم، والنوافذ اللي بتفتح في الخلفية
   * (أو اللي المتصفح بيعتبرها مخفية/مغطاة) مابتدّيش فريمات خالص — فكل استنى
   * كان بيعلّق لحد المهلة ويرجع فاضي. ده كان سبب إن النوافذ «بتفتح ومش بتعمل
   * أي خطوة». المؤقتات بتشتغل عادي لأن backgroundThrottling: false.
   */
  const rpWait = (pred, timeout) => new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      let value = null;
      try { value = pred(); } catch (e) { value = null; }
      if (value) { resolve(value); return; }
      if (performance.now() - started >= timeout) { resolve(null); return; }
      setTimeout(tick, 40);
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

  /**
   * كل صفوف الجدول — **مش بس الصفحة الظاهرة**.
   *
   * جداول نايس دير DataTables، ولو الساب عنده أكتر من صفحة استمارات كان
   * الجرد بيقرا الصفوف المعروضة بس (١٠ صفوف) — يعني عدد استمارات ناقص من
   * غير أي رسالة خطأ. هنا بنطلب كل الصفوف من الـAPI نفسه.
   */
  const rpRows = (table) => {
    if (!table) return [];
    try {
      const jq = window.jQuery;
      if (jq && jq.fn && jq.fn.dataTable && jq.fn.dataTable.isDataTable) {
        const sel = table.id ? '#' + table.id : null;
        if (sel && jq.fn.dataTable.isDataTable(sel)) {
          const dt = jq(sel).DataTable();
          // عرض كل الصفوف (لو الجدول مقسّم صفحات على العميل) وبعدها نقرا الكل
          try { dt.page.len(-1).draw(false); } catch (e) { /* مش مشكلة */ }
          let nodes = [];
          try { nodes = [...dt.rows({ search: 'applied' }).nodes()]; } catch (e) { nodes = []; }
          const trs = nodes.filter((n) => n && n.tagName === 'TR');
          if (trs.length) return trs;
        }
      }
    } catch (e) { /* نكمل بالـDOM */ }
    return [...table.querySelectorAll('tbody tr')];
  };

  const rpParse = () => {
    const forms = [];

    // جدول 1: Pre-Approvals
    const t1 = document.querySelector('#Table');
    if (t1) {
      for (const tr of rpRows(t1)) {
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
      for (const tr of rpRows(t2)) {
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

  // 0) لو الصفحة رجعت لفورم الدخول: الجلسة انتهت — بنقولها صريح بدل مهلة فاضية
  if (document.querySelector('#UserName, #passwordInput')) {
    return { ok: false, error: 'NEED_LOGIN', message: 'انتهت الجلسة — الصفحة رجعت لتسجيل الدخول في نافذة نايس دير' };
  }

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
  // بنسجّل الصور اللي موجودة قبل الضغط، عشان اللي بيظهر بعده بالظبط هو الروشتة
  try {
    window.__rpImgsBefore = [...document.images].map((i) => i.currentSrc || i.src || '');
    window.__rpModalBefore = Boolean(document.querySelector('.modal.show, [role=dialog], .fancybox-container, .offcanvas.show'));
  } catch (e) { window.__rpImgsBefore = []; window.__rpModalBefore = false; }
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

  const MIN = ${Number(minSide)};
  const t0 = performance.now();

  // بنلم الصور من الصفحة الرئيسية + أي iframe من نفس الأصل (صفحة الروشتة
  // ممكن تحط الصورة جوه فريم أو viewer)، وأي canvas كبير.
  const collect = () => {
    const images = [];
    const canvases = [];
    let frames = 0;
    let embeds = 0;
    const walk = (doc, depth) => {
      if (!doc || depth > 2) return;
      for (const img of doc.images || []) {
        images.push({ kind: 'img', el: img, w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
      }
      for (const c of doc.querySelectorAll('canvas')) {
        if ((c.width || 0) >= MIN && (c.height || 0) >= MIN) canvases.push({ kind: 'canvas', el: c, w: c.width, h: c.height });
      }
      for (const e of doc.querySelectorAll('embed, object')) embeds += 1;
      for (const f of doc.querySelectorAll('iframe')) {
        frames += 1;
        try {
          if (f.contentDocument) walk(f.contentDocument, depth + 1);
        } catch (e) { /* فريم من أصل تاني — مقدرناش ندخل */ }
      }
    };
    walk(document, 0);
    return { images, canvases, frames, embeds };
  };

  const pickBest = () => {
    const found = collect();
    let best = null;
    let bestArea = 0;
    for (const item of [...found.images, ...found.canvases]) {
      if (item.w < MIN || item.h < MIN) continue;
      if (item.kind === 'img' && !item.el.complete) continue;
      const area = item.w * item.h;
      if (area > bestArea) {
        bestArea = area;
        best = item;
      }
    }
    return best;
  };

  const best = await rpWait(pickBest, ${Number(timeoutMs)});

  if (best && best.kind === 'img') {
    try {
      if (best.el.decode) await best.el.decode();
    } catch (e) { /* بنكمل بالصورة المحمّلة */ }
  }

  const snapshot = collect();
  const diag = {
    images: snapshot.images.length,
    frames: snapshot.frames,
    canvases: snapshot.canvases.length,
    embeds: snapshot.embeds,
    maxW: Math.max(0, ...snapshot.images.map((i) => i.w)),
    maxH: Math.max(0, ...snapshot.images.map((i) => i.h)),
    minSide: MIN,
    url: location.href,
    title: document.title,
  };

  if (!best) {
    return { failed: true, reason: snapshot.images.length || snapshot.canvases.length ? 'small-or-loading' : 'no-image', diag, ms: Math.round(performance.now() - t0) };
  }

  const size = { width: best.w, height: best.h };

  // 1) canvas مباشرة
  if (best.kind === 'canvas') {
    try {
      const dataUrl = best.el.toDataURL('image/jpeg', ${Number(quality)});
      if (dataUrl && dataUrl.length > 2000) {
        return { ...size, dataUrl, method: 'canvas-element', diag, ms: Math.round(performance.now() - t0) };
      }
    } catch (e) { /* الكانفس محمي */ }
  }

  const img = best.el;
  const src = (img.currentSrc || img.src || '').toString();

  // 2) إعادة رسم على canvas — أوضح وأصغر من الصورة الأصلية
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
        diag,
        ms: Math.round(performance.now() - t0),
      };
    }
  } catch (e) { /* الصورة محمية (tainted) */ }

  // 3) fetch بنفس الكوكيز
  if (src) {
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
          if (dataUrl) return { ...size, dataUrl, src, method: 'fetch', diag, ms: Math.round(performance.now() - t0) };
        }
      }
    } catch (e) { /* تجاهل */ }
  }

  // 4) خلفية العنصر
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
          fr.onerror = () => resolve(null);
          fr.readAsDataURL(blob);
        });
        if (dataUrl) return { ...size, dataUrl, src: bgUrl, method: 'background', diag, ms: Math.round(performance.now() - t0) };
      }
    }
  } catch (e) { /* تجاهل */ }

  // 5) الصفحة فيها PDF مدمج؟ (مفيش <img> نلقطه — محتاجين لقطة شاشة)
  if (!src && diag.embeds > 0) {
    return { failed: true, reason: 'pdf-embed', diag, ms: Math.round(performance.now() - t0) };
  }

  return { failed: true, reason: 'protected', src, ...size, diag, ms: Math.round(performance.now() - t0) };
})()`;

/**
 * التقاط صورة الروشتة اللي بتظهر **جوه نفس الصفحة** بعد الضغط على الرقم المرجعي
 * (مودال / أوفرلاي / صورة اتضافت في الصفحة بدون تنقّل).
 *
 * ليه ده مهم؟ لأن الاعتماد على «نافذة منبثقة» أو «تنقّل» بس مش كفاية: بعض
 * استمارات نايس دير بتفتح الروشتة في مودال في نفس الصفحة، وساعتها ما كانش
 * فيه أي مسار بيلقط الصورة → قرار «صورة الروشتة لم تُلتقط».
 *
 * الشرط متعمّد إنه ضيّق: الصورة لازم تكون **جديدة بعد الضغط** أو جوه مودال ظاهر،
 * وحجمها معقول — عشان ما نرجعش لوجو الصفحة ونقول عليه روشتة.
 */
const captureNewImageScript = ({ timeoutMs = 9000, minSide = 260, maxWidth = 1600, quality = 0.86 } = {}) => `(async () => {
  ${HELPERS}
  const MIN = ${Number(minSide)};
  const t0 = performance.now();
  const before = new Set(window.__rpImgsBefore || []);

  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 60 && r.height > 60 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity || 1) > 0.1;
  };
  const inModal = (el) => {
    try {
      return Boolean(el.closest('.modal, .modal-dialog, [role="dialog"], .fancybox-container, .swal2-container, .offcanvas, .lightbox, .mfp-content'));
    } catch (e) { return false; }
  };

  const pick = () => {
    const imgs = [...document.images];
    let best = null;
    let bestArea = 0;
    for (const img of imgs) {
      const src = img.currentSrc || img.src || '';
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (w < MIN || h < MIN) continue;
      if (!img.complete) continue;
      const fresh = src && !before.has(src);
      const modalNow = inModal(img) && visible(img);
      if (!fresh && !modalNow) continue;
      const area = w * h;
      if (area > bestArea) { bestArea = area; best = img; }
    }
    if (best) return { kind: 'img', el: best, w: best.naturalWidth, h: best.naturalHeight };

    for (const c of document.querySelectorAll('canvas')) {
      if ((c.width || 0) < MIN || (c.height || 0) < MIN) continue;
      if (!inModal(c) && !visible(c)) continue;
      return { kind: 'canvas', el: c, w: c.width, h: c.height };
    }
    return null;
  };

  const found = await rpWait(pick, ${Number(timeoutMs)});
  if (!found) {
    return { failed: true, reason: 'no-new-image', diag: { images: document.images.length, url: location.href } };
  }

  if (found.kind === 'canvas') {
    try {
      const dataUrl = found.el.toDataURL('image/jpeg', ${Number(quality)});
      if (dataUrl && dataUrl.length > 2000) {
        return { dataUrl, width: found.w, height: found.h, method: 'canvas-inline', ms: Math.round(performance.now() - t0) };
      }
    } catch (e) { /* محمي */ }
  }

  const img = found.el;
  const src = (img.currentSrc || img.src || '').toString();
  try {
    if (img.decode) await img.decode();
  } catch (e) { /* بنكمل */ }

  // ١) رسم على canvas (بيشتغل مع أغلب الصور)
  try {
    const maxW = ${Number(maxWidth)};
    const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL('image/jpeg', ${Number(quality)});
    if (!dataUrl || dataUrl.length < 3000) dataUrl = canvas.toDataURL('image/png');
    if (dataUrl && dataUrl.length > 2000) {
      return {
        dataUrl,
        width: found.w,
        height: found.h,
        src,
        method: 'inline-canvas',
        ms: Math.round(performance.now() - t0),
      };
    }
  } catch (e) { /* الصورة محمية (tainted) — بنجيبها من الشبكة */ }

  // ٢) نفس الصورة من الشبكة بنفس الكوكيز (بيحصل في main عبر fetchImageViaSession)
  if (src) return { srcUrl: src, width: found.w, height: found.h, ms: Math.round(performance.now() - t0) };

  return { failed: true, reason: 'protected', diag: { images: document.images.length } };
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

/**
 * ١١٩/١٢٠) فحص السلكتورات على الموقع الحقيقي.
 * بيرجّع كل سلكتور مهم: موجود ولا لأ — عشان لو نايس دير غيّر الصفحة نعرف فورًا.
 */
const PROBE_SELECTORS_SCRIPT = `(() => {
  const list = [
    ['#SearchCode', 'خانة الساب', false],
    ['#SearchId', 'زرار البحث', false],
    ['#payerId', 'قائمة الباير', false],
    ['#Table', 'جدول Pre-Approvals', false],
    ['#Table2', 'جدول Claims', false],
    ['.NDClaimIDResult', 'تليفون المستفيد', true],
    ['#btn-DeleteClaim', 'زرار الإرجاع (صفحة الاستمارة)', true],
    ['.close-icon', 'إغلاق النافذة المنبثقة', true],
  ];
  const results = list.map(([selector, label, optional]) => ({
    selector,
    label,
    optional,
    found: Boolean(document.querySelector(selector)),
  }));
  return {
    page: location.href,
    title: document.title,
    hasJQuery: Boolean(window.jQuery),
    results,
    missing: results.filter((r) => !r.found && !r.optional).map((r) => r.selector),
  };
})()`;

/** هل الصفحة اتحولت لشاشة الدخول؟ (الجلسة انتهت في نايس دير) */
const SESSION_CHECK_SCRIPT = `(() => {
  if (document.querySelector('#SearchCode')) return 'ok';
  if (document.querySelector('#UserName, #passwordInput, #loginBTN')) return 'logged-out';
  const body = (document.body && document.body.innerText) || '';
  if (/تسجيل الدخول|Sign in|Login/i.test(body.slice(0, 400)) && !document.querySelector('#Table, #Table2')) return 'logged-out';
  return 'unknown';
})()`;

/**
 * جلب رابط **جوه الصفحة نفسها** — نفس الأصل يعني نفس الكوكيز والـreferer
 * ومن غير مشاكل CORS اللي بتضيّع الصورة لما تكون محمية.
 * بيرجّع الصورة كـdataURL، أو نص HTML لو الرابط صفحة مش صورة.
 */
const FETCH_IN_PAGE_SCRIPT = (url, { maxBytes = 8000000 } = {}) => `(async () => {
  ${HELPERS}
  const MAX = ${Number(maxBytes)};
  const target = ${JSON.stringify(String(url))};
  let res;
  try {
    res = await fetch(target, { credentials: 'include', cache: 'no-store' });
  } catch (e) {
    return { failed: true, reason: 'cors-or-network', message: String(e && e.message || e) };
  }
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok) {
    // بعض السيرفرات بترفض fetch من غير referer — بنجرب XHR ملوش داعي، بنرجّع السبب
    return { failed: true, reason: 'http-' + res.status, type, status: res.status };
  }
  let blob;
  try {
    blob = await res.blob();
  } catch (e) {
    return { failed: true, reason: 'read-failed', type };
  }
  if (!blob || !blob.size) return { failed: true, reason: 'empty', type };
  if (blob.size > MAX) return { failed: true, reason: 'too-large', type, size: blob.size };

  if (!/^image[\/]/.test(type)) {
    let text = '';
    try { text = await blob.text(); } catch (e) { text = ''; }
    return { type, size: blob.size, text: text.slice(0, 400000) };
  }

  const dataUrl = await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => resolve('');
    fr.readAsDataURL(blob);
  });
  if (!dataUrl || dataUrl.length < 200) return { failed: true, reason: 'decode-failed', type, size: blob.size };
  return { type, size: blob.size, dataUrl };
})()`;

/**
 * تشخيص صفحة الدخول: إيه اللي ظاهر فعلاً (فورم / داخل / تحقق بشري / رسالة رفض).
 * بيرجّع بيانات خام، والتصنيف بيحصل في rx-page.cjs عشان يبقى متاختبر.
 */
const LOGIN_PROBE_SCRIPT = `(() => {
  const txt = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  };
  const errors = ['.validation-summary-errors', '.alert-danger', '.text-danger', '.field-validation-error', '.validation-message', '#loginError', '.toast-error']
    .map(txt)
    .filter((t) => t.length > 2);
  let body = '';
  try { body = (document.body && document.body.innerText) || ''; } catch (e) { body = ''; }
  const head = (document.title || '') + ' ' + body.slice(0, 400);
  const challenge = Boolean(
    document.querySelector('#challenge-form, #cf-challenge-running, .cf-turnstile, iframe[src*="challenge"], #challenge-stage, #captcha') ||
    /just a moment|checking your browser|verify you are human|attention required|please wait\.\.\./i.test(head)
  );
  return {
    url: location.href,
    title: document.title || '',
    hasUser: Boolean(document.querySelector('#UserName')),
    hasPass: Boolean(document.querySelector('#passwordInput')),
    hasBtn: Boolean(document.querySelector('#loginBTN')),
    hasCode: Boolean(document.querySelector('#SearchCode')),
    errorText: errors.join(' | '),
    challenge,
    bodySnippet: body.replace(/\s+/g, ' ').trim().slice(0, 300),
  };
})()`;

/** نتيجة الإرجاع: هل الزرار اختفى/ظهرت رسالة نجاح بعد الضغط؟ */
/**
 * «Manage Documents» جوه صفحة الروشتة (`PrescriptionImgs`).
 * الزرار اللي في الموقع شكله:
 *   <button onclick="ManageDocument()"> Manage Documents </button>
 * بنضغطه على الصفحة الحقيقية — مفيش أي تنفيذ يدوي للدالة من برّه.
 */
const CLICK_MANAGE_DOCS_SCRIPT = `(() => {
  const sig = (el) => ((el.getAttribute && el.getAttribute('onclick')) || '') + ' ' + ((el.textContent || '').replace(/\\s+/g, ' ').trim());
  const cands = [...document.querySelectorAll('button, a, div[role="button"], span[role="button"]')];
  const hit = cands.find((el) => /ManageDocument/i.test(sig(el)) || /Manage\\s*Documents/i.test(el.textContent || ''));
  if (!hit) return 'not-found';
  hit.click();
  return 'clicked';
})()`;

/**
 * أيقونة تنزيل الروشتة (`i.Ndcolor.fa.fa-download`).
 * لو الأيقونة جوّه لينك فيه الرابط النهائي بنرجّعه على طول (أسرع وأدق)،
 * وإلا بنضغط على أقرب عنصر قابل للضغط — والرابط بيتلقط من الشبكة/النافذة الجديدة.
 */
const CLICK_DOWNLOAD_DOC_SCRIPT = `(() => {
  const okUrl = (u) => /^https?:\\/\\//i.test(u || '') && (/storage\\.googleapis\\.com/i.test(u) || /\\.(jpe?g|png|webp|gif|pdf)(\\?|$)/i.test(u));
  const icon = document.querySelector('i.Ndcolor.fa.fa-download, i.fa-download, .fa-download');
  if (!icon) return 'not-found';
  const target = icon.closest('a, button, .k-grid-download') || icon;
  const href = target.getAttribute && (target.getAttribute('href') || '');
  if (href && okUrl(href)) return href;
  const onclick = (target.getAttribute && target.getAttribute('onclick')) || '';
  const m = onclick.match(/['"](https?:[^'"]+)['"]/);
  if (m && okUrl(m[1])) return m[1];
  target.click();
  return 'clicked';
})()`;

/** رابط الروشتة الظاهر في الصفحة (لينك أو صورة محمّلة) — احتياطي */
const DOC_LINK_SCRIPT = `(() => {
  const okUrl = (u) => /^https?:\\/\\//i.test(u || '') && (/storage\\.googleapis\\.com/i.test(u) || /Eprescreption/i.test(u) || /\\.(jpe?g|png|webp)(\\?|$)/i.test(u));
  const links = [...document.querySelectorAll('a[href]')].map((a) => a.href).filter(okUrl);
  if (links.length) return links[0];
  const imgs = [...document.images].map((i) => i.currentSrc || i.src).filter(okUrl);
  return imgs[0] || '';
})()`;

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

/**
 * إرسال رسالة واتساب + **تأكيد** إنها ظهرت فعلًا في المحادثة.
 *
 * قبل كده كان بيضغط «Send» ويرجّع نجاح على طول — لو واتساب رفض أو الصفحة
 * ما استجابتش، الرسالة كانت بتتحسب «اتبعتت» وهي ما اتبعتتش. دلوقتي النجاح
 * مش بيتقال إلا لما فقاعة الرسالة تظهر في المحادثة.
 */
const WA_SEND_SCRIPT = (text = '') => `(async () => {
  ${HELPERS}
  const expected = String(${JSON.stringify(String(text))} || '').replace(/\\s+/g, ' ').trim();
  const probe = expected.slice(0, 40);
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

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

  // التأكيد: الرسالة لازم تبان في فقاعات الصادرة بنفس النص
  const seen = await rpWait(() => {
    const bubbles = [...document.querySelectorAll('div.message-out, [data-testid="msg-container"]')];
    for (const b of bubbles.slice(-15)) {
      const t = norm(b.innerText || '');
      if (t && probe && t.includes(probe.slice(0, Math.min(probe.length, 24)))) return true;
    }
    return false;
  }, 15000);

  if (!seen) {
    const err = /couldn't send|تعذر الإرسال|failed to send|خطأ/i.test(bodyText());
    return {
      ok: false,
      verified: false,
      reason: err ? 'send-failed' : 'unverified',
      error: err ? 'واتساب رفض الإرسال' : 'الرسالة اتكتبت لكن مش ظاهرة كمرسلة — افتح واتساب وتأكد',
      ms: Math.round(performance.now() - started),
    };
  }
  return { ok: true, verified: true, ms: Math.round(performance.now() - started) };
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
  captureNewImageScript,
  CLICK_DELETE_SCRIPT,
  HAS_DELETE_SCRIPT,
  WAIT_AJAX_IDLE_SCRIPT,
  SESSION_CHECK_SCRIPT,
  LOGIN_PROBE_SCRIPT,
  FETCH_IN_PAGE_SCRIPT,
  PROBE_SELECTORS_SCRIPT,
  CLICK_MANAGE_DOCS_SCRIPT,
  CLICK_DOWNLOAD_DOC_SCRIPT,
  DOC_LINK_SCRIPT,
  DELETE_OUTCOME_SCRIPT,
  CLOSE_MODAL_SCRIPT,
  FIND_IMAGE_LINK_SCRIPT,
  PAGE_STATE_SCRIPT,
  PARSE_RESULTS_SCRIPT,
  WA_STATE_SCRIPT,
  WA_SEND_SCRIPT,
  WA_LAST_REPLIES_SCRIPT,
};
