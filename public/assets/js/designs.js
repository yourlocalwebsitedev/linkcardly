// /designs: every real card design, one at a time on a stage with a thumbnail rail (pre-rendered from the card page, assets/img/designs/<id>.webp),
// filtered by business. Opening one shows the live card page (/app/card.html in preview mode, the renderer the
// order flow uses) in a dialog. Designs come from app/estate-styles.js and app/scene-styles.js; sample people
// and their photos from site/catalogue.js (window.LC). Re-render the .webp files when a sample photo changes.
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
      photo_url: new URL(biz.info.photo || '/assets/img/samples/portrait.jpg', location.href).href, photo_x: 50, photo_y: 30, photo_zoom: 1,
      extras: { lead_capture: true }, plan: 'basic', active: true, show_powered_by: true };
  };
  const post = () => { if (!style) return; try { frame.contentWindow.postMessage({ type: 'nbr-preview', row: row() }, location.origin); } catch (e) {} };
  addEventListener('message', e => { if (e.origin === location.origin && e.source === frame.contentWindow && e.data && e.data.type === 'nbr-preview-ready') post(); });
  frame.addEventListener('load', () => { post(); setTimeout(post, 400); setTimeout(post, 1200); });

  // Stage + rail: one design large, the rest as thumbnails. Picking one slides it in from the side it came from.
  let idx = 0;
  const src = s => '/assets/img/designs/' + s.id + '.webp';
  // Studio: the chosen design in a phone frame, its neighbours fanned behind it, a dot strip of thumbnails below.
  const paint = () => {
    const list = stylesOf(biz); idx = 0;
    bizBox.value = biz.cat; document.querySelector('[data-biz-label]').textContent = biz.info.name;
    gallery.innerHTML = `<div class="studio" data-show aria-live="polite">
      <div class="studio-stage">
        <button class="studio-side studio-side--l" type="button" data-step="-1" aria-label="Previous design"><img data-side-l src="" alt="" width="250" height="540"></button>
        <div class="studio-phone"><img data-stage src="" alt="" width="250" height="540"></div>
        <button class="studio-side studio-side--r" type="button" data-step="1" aria-label="Next design"><img data-side-r src="" alt="" width="250" height="540"></button>
      </div>
      <div class="studio-bar">
        <button class="rail-btn rail-btn--prev" type="button" data-step="-1" aria-label="Previous design"><i class="ic ic-arrow" aria-hidden="true"></i></button>
        <div class="studio-copy"><h2 data-show-name></h2><span class="show-count" data-show-count></span></div>
        <button class="rail-btn" type="button" data-step="1" aria-label="Next design"><i class="ic ic-arrow" aria-hidden="true"></i></button>
      </div>
      <div class="rail" data-rail>${list.map((s, i) => `<button class="thumb" type="button" data-pick="${i}" aria-label="${esc(s.name)}"><img src="${src(s)}" alt="" width="250" height="540" loading="lazy"></button>`).join('')}</div>
      <button class="btn btn-dark studio-try" type="button" data-try>Try it live<i class="ic ic-arrow" aria-hidden="true"></i></button>
    </div>`;
    pick(Math.floor(Math.random() * list.length), ''); // a different design each visit, not always the first
  };
  const pick = (i, dir) => {
    const list = stylesOf(biz), n = list.length; idx = (i + n) % n; const s = list[idx], show = gallery.querySelector('[data-show]');
    const img = show.querySelector('[data-stage]'); img.src = src(s); img.alt = s.name + ' design for ' + biz.info.name;
    show.querySelector('[data-side-l]').src = src(list[(idx - 1 + n) % n]);
    show.querySelector('[data-side-r]').src = src(list[(idx + 1) % n]);
    show.querySelector('[data-show-name]').textContent = s.name;
    show.querySelector('[data-show-count]').textContent = (idx + 1) + ' of ' + n;
    delete show.dataset.dir; void show.offsetWidth; if (dir) show.dataset.dir = dir;
    const rail = gallery.querySelector('[data-rail]'), thumbs = [...rail.children];
    thumbs.forEach((t, k) => t.setAttribute('aria-current', String(k === idx)));
    const t = thumbs[idx]; rail.scrollTo({ left: t.offsetLeft - (rail.clientWidth - t.clientWidth) / 2 });
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
  bizBox.innerHTML = BIZ.map(b => `<option value="${esc(b.cat)}">${esc(b.info.name)}</option>`).join('');
  bizBox.addEventListener('change', () => { biz = BIZ.find(b => b.cat === bizBox.value) || BIZ[0]; history.replaceState(null, '', '#' + biz.cat); paint(); });
  gallery.addEventListener('click', e => {
    const p = e.target.closest('[data-pick]'), st = e.target.closest('[data-step]');
    if (p) return pick(+p.dataset.pick, +p.dataset.pick < idx ? 'prev' : 'next');
    if (st) return pick(idx + +st.dataset.step, +st.dataset.step < 0 ? 'prev' : 'next');
    if (e.target.closest('[data-try], .studio-phone')) open(stylesOf(biz)[idx], e.target.closest('button, img'));
  });
  gallery.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); pick(idx + (e.key === 'ArrowRight' ? 1 : -1), e.key === 'ArrowRight' ? 'next' : 'prev'); } });
  let sx = null; gallery.addEventListener('touchstart', e => { if (e.target.closest('[data-stage]')) sx = e.touches[0].clientX; }, { passive: true });
  gallery.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 40) pick(idx + (dx < 0 ? 1 : -1), dx < 0 ? 'next' : 'prev'); });
  addEventListener('hashchange', () => { biz = byHash(); paint(); });
  paint();
})();
