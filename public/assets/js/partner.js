// /partner#<key>: a partner's private page. The key (in the hash, so it never reaches server logs) and the PIN
// (last 4 digits of their phone) go to /api/partner/*, which asks the database. "Remember me" keeps the PIN in this
// browser only. The QR comes from /app/qrcode.js (the one QR generator).
(() => {
  const root = document.querySelector('[data-p-gate]'); if (!root) return;
  const $ = s => document.querySelector(s), main = $('[data-p-main]'), pinForm = $('[data-p-pin]'), msg = $('[data-p-msg]');
  const token = (location.hash.match(/^#([a-f0-9]{40})$/) || [])[1] || '';
  const store = 'lc_partner_pin:' + token.slice(0, 8);
  const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STATUS = { pending: 'Waiting', approved: 'Ready to pay', paid: 'Paid', reversed: 'Refunded', rejected: 'Not counted' };
  let pin = '', data = null;

  const call = (path, body) => fetch('/api/partner/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, pin, ...body }) })
    .then(r => r.json().catch(() => ({})).then(j => ({ ok: r.ok, j })));
  const why = j => /locked/i.test(j.message || '') ? 'Too many wrong PINs. Try again in 15 minutes.'
    : /invalid link/i.test(j.message || '') ? 'This link no longer works. Ask us for a new one.'
    : j.error === 'wrong pin' ? 'That PIN is not right. It is the last 4 digits of your phone number.' : 'Could not open your page. Please try again.';

  const qr = text => { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q; };
  const render = d => {
    data = d; const p = d.partner, t = d.totals || {};
    $('[data-p-title]').textContent = 'Hi ' + String(p.name || '').split(' ')[0] + '.';
    $('[data-p-lead]').textContent = 'You earn ' + inr(p.commission) + ' for every paid card ordered with your code.';
    for (const el of document.querySelectorAll('[data-v]')) { const k = el.dataset.v, v = t[k] || 0; el.textContent = ['pending', 'ready', 'paid'].includes(k) ? inr(v) : String(v); }
    $('[data-p-code]').textContent = p.code;
    $('[data-p-offer]').textContent = 'Your followers get ' + inr(p.discount) + ' off with it.';
    const link = $('[data-p-link]'); link.href = p.link; link.textContent = p.link.replace(/^https:\/\//, '');
    $('[data-p-qr]').innerHTML = qr(p.link).createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    if (d.card && d.card.link) { const a = $('[data-p-cardlink]'); a.href = d.card.link; a.textContent = d.card.link.replace(/^https:\/\//, ''); $('[data-p-card]').hidden = false; }
    $('[data-p-min]').textContent = Math.round((d.rules || {}).min_payout || 500).toLocaleString('en-IN');
    const upi = pinFormUpi(); if (d.payout_details && d.payout_details.upi) upi.placeholder = 'Saved: ' + d.payout_details.upi;
    const panNeeded = !!t.pan_needed || ((t.this_year || 0) > ((d.rules || {}).pan_threshold || 10000) && !(d.payout_details || {}).pan);
    $('[data-p-panwhy]').hidden = !panNeeded; for (const el of document.querySelectorAll('[data-p-pan]')) el.hidden = !panNeeded;
    // Month by month: sales and earnings by the month of the sale; payouts by the month they cover (paid at month end).
    const ym = s => String(s || '').slice(0, 7), mname = k => new Date(k + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const months = {};
    for (const c of d.commissions || []) { if (!['pending', 'approved', 'paid'].includes(c.status)) continue; const k = ym(c.paid_at); const m = months[k] = months[k] || { sales: 0, earned: 0, paid: null };
      if (c.kind === 'sale') m.sales++; m.earned += Number(c.amount) || 0; }
    for (const o of d.payouts || []) { const k = o.period; const m = months[k] = months[k] || { sales: 0, earned: 0, paid: null };
      m.paid = o.status === 'paid' ? inr(o.net) + ' on ' + new Date(o.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : o.status === 'held' ? 'On hold: ' + (o.hold_reason || 'details needed') : 'Due ' + inr(o.net); }
    const keys = Object.keys(months).filter(Boolean).sort().reverse().slice(0, 12);
    $('[data-p-monthwrap]').hidden = keys.length === 0;
    $('[data-p-months]').innerHTML = keys.map(k => { const m = months[k]; return '<tr><th scope="row">' + esc(mname(k)) + '</th><td>' + m.sales + '</td><td>' + esc(inr(m.earned)) + '</td><td>' + esc(m.paid || '—') + '</td></tr>'; }).join('');
    const now = new Date(), end = new Date(now.getFullYear(), now.getMonth() + 1, 0), min = (d.rules || {}).min_payout || 500, ready = Number(t.ready) || 0;
    $('[data-p-next]').textContent = ready >= min ? 'Next payout: ' + inr(ready) + ' on ' + end.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) + '.'
      : ready > 0 ? inr(ready) + ' is ready. Payouts start at ' + inr(min) + ', so it rolls over to the next month end.' : 'Payouts go out on the last day of every month.';
    const rows = (d.commissions || []).filter(c => c.kind === 'sale' || c.amount < 0);
    $('[data-p-empty]').hidden = rows.length > 0; $('[data-p-tablewrap]').hidden = rows.length === 0;
    $('[data-p-rows]').innerHTML = rows.map(c => '<tr><th scope="row">' + esc(c.customer || 'Customer') + '</th><td>' + esc(new Date(c.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })) + '</td><td>' + esc(({ motion: 'Motion', nfc: 'NFC Basic', nfc_custom: 'NFC Custom' })[c.plan] || 'Digital') + '</td><td>' + esc(inr(c.amount)) + '</td><td>' + esc(STATUS[c.status] || c.status) + '</td></tr>').join('');
    root.hidden = true; main.hidden = false;
  };
  const pinFormUpi = () => document.querySelector('[data-p-upi] [name="upi_id"]');

  const open = async (remember) => {
    msg.textContent = '';
    const { ok, j } = await call('me', {}).catch(() => ({ ok: false, j: {} }));
    if (ok && j.ok && j.partner) { if (remember) try { localStorage.setItem(store, pin); } catch (e) {} render(j); return true; }
    try { localStorage.removeItem(store); } catch (e) {}
    pinForm.hidden = false; msg.textContent = why(j); return false;
  };

  if (!token) { $('[data-p-nolink]').hidden = false; return; }
  try { pin = localStorage.getItem(store) || ''; } catch (e) {}
  if (/^[0-9]{4}$/.test(pin)) open(false); else pinForm.hidden = false;
  pinForm.addEventListener('submit', e => {
    e.preventDefault(); pin = String(pinForm.pin.value || '').replace(/\D/g, '');
    if (!/^[0-9]{4}$/.test(pin)) { msg.textContent = 'Enter the last 4 digits of your phone number.'; return; }
    open(pinForm.remember.checked);
  });

  $('[data-p-copy]').addEventListener('click', async e => {
    try { await navigator.clipboard.writeText(data.partner.link); e.currentTarget.textContent = 'Copied'; } catch (_) {}
  });
  $('[data-p-download]').addEventListener('click', () => {
    const img = new Image(); img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 1024; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 1024, 1024); x.imageSmoothingEnabled = false; x.drawImage(img, 0, 0, 1024, 1024);
      const a = document.createElement('a'); a.download = 'linkcardly-' + data.partner.code.toLowerCase() + '-qr.png'; a.href = c.toDataURL('image/png'); a.click();
    };
    img.src = qr(data.partner.link).createDataURL(8, 4);
  });
  $('[data-p-upi]').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget, out = $('[data-p-upimsg]'), v = pinFormUpi().value.trim(), pan = String(f.pan.value || '').trim().toUpperCase();
    if (v && !/^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,64}$/.test(v)) { out.className = 'lap-err'; out.textContent = 'Enter a UPI ID like name@okaxis.'; return; }
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) { out.className = 'lap-err'; out.textContent = 'Enter your PAN like ABCDE1234F.'; return; }
    if (!v && !pan) { out.className = 'lap-err'; out.textContent = 'Enter your UPI ID.'; return; }
    const { ok, j } = await call('payout', { upi_id: v, pan, pan_name: String(f.pan_name.value || '').trim() }).catch(() => ({ ok: false, j: {} }));
    out.className = ok && j.ok ? 'lap-note' : 'lap-err'; out.textContent = ok && j.ok ? 'Saved.' : why(j);
    if (ok && j.ok) { f.reset(); open(false); }
  });
})();
