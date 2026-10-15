// Linkcardly marketing pages: menu, claim field (live availability), scroll reveal, Turnstile and the contact forms.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C = window.LC_CONFIG || {};
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Same slug rule as the order app: lowercase letters and numbers, single dashes between.
  const clean = v => String(v || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const orderHref = () => window.LC_CREATE_URL || C.orderUrl || '/create';

  // mobile menu
  const mb = $('.menu-btn'), menu = $('.menu');
  if (mb && menu) {
    const set = open => { menu.classList.toggle('open', open); mb.setAttribute('aria-expanded', String(open)); mb.setAttribute('aria-label', open ? 'Close menu' : 'Menu'); };
    mb.addEventListener('click', () => set(!menu.classList.contains('open')));
    menu.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && menu.classList.contains('open')) { set(false); mb.focus(); } });
    document.addEventListener('click', e => { if (menu.classList.contains('open') && !e.target.closest('.top')) set(false); });
  }

  // header shadow once the page is scrolled (rAF-throttled, passive)
  const top = $('.top');
  if (top) { let raf = 0; const upd = () => { raf = 0; top.classList.toggle('is-scrolled', scrollY > 4); }; addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true }); upd(); }

  // claim forms → /create?h=
  $$('form[data-claim]').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    const h = clean(f.querySelector('input').value), href = orderHref();
    location.href = h ? href + (href.includes('?') ? '&' : '?') + 'h=' + encodeURIComponent(h) : href;
  }));

  // live availability (reads the same public_cards view the card page uses)
  // slug_available (supabase/live/linkcardly.sql) also sees cards whose order isn't paid yet; public_cards is the fallback.
  const isTaken = async h => {
    const q = await fetch(`${C.supabaseUrl}/rest/v1/rpc/slug_available`, { method: 'POST', headers: { apikey: C.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_slug: h }) });
    if (q.ok) { const j = await q.json(); if (j && typeof j.available === 'boolean') return !j.available; }
    else if (q.status !== 404) throw new Error('check failed');
    const r = await fetch(`${C.supabaseUrl}/rest/v1/public_cards?select=slug&slug=eq.${encodeURIComponent(h)}`, { headers: { apikey: C.supabaseKey } });
    if (!r.ok) throw new Error('check failed');
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  };
  const freeAlternative = async h => {
    for (const alt of [h + '-card', h + '-' + (new Date().getFullYear() % 100), h + '1']) { try { if (!(await isTaken(alt))) return alt; } catch (_) { return ''; } }
    return '';
  };
  let timer, seq = 0;
  const setStatus = (out, state, html) => { out.dataset.state = state; out.innerHTML = html; const f = out.previousElementSibling; if (f && f.matches('.claim')) f.dataset.state = state; };
  const check = (input, out) => {
    clearTimeout(timer);
    const h = clean(input.value), id = ++seq;
    if (!h) return setStatus(out, '', '');
    if (h.length < 3) return setStatus(out, 'bad', 'Use at least 3 letters or numbers.');
    if (((window.LC_RULES || {}).reserved || C.reserved || []).includes(h)) return setStatus(out, 'bad', `<b>linkcardly.com/${esc(h)}</b> is reserved. Try another name.`);
    if (!C.supabaseUrl) return setStatus(out, '', '');
    setStatus(out, 'wait', 'Checking…');
    timer = setTimeout(async () => {
      try {
        const taken = await isTaken(h); if (id !== seq) return;
        if (!taken) return setStatus(out, 'ok', `<b>linkcardly.com/${esc(h)}</b> is available`);
        const alt = await freeAlternative(h); if (id !== seq) return;
        setStatus(out, 'bad', `<b>linkcardly.com/${esc(h)}</b> is taken.${alt ? ` <button type="button" class="status-alt" data-alt="${esc(alt)}">Try ${esc(alt)}</button>` : ''}`);
      } catch (_) { if (id === seq) setStatus(out, '', ''); }
    }, 350);
  };
  $$('[data-check]').forEach(i => {
    const out = $(i.dataset.check);
    i.addEventListener('input', () => { i.value = i.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40); check(i, out); });
    out.addEventListener('click', e => { const b = e.target.closest('[data-alt]'); if (b) { i.value = b.dataset.alt; check(i, out); i.focus(); } });
  });

  // scroll reveal (Home v13): items below the fold fade up as they enter, staggered in rows of four
  if (!reduce && 'IntersectionObserver' in window) {
    const els = $$('[data-reveal]').filter(el => el.getBoundingClientRect().top > innerHeight);
    const io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; e.target.style.opacity = '1'; e.target.style.transform = 'none'; io.unobserve(e.target); }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el, i) => { el.style.transitionDelay = (i % 4) * 80 + 'ms'; el.style.opacity = '0'; el.style.transform = 'translateY(20px)'; io.observe(el); });
    // in-view motion (home perks, flow, ways): .motion on <html> arms the CSS; .is-in plays it once the block is a quarter visible
    const blocks = $$('[data-inview]');
    if (blocks.length) {
      document.documentElement.classList.add('motion');
      const seen = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; e.target.classList.add('is-in'); seen.unobserve(e.target); }), { threshold: .25 });
      blocks.forEach(el => seen.observe(el));
    }
  }

  // hero slideshow (NFC page): photos crossfade every 5 s; dots or a swipe on the phone photo pick one; no autoplay with reduced motion
  $$('[data-slides]').forEach(h => {
    const sets = [$$('.hero-photo img', h), $$('.hero-photo-m img', h)], dots = $$('[data-slide-dots] button', h); if (dots.length < 2) return;
    let cur = 0, auto, x0 = null;
    const show = i => { cur = (i + dots.length) % dots.length; sets.forEach(s => s.forEach((im, k) => im.classList.toggle('is-on', k === cur))); dots.forEach((d, k) => d.setAttribute('aria-current', String(k === cur))); };
    const start = () => { clearInterval(auto); if (!reduce) auto = setInterval(() => show(cur + 1), 5000); };
    dots.forEach((d, k) => d.addEventListener('click', () => { show(k); start(); }));
    const m = $('.hero-photo-m', h);
    if (m) { m.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true }); m.addEventListener('touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) { show(cur + (dx < 0 ? 1 : -1)); start(); } }); }
    start();
  });

  // trades slider (home): swipe or scroll-snap; arrows, dots and a slow autoplay that pauses on hover, focus or touch
  $$('[data-slider]').forEach(sl => {
    const track = $('.trades', sl), cards = $$('.trade', track), dots = $('[data-dots]', sl); if (!cards.length) return;
    let cur = 0, auto;
    dots.innerHTML = cards.map((c, i) => `<button type="button" aria-label="Show ${esc($('b', c).textContent)}" aria-controls="trade-track"></button>`).join('');
    const dotEls = $$('button', dots);
    const mark = i => { cur = i; cards.forEach((c, k) => c.classList.toggle('is-active', k === i)); dotEls.forEach((d, k) => d.setAttribute('aria-current', String(k === i))); };
    const go = i => { i = (i + cards.length) % cards.length; const c = cards[i]; track.scrollTo({ left: c.offsetLeft - (track.clientWidth - c.clientWidth) / 2, behavior: reduce ? 'auto' : 'smooth' }); mark(i); };
    const near = () => { const mid = track.scrollLeft + track.clientWidth / 2; let best = 0, d = Infinity; cards.forEach((c, k) => { const m = Math.abs(c.offsetLeft + c.clientWidth / 2 - mid); if (m < d) { d = m; best = k; } }); return best; };
    let t; track.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => mark(near()), 80); }, { passive: true });
    $('[data-prev]', sl).addEventListener('click', () => go(cur - 1));
    $('[data-next]', sl).addEventListener('click', () => go(cur + 1));
    dots.addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(dotEls.indexOf(b)); });
    const stop = () => clearInterval(auto), start = () => { stop(); if (!reduce) auto = setInterval(() => go(cur + 1), 4500); };
    ['pointerenter', 'focusin', 'touchstart'].forEach(ev => sl.addEventListener(ev, stop, { passive: true }));
    ['pointerleave', 'focusout'].forEach(ev => sl.addEventListener(ev, start));
    // start on the card marked data-start (Real Estate on home), placed instantly so the page doesn't scroll on load
    const first = Math.max(0, cards.findIndex(c => c.hasAttribute('data-start')));
    sl.classList.add('is-live'); mark(first);
    requestAnimationFrame(() => { const c = cards[first]; track.style.scrollBehavior = 'auto'; track.scrollLeft = c.offsetLeft - (track.clientWidth - c.clientWidth) / 2; track.style.scrollBehavior = ''; });
    if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? start() : stop()), { threshold: .4 }).observe(sl); else start();
  });

  // prices by location: India sees rupees, everyone else US dollars (same rule as the order flow, app/order.html
  // detectRegion). ?region=IN|US overrides for testing. Only one currency is ever shown.
  const priced = $$('[data-us]');
  if (priced.length) {
    const root = document.documentElement, apply = reg => { const k = reg === 'IN' ? 'in' : 'us'; priced.forEach(el => { el.textContent = el.dataset[k]; }); root.dataset.region = reg; root.classList.remove('region-wait'); };
    const fallback = () => { try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; return /Kolkata|Calcutta/.test(tz) || /-IN$/i.test(navigator.language || '') ? 'IN' : 'US'; } catch (_) { return 'US'; } };
    let q = ''; try { q = (new URLSearchParams(location.search).get('region') || '').toUpperCase(); } catch (_) {}
    let saved = ''; try { saved = sessionStorage.getItem('lc-region') || ''; } catch (_) {}
    if (q === 'IN' || q === 'US') apply(q);
    else if (saved === 'IN' || saved === 'US') apply(saved);
    else {
      root.classList.add('region-wait');
      const done = reg => { try { sessionStorage.setItem('lc-region', reg); } catch (_) {} apply(reg); };
      const t = setTimeout(() => done(fallback()), 1500);
      fetch('/cdn-cgi/trace', { cache: 'no-store' }).then(r => r.ok ? r.text() : '').then(x => { const m = x.match(/loc=([A-Z]{2})/); clearTimeout(t); done(m ? (m[1] === 'IN' ? 'IN' : 'US') : fallback()); }).catch(() => { clearTimeout(t); done(fallback()); });
    }
  }

  // Turnstile on forms ([data-turnstile]) with this environment's site key from /app/config.js; none → no widget.
  const tsBoxes = $$('[data-turnstile]');
  if (tsBoxes.length && C.turnstileSiteKey) {
    window.lcTurnstile = () => tsBoxes.forEach(el => { if (!el.childElementCount) turnstile.render(el, { sitekey: C.turnstileSiteKey }); });
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=lcTurnstile'; s.async = true;
    document.head.appendChild(s);
  }
  const token = f => (f.querySelector('[name="cf-turnstile-response"]') || {}).value || '';

  // contact + team quote forms → /api/contact
  $$('[data-topics]').forEach(g => g.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('button', g).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
  // NFC page: "Order this card" preselects that card in the order form
  $$('a[data-product]').forEach(a => a.addEventListener('click', () => { const s = $('[data-product-select]'); if (s) s.value = a.dataset.product; }));
  $$('form[data-contact]').forEach(form => form.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('[data-contact-msg]', form), fd = Object.fromEntries(new FormData(form));
    const topic = $('[data-topics] [aria-pressed="true"]', form);
    const extra = [form.dataset.subject, topic && 'Topic: ' + topic.textContent, fd.company && 'Company: ' + String(fd.company).trim(), fd.size && 'Team size: ' + fd.size, fd.product && 'Card: ' + fd.product, fd.qty && 'Quantity: ' + fd.qty, fd.link && 'Link: ' + String(fd.link).trim()].filter(Boolean);
    const body = { name: (fd.name || '').trim(), email: (fd.email || '').trim(), phone: (fd.phone || '').trim(), message: [extra.join(' · '), (fd.message || '').trim()].filter(Boolean).join('\n\n'), turnstile: token(form), ...(form.dataset.kind ? { kind: form.dataset.kind } : {}) };
    const needMsg = !form.dataset.subject;
    const bad = [!body.name && form.elements.name, !/.+@.+\..+/.test(body.email) && form.elements.email, needMsg && !(fd.message || '').trim() && form.elements.message].filter(Boolean);
    $$('[aria-invalid]', form).forEach(el => el.removeAttribute('aria-invalid'));
    if (bad.length) { bad.forEach(el => el.setAttribute('aria-invalid', 'true')); bad[0].focus(); msg.textContent = needMsg ? 'Add your name, a valid email and a message.' : 'Add your name and a valid work email.'; return; }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; msg.textContent = 'Sending…';
    try {
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) { const j = await r.json().catch(() => ({})); form.hidden = true; const d = form.parentElement.querySelector('[data-contact-done]'); d.hidden = false; $('[data-cname]', d).textContent = body.name.split(' ')[0]; const rf = $('[data-ref]', d); if (rf && j.ref) { rf.textContent = j.ref; rf.parentElement.hidden = false; } return; }
      const j = await r.json().catch(() => ({}));
      msg.textContent = j.error || 'Something went wrong. Please try again, or email hello@linkcardly.com.';
    } catch (_) { msg.textContent = 'Could not send. Check your connection and try again.'; }
    btn.disabled = false; window.turnstile && turnstile.reset();
  }));
})();
