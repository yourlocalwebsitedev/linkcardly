(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = 'cubic-bezier(.2,.8,.2,1)';
  const D = window.LC;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const C = window.LC_CONFIG || {};
  // Same slug rule as the order app: lowercase letters and numbers, single dashes between.
  const clean = v => String(v || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  let orderStyle = '';
  const orderHref = () => (window.LC_CREATE_URL || C.orderUrl || '/create') + (orderStyle ? '?colour=' + encodeURIComponent(orderStyle) : '');

  // mini card markup
  const mini = (key, name, role) => {
    const t = D.themes[key] || D.themes.folio;
    return `<div class="mini" style="--bg:${t[2]};--ink:${t[3]};--btn:${t[4]};--btn-ink:${t[5]}"><div class="m-cover"></div><div class="m-body"><div class="m-av"></div><div class="m-name">${esc(name || t[6])}</div><div class="m-role">${esc(role || t[7])}</div><div class="m-icons"><i></i><i></i><i></i><i></i></div><div class="m-btn">Save contact</div><div class="m-btn o">Show QR code</div><div class="m-box"></div></div></div>`;
  };
  const anim = (el, kf, o) => !reduce && el && el.animate(kf, { easing: ease, ...o });

  // menu + sticky
  const mb = $('.menu-btn'), menu = $('.menu');
  mb && mb.addEventListener('click', () => { const o = menu.classList.toggle('open'); mb.textContent = o ? '✕' : '☰'; mb.setAttribute('aria-expanded', o); });
  const sticky = $('.sticky');
  sticky && addEventListener('scroll', () => sticky.classList.toggle('show', scrollY > 640), { passive: true });

  // claim forms → /create?h=
  $$('form[data-claim]').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    const h = clean(f.querySelector('input').value), href = orderHref();
    location.href = h ? href + (href.includes('?') ? '&' : '?') + 'h=' + encodeURIComponent(h) : href;
  }));

  // live availability (reads the same public_cards view the card page uses)
  const isTaken = async h => {
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
  const setStatus = (out, state, html) => { out.dataset.state = state; out.innerHTML = html; };
  const check = (input, out) => {
    clearTimeout(timer);
    const h = clean(input.value), id = ++seq;
    if (!h) return setStatus(out, '', '');
    if (h.length < 3) return setStatus(out, 'bad', 'Use at least 3 letters or numbers.');
    if (((window.LC_RULES || {}).reserved || C.reserved || []).includes(h)) return setStatus(out, 'bad', `<b>linkcardly.com/${esc(h)}</b> is reserved. Try another name.`);
    setStatus(out, 'wait', 'Checking…');
    timer = setTimeout(async () => {
      try {
        const taken = await isTaken(h); if (id !== seq) return;
        if (!taken) return setStatus(out, 'ok', `✓ <b>linkcardly.com/${esc(h)}</b> is available`);
        const alt = await freeAlternative(h); if (id !== seq) return;
        setStatus(out, 'bad', `✕ <b>linkcardly.com/${esc(h)}</b> is taken.${alt ? ` <button type="button" class="status-alt" data-alt="${esc(alt)}">Try ${esc(alt)}</button>` : ''}`);
      } catch (_) { if (id === seq) setStatus(out, '', ''); }
    }, 350);
  };
  $$('[data-check]').forEach(i => {
    const out = $(i.dataset.check);
    i.addEventListener('input', () => check(i, out));
    out.addEventListener('click', e => { const b = e.target.closest('[data-alt]'); if (b) { i.value = b.dataset.alt; check(i, out); i.focus(); } });
  });

  // reveal
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; io.unobserve(e.target); e.target.style.opacity = ''; anim(e.target, [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'none' }], { duration: 700 }); }), { threshold: .12 });
    $$('[data-reveal]').forEach(el => { if (el.getBoundingClientRect().top > innerHeight) { el.style.opacity = '0'; io.observe(el); } });
  }

  // hero categories (slider)
  const hero = $('[data-hero]');
  if (hero) {
    const cats = D.categories; let cur = 0, picked = false;
    const track = $('[data-cats-hero]'), card = $('[data-hero-card]'), pitch = $('[data-pitch]'), slug = $('[data-slug]'), who = $('[data-who]'), claimIn = $('[data-hero-input]');
    track.innerHTML = cats.map((c, i) => `<button class="cat" type="button" data-i="${i}" aria-pressed="false"><strong>${esc(c.name)}</strong><span>${esc(c.sub)}</span></button>`).join('');
    const btns = $$('[data-i]', track);
    const set = (i, user) => {
      cur = i; const c = cats[i];
      btns.forEach((b, j) => b.setAttribute('aria-pressed', j === i));
      if (user || !reduce) { const b = btns[i]; track.scrollTo({ left: b.offsetLeft - track.offsetLeft - 4, behavior: reduce ? 'auto' : 'smooth' }); }
      pitch.textContent = c.pitch; slug.textContent = 'linkcardly.com/' + c.slug; who.textContent = c.person; claimIn.placeholder = c.slug;
      orderStyle = c.style;
      card.innerHTML = mini(c.theme, c.person, c.role);
      anim(card, [{ opacity: 0, transform: 'translateX(40px) rotate(6deg) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 650 });
    };
    track.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { picked = true; set(+b.dataset.i, true); } });
    $$('[data-cat-step]').forEach(b => b.addEventListener('click', () => { picked = true; set((cur + +b.dataset.catStep + cats.length) % cats.length, true); }));
    set(0);
    anim($('[data-float]'), [{ transform: 'translateY(0) rotate(-1.5deg)' }, { transform: 'translateY(-12px) rotate(1deg)' }], { duration: 3200, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
    if (!reduce) setInterval(() => { if (!picked && !claimIn.value && document.activeElement !== claimIn) set((cur + 1) % cats.length); }, 4200);
  }

  // smart buttons demo
  const demo = $('[data-demo]');
  if (demo) {
    const IC = window.LC_ICONS, order = ['call', 'whatsapp', 'email', 'directions', 'listings', 'instagram', 'linkedin', 'website', 'facebook', 'youtube'];
    const lbl = { call: 'Call', whatsapp: 'WhatsApp', email: 'Email', directions: 'Directions', listings: 'Listings', instagram: 'Instagram', linkedin: 'LinkedIn', website: 'Website', facebook: 'Facebook', youtube: 'YouTube' };
    const counts = [3, 4, 6, 7, 8, 10]; let n = 6, user = false;
    const split = n => n <= 6 ? [n] : n <= 8 ? [4, n - 4] : [5, n - 5];
    const gap = (len, n) => n <= 3 ? 22 : n <= 4 ? 20 : len === 6 ? 5 : len === 5 ? 12 : n <= 8 ? 20 : 12;
    const icon = k => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${IC[k].map(d => `<path d="${d}"/>`).join('')}</svg>`;
    const btns = $('[data-counts]');
    btns.innerHTML = counts.map(c => `<button class="count" type="button" data-n="${c}" aria-label="${c} links">${c}</button>`).join('');
    const render = next => {
      const prev = {}; $$('[data-ic]', demo).forEach(el => prev[el.dataset.ic] = el.getBoundingClientRect());
      n = next; let at = 0;
      demo.innerHTML = split(n).map(len => { const items = order.slice(at, at += len); return `<div class="r" style="gap:${gap(len, n)}px">${items.map(k => `<div class="ic" data-ic="${k}"><b>${icon(k)}</b><small>${lbl[k]}</small></div>`).join('')}</div>`; }).join('');
      $$('[data-n]', btns).forEach(b => b.setAttribute('aria-pressed', +b.dataset.n === n));
      let i = 0;
      $$('[data-ic]', demo).forEach(el => { const r = el.getBoundingClientRect(), p = prev[el.dataset.ic]; if (p) anim(el, [{ transform: `translate(${p.left - r.left}px,${p.top - r.top}px)` }, { transform: 'none' }], { duration: 500 }); else anim(el, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], { duration: 450, delay: 120 + i++ * 60, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' }); });
    };
    btns.addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (b) { user = true; render(+b.dataset.n); } });
    render(n);
    if (!reduce) setInterval(() => { if (!user) render(counts[(counts.indexOf(n) + 1) % counts.length]); }, 2600);
  }

  // marquee state (declared before the chip strip, which resets x when it refills)
  let x = 0, paused = false, last = performance.now();

  // category chips (strip + grid)
  const catList = cat => Object.entries(D.themes).filter(([, t]) => cat === 'All' || t[1] === cat);
  const tile = ([k, t]) => `<a class="tile" href="${window.LC_CREATE_URL || '/create'}" data-tile>${mini(k)}<div style="text-align:center"><strong>${t[0]}</strong><br><small>${t[1]}</small></div></a>`;
  $$('[data-cats]').forEach(box => {
    const target = $(box.dataset.cats), loop = target.hasAttribute('data-loop');
    box.innerHTML = D.cats.map(c => `<button class="chip" type="button" data-c="${c}" aria-pressed="${c === 'All'}">${c}</button>`).join('');
    const fill = cat => {
      let l = catList(cat); if (loop) { while (l.length < 8) l = l.concat(catList(cat)); l = l.concat(l); }
      target.innerHTML = l.map(tile).join('');
      $$('[data-tile]', target).slice(0, 12).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(40px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: i * 60, fill: 'backwards' }));
      if (loop) x = 0;
    };
    box.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; $$('[data-c]', box).forEach(c => c.setAttribute('aria-pressed', c === b)); fill(b.dataset.c); });
    fill('All');
  });
  // marquee
  const track = $('[data-loop]');
  if (track && !reduce) {
    const strip = track.parentElement;
    ['mouseenter', 'touchstart'].forEach(ev => strip.addEventListener(ev, () => paused = true, { passive: true }));
    ['mouseleave', 'touchend'].forEach(ev => strip.addEventListener(ev, () => paused = false, { passive: true }));
    const tick = t => { const dt = Math.min(64, t - last); last = t; if (!paused) { const half = track.scrollWidth / 2; x -= dt * .045; if (half && -x >= half) x += half; track.style.transform = `translate3d(${x}px,0,0)`; } requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  } else if (track) track.parentElement.style.overflowX = 'auto';

  // quotes
  const q = $('[data-quotes]');
  if (q) {
    const list = JSON.parse(q.dataset.quotes); let i = 0;
    const show = () => { $('[data-q]').textContent = `“${list[i][0]}”`; $('[data-qwho]').textContent = list[i][1]; $('[data-qn]').textContent = `${i + 1} / ${list.length}`; };
    $('[data-prev]').onclick = () => { i = (i + list.length - 1) % list.length; show(); };
    $('[data-next]').onclick = () => { i = (i + 1) % list.length; show(); };
  }

  // forms with Turnstile → JSON API
  const token = f => (f.querySelector('[name="cf-turnstile-response"]') || {}).value || '';
  const orderForm = $('#order');
  if (orderForm) {
    const params = new URLSearchParams(location.search);
    const f = orderForm.elements, pv = $('[data-preview]'), pvLink = $('[data-preview-link]');
    if (params.get('h')) f.handle.value = clean(params.get('h'));
    let themeKey = D.themes[params.get('theme')] ? params.get('theme') : 'folio', plan = params.get('plan') === 'basic' ? 'basic' : 'motion';
    $$('[data-plan]').forEach(c => c.setAttribute('aria-pressed', c.dataset.plan === plan));
    const themes = $('[data-themes]');
    themes.innerHTML = Object.entries(D.themes).map(([k, t]) => `<button class="chip" type="button" data-t="${k}" aria-pressed="${k === themeKey}">${t[0]}</button>`).join('');
    const draw = flip => {
      const role = [f.title.value, f.company.value].filter(Boolean).join(' · ') || 'Your title · Company';
      pv.innerHTML = mini(themeKey, f.full_name.value.trim() || 'Your Name', role);
      pvLink.textContent = 'linkcardly.com/' + (clean(f.handle.value) || 'yourname');
      if (flip) anim(pv, [{ opacity: 0, transform: 'rotateY(70deg) scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 600 });
    };
    orderForm.addEventListener('input', () => draw(false));
    themes.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; themeKey = b.dataset.t; $$('[data-t]', themes).forEach(c => c.setAttribute('aria-pressed', c === b)); draw(true); });
    $$('[data-plan]').forEach(b => b.addEventListener('click', () => { plan = b.dataset.plan; $$('[data-plan]').forEach(c => c.setAttribute('aria-pressed', c === b)); }));
    draw(false);
    orderForm.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('[data-order-msg]'), body = Object.fromEntries(new FormData(orderForm)); body.theme = themeKey; body.plan = plan; body.turnstile = token(orderForm);
      if (!clean(body.handle) || !body.full_name.trim() || !/.+@.+\..+/.test(body.email)) { msg.textContent = 'Add your link, full name and a valid email to continue.'; msg.classList.add('bad'); return; }
      msg.textContent = 'Sending…'; msg.classList.remove('bad');
      try {
        const r = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json();
        if (!r.ok) { msg.textContent = j.error + (j.suggestions ? ' Try ' + j.suggestions[0] + '.' : ''); msg.classList.add('bad'); window.turnstile && turnstile.reset(); return; }
        orderForm.hidden = true; const done = $('[data-order-done]'); done.hidden = false;
        $('[data-done-name]').textContent = body.full_name.trim().split(' ')[0]; $('[data-done-email]').textContent = body.email; $('[data-done-link]').textContent = 'linkcardly.com/' + j.handle;
        scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      } catch (_) { msg.textContent = 'Something went wrong. Please try again.'; msg.classList.add('bad'); }
    });
  }
  const contact = $('#contact');
  if (contact) contact.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('[data-contact-msg]'), body = Object.fromEntries(new FormData(contact)); body.turnstile = token(contact);
    if (!body.name.trim() || !/.+@.+\..+/.test(body.email) || !body.message.trim()) { msg.textContent = 'Add your name, a valid email and a message.'; return; }
    const btn = contact.querySelector('[type=submit]'); btn.disabled = true; msg.textContent = 'Sending…';
    try {
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) { contact.hidden = true; const d = $('[data-contact-done]'); d.hidden = false; $('[data-cname]').textContent = body.name.trim().split(' ')[0]; return; }
      const j = await r.json().catch(() => ({}));
      msg.textContent = j.error || 'Something went wrong. Please try again, or email hello@linkcardly.com.';
    } catch (_) { msg.textContent = 'Could not send. Check your connection and try again.'; }
    btn.disabled = false; window.turnstile && turnstile.reset();
  });
})();
