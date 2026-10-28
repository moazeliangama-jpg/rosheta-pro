// ============================================================================
// أكواد JavaScript اللي بتتنفذ جوه صفحات نايس دير / واتساب.
// منفصلة عن main.cjs عشان تتفحص وتتاختبر بدون تشغيل Electron.
// ============================================================================

const selectPayerScript = (payerId, payerName) => `(() => {
  const sel = document.querySelector('#payerId');
  if (!sel) return { ok: false, reason: 'no-select' };
  const want = ${JSON.stringify(String(payerId || ""))};
  const name = ${JSON.stringify(String(payerName || "").trim())};
  const opts = [...sel.options];
  const opt = (want && opts.find(o => o.value === want)) || (name && opts.find(o => (o.textContent || '').trim() === name));
  if (!opt) return { ok: false, reason: 'no-option', options: opts.map(o => ({ value: o.value, text: (o.textContent || '').trim() })) };
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  if (window.jQuery) { try { window.jQuery(sel).val(opt.value).trigger('change'); } catch (e) {} }
  return { ok: true, value: opt.value, text: (opt.textContent || '').trim() };
})()`;

const CLOSE_MODAL_SCRIPT = `(() => {
  const cands = [...document.querySelectorAll('.close-icon, .modal.show [data-bs-dismiss="modal"], [data-bs-dismiss="modal"]')];
  const visible = cands.find(el => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  });
  if (visible) { visible.click(); return true; }
  return false;
})()`;

const fillCodeScript = (sab) => `(() => {
  const el = document.querySelector('#SearchCode');
  if (!el) return false;
  el.focus();
  el.value = ${JSON.stringify(String(sab))};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  if (window.jQuery) { try { window.jQuery(el).val(${JSON.stringify(String(sab))}).trigger('change'); } catch (e) {} }
  return true;
})()`;

const CLICK_SEARCH_SCRIPT = `(() => {
  const btn = document.querySelector('#SearchId');
  if (!btn) return false;
  btn.click();
  return true;
})()`;

const PARSE_RESULTS_SCRIPT = `(() => {
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const forms = [];

  // جدول 1: Pre-Approvals
  const t1 = document.querySelector('#Table');
  if (t1) {
    for (const tr of t1.querySelectorAll('tbody tr')) {
      const hidden = tr.querySelector('input[name="approval.PreApprovalId"]');
      const link = tr.querySelector('a.hyperLink');
      if (!link && !hidden) continue;
      const cells = [...tr.querySelectorAll('td')].map(td => clean(td.textContent));
      const onclick = link ? (link.getAttribute('onclick') || '') : '';
      const argsMatch = onclick.match(/CreatePreApprovalEprescription\\(([^)]*)\\)/);
      let args = [];
      if (argsMatch) {
        args = argsMatch[1].split(',').map(a => a.trim().replace(/^'/, '').replace(/'$/, ''));
      }
      const reference = clean(link ? link.textContent : (hidden ? hidden.value : ''));
      forms.push({
        source: 'pre-approval',
        reference: reference || (hidden ? hidden.value : ''),
        tableId: 'Table',
        rowText: cells.join(' | '),
        cells,
        type: cells[2] || '',
        claimType: '',
        date: cells[1] || '',
        code: args[5] || '',
        onclick,
        args,
        raw: onclick,
      });
    }
  }

  // جدول 2: Claims
  const t2 = document.querySelector('#Table2');
  if (t2) {
    for (const tr of t2.querySelectorAll('tbody tr')) {
      const link = tr.querySelector('a.hyperLink');
      if (!link) continue;
      const cells = [...tr.querySelectorAll('td')].map(td => clean(td.textContent));
      const href = link.getAttribute('href') || '';
      forms.push({
        source: 'claim',
        reference: clean(link.textContent),
        tableId: 'Table2',
        rowText: cells.join(' | '),
        cells,
        ndClaimId: clean(link.textContent),
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
  const phone = phoneEl ? clean(phoneEl.textContent) : '';
  const nameEl = document.querySelector('.BeneficiaryName, .beneficiary-name, h4.mb-0');
  const name = nameEl ? clean(nameEl.textContent) : '';

  const emptyMsg = clean(document.body.innerText || '').slice(0, 400);

  return { forms, phone, name, emptyMsg, url: location.href };
})()`;

const EXTRACT_IMAGE_SCRIPT = `(async () => {
  const imgs = [...document.images].filter(i => (i.naturalWidth || 0) > 200 && (i.naturalHeight || 0) > 200);
  if (!imgs.length) return null;
  imgs.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
  const img = imgs[0];

  const toData = async (url) => {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return null;
      const b = await r.blob();
      if (!b.type.startsWith('image') && b.size < 2000) return null;
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => res(null);
        fr.readAsDataURL(b);
      });
    } catch (e) { return null; }
  };

  // 1) canvas (أسرع وأدق)
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.toDataURL('image/png');
    if (d && d.length > 3000) return { dataUrl: d, src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight, method: 'canvas' };
  } catch (e) { /* الصورة من مصدر مختلف */ }

  // 2) fetch بالكوكيز
  const direct = await toData(img.currentSrc || img.src);
  if (direct) return { dataUrl: direct, src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight, method: 'fetch' };

  // 3) خلفية العنصر
  const bg = getComputedStyle(img).backgroundImage;
  if (bg && bg.startsWith('url(')) {
    const url = bg.slice(5, -2).replace(/["']/g, '');
    const d2 = await toData(url);
    if (d2) return { dataUrl: d2, src: url, method: 'background' };
  }
  return { failed: true, src: img.src, width: img.naturalWidth, height: img.naturalHeight };
})()`;

const FIND_IMAGE_LINK_SCRIPT = `(() => {
  const cands = [...document.querySelectorAll('a, button, img')];
  const hit = cands.find(el => /PrescriptionImgs|Prescription\\s*Img|صورة\\s*الروشتة|view\\s*image/i.test((el.getAttribute('href') || '') + ' ' + (el.textContent || '') + ' ' + (el.getAttribute('alt') || '')));
  if (!hit) return '';
  return hit.getAttribute('href') || 'click';
})()`;

const CLICK_DELETE_SCRIPT = `(() => {
  window.confirm = () => true;
  window.alert = () => {};
  const btn = document.querySelector('#btn-DeleteClaim');
  if (!btn) return 'no-button';
  const r = btn.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return 'hidden';
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  return 'clicked';
})()`;

const WA_STATE_SCRIPT = `(() => {
  if (document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]') || document.querySelector('header')) {
    const qr = document.querySelector('canvas[aria-label], canvas');
    if (!qr) return 'ready';
  }
  if (document.querySelector('canvas[aria-label*="scan" i], canvas[aria-label*="QR" i], canvas')) return 'qr';
  return 'loading';
})()`;

const WA_SEND_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
  const bodyText = () => (document.body.innerText || '');
  for (let i = 0; i < 45; i++) {
    if (/invalid|غير صالح|phone number shared via url is invalid/i.test(bodyText())) {
      return { ok: false, error: 'رقم الواتساب غير صالح أو غير مسجل' };
    }
    const btn = findSend();
    if (btn) {
      btn.click();
      await sleep(900);
      return { ok: true, sentAt: Date.now() };
    }
    await sleep(400);
  }
  return { ok: false, error: 'زرار الإرسال لم يظهر — تأكد إن واتساب متصل والتخزين شغال' };
})()`;

const WA_LAST_REPLIES_SCRIPT = `(() => {
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const bubbles = [...document.querySelectorAll('div.message-in, div.message-out, [data-testid="msg-container"]')];
  if (!bubbles.length) return [];
  const out = [];
  for (const b of bubbles.slice(-40)) {
    const incoming = b.classList.contains('message-in') || b.querySelector('[data-testid="tail-in"]') || b.closest('[data-testid="msg-container"]')?.querySelector('.message-in');
    const txtEl = b.querySelector('span.selectable-text, [data-testid="msg-text"]');
    const txt = txtEl ? clean(txtEl.textContent) : '';
    if (!txt) continue;
    out.push({ text: txt, incoming: Boolean(incoming) });
  }
  return out;
})()`;

const clickReferenceScript = (reference) => `(() => {
  const target = ${JSON.stringify(String(reference))};
  const tables = ['#Table', '#Table2'];
  for (const id of tables) {
    const table = document.querySelector(id);
    if (!table) continue;
    for (const tr of table.querySelectorAll('tbody tr')) {
      const link = tr.querySelector('a.hyperLink');
      if (!link) continue;
      const txt = (link.textContent || '').trim();
      if (txt === target) {
        link.scrollIntoView({ block: 'center' });
        link.click();
        return id;
      }
    }
  }
  return '';
})()`;

module.exports = {
  clickReferenceScript,
  selectPayerScript,
  CLOSE_MODAL_SCRIPT,
  fillCodeScript,
  CLICK_SEARCH_SCRIPT,
  PARSE_RESULTS_SCRIPT,
  EXTRACT_IMAGE_SCRIPT,
  FIND_IMAGE_LINK_SCRIPT,
  CLICK_DELETE_SCRIPT,
  WA_STATE_SCRIPT,
  WA_SEND_SCRIPT,
  WA_LAST_REPLIES_SCRIPT,
};
