// /designs: a gallery of every real card design (pre-rendered from the card page, assets/img/designs/<id>.webp),
// filtered by business. Opening one shows the live card page (/app/card.html in preview mode, the renderer the
// order flow uses) in a dialog. Designs come from app/estate-styles.js and app/scene-styles.js; sample people
// from site/catalogue.js (window.LC).
(() => {
  const gallery = document.querySelector('[data-gallery]'); if (!gallery) return;
  const E = window.LC_ESTATE, SC = window.LC_SCENES, CAT = (window.LC || {}).categories || [];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Business → order-flow profession and preset (same keys as BUSINESSES in app/order.html).
  const BIZ = [
    { cat: 'personal', prof: 'Entrepreneur / Business owner', preset: 'entrepreneur', styles: () => SC.styles.map(s => ({ id: s.id, name: (SC.families || {})[s.scene] ? SC.families[s.scene] + ' ' + s.name : s.name, layout: 'scene' })) },
    { cat: 'realestate', key: 're', prof: 'Real Estate', preset: 'realEstate' },
    { cat: 'hc', key: 'hc', prof: 'Healthcare', preset: 'healthcare' },
    { cat: 'bw', key: 'bw', prof: 'Beauty & Wellness', preset: 'services' },
    { cat: 'lf', key: 'lf', prof: 'Legal / Finance', preset: 'entrepreneur' },
    { cat: 'hs', key: 'hs', prof: 'Home Services', preset: 'services' },
    { cat: 'cc', key: 'cc', prof: 'Consultant / Coach', preset: 'entrepreneur' }
  ].map(b => ({ ...b, info: CAT.find(c => c.id === b.cat) || { name: b.prof, person: 'Alex Morgan', role: 'Your title' } }));
  const stylesOf = b => b.styles ? b.styles() : E.rows[b.key].map(([id, name]) => ({ id, name, layout: 'estate' }));

  const bizBox = document.querySelector('[data-biz]'), dlg = document.querySelector('[data-viewer]'), frame = document.querySelector('[data-card-frame]');
  const byHash = () => BIZ.find(b => b.cat === location.hash.slice(1)) || BIZ[0];
  let biz = byHash(), style = null, opener = null;

  const row = () => {
    const [first, ...rest] = biz.info.person.split(' '), [title, company = ''] = biz.info.role.split(' · ');
    return { slug: biz.info.slug || 'preview', region: 'US', layout: style.layout, colour: style.id, profession: biz.prof, preset: biz.preset,
      first_name: first, last_name: rest.join(' '), title, company, phone: '+18165550123', email: 'hello@example.com', website: '',
      photo_url: new URL('/assets/img/samples/portrait.jpg', location.href).href, photo_x: 50, photo_y: 30, photo_zoom: 1,
      extras: { lead_capture: true }, plan: 'basic', active: true, show_powered_by: true };
  };
  const post = () => { if (!style) return; try { frame.contentWindow.postMessage({ type: 'nbr-preview', row: row() }, location.origin); } catch (e) {} };
  addEventListener('message', e => { if (e.origin === location.origin && e.source === frame.contentWindow && e.data && e.data.type === 'nbr-preview-ready') post(); });
  frame.addEventListener('load', () => { post(); setTimeout(post, 400); setTimeout(post, 1200); });

  const paint = () => {
    bizBox.innerHTML = BIZ.map((b, i) => `<button class="chip" type="button" data-i="${i}" aria-pressed="${b === biz}">${esc(b.info.name)}</button>`).join('');
    gallery.innerHTML = stylesOf(biz).map(s => `<button class="tile" type="button" data-id="${esc(s.id)}"><img src="/assets/img/designs/${esc(s.id)}.webp" alt="" width="250" height="540" loading="lazy"><span><b>${esc(s.name)}</b><small>${esc(biz.info.name)}</small></span></button>`).join('');
  };
  const open = (s, from) => {
    style = s; opener = from;
    dlg.querySelector('[data-viewer-trade]').textContent = biz.info.name;
    dlg.querySelector('[data-viewer-name]').textContent = s.name;
    dlg.querySelector('[data-viewer-cta]').href = '/create?colour=' + encodeURIComponent(s.id);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    post();
  };
  const close = () => { dlg.close ? dlg.close() : dlg.removeAttribute('open'); };
  dlg.addEventListener('close', () => { opener && opener.focus(); });
  dlg.querySelector('[data-viewer-close]').addEventListener('click', close);
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  bizBox.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; biz = BIZ[+b.dataset.i]; history.replaceState(null, '', '#' + biz.cat); paint(); });
  gallery.addEventListener('click', e => { const t = e.target.closest('[data-id]'); if (t) open(stylesOf(biz).find(s => s.id === t.dataset.id), t); });
  addEventListener('hashchange', () => { biz = byHash(); paint(); });
  paint();
})();
