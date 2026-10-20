import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { assets, env, request, stubFetch, json } from './helpers.js';

let f;
afterEach(() => f && f.restore());
const raw = url => new Request(url, { redirect: 'manual' });

test('health returns version and mode', async () => {
  assert.equal(await (await worker.fetch(request('/health'), env())).text(), 'ok v3');
  assert.equal(await (await worker.fetch(request('/health'), env({ MODE: 'proxy' }))).text(), 'ok v3 proxy');
});

test('deep health checks Supabase in native mode and reports failures as 503', async () => {
  f = stubFetch(url => url.includes('db.test') ? json([]) : undefined);
  let r = await worker.fetch(request('/health?deep=1'), env());
  assert.equal(r.status, 200);
  assert.equal((await r.json()).checks[0].name, 'supabase');
  f.restore();
  f = stubFetch(() => json({}, 500));
  r = await worker.fetch(request('/health?deep=1'), env());
  assert.equal(r.status, 503);
  assert.equal((await r.json()).ok, false);
});

test('deep health checks the legacy origin in proxy mode', async () => {
  f = stubFetch(url => url === 'https://card.nexbizrise.com/health' ? new Response('ok') : undefined);
  const r = await worker.fetch(request('/health?deep=1'), env({ MODE: 'proxy' }));
  assert.equal(r.status, 200);
});

test('legacy host and www redirect 301 to the same path and query', async () => {
  let r = await worker.fetch(raw('https://card.nexbizrise.com/alex?x=1'), env());
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://linkcardly.com/alex?x=1');
  r = await worker.fetch(raw('https://www.linkcardly.com/designs'), env());
  assert.equal(r.headers.get('Location'), 'https://linkcardly.com/designs');
});

test('empty LEGACY_HOSTS does not redirect anything', async () => {
  assert.equal((await worker.fetch(raw('https://linkcardly.com/health'), env({ LEGACY_HOSTS: '' }))).status, 200);
});

test('/order redirects to /create keeping the query', async () => {
  for (const p of ['/order?colour=x']) {
    const r = await worker.fetch(request(p), env());
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('Location'), 'https://linkcardly.com/create?colour=x');
  }
});

test('/create serves the vendored order app in place (no redirect)', async () => {
  const r = await worker.fetch(request('/create?colour=x'), env());
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Order your digital business card \| Linkcardly/);
});

test('every marketing page and asset is served at its canonical URL', async () => {
  for (const p of ['/', '/how-it-works', '/pricing', '/claim', '/designs', '/nfc-cards', '/teams', '/contact', '/privacy', '/terms', '/refunds', '/robots.txt', '/sitemap.xml', '/favicon.svg', '/assets/css/site.css', '/assets/js/icons.js', '/assets/js/rules.js']) {
    assert.equal((await worker.fetch(request(p), env())).status, 200, p);
  }
});

test('trailing-slash URLs redirect to the canonical URL', async () => {
  const r = await worker.fetch(request('/designs/'), env());
  assert.equal(r.status, 307);
  assert.equal(new URL(r.headers.get('Location')).pathname, '/designs');
});

test('missing static file returns the 404 page with status 404', async () => {
  const r = await worker.fetch(request('/assets/nope.css'), env());
  assert.equal(r.status, 404);
  assert.match(await r.text(), /couldn't find that page/);
});

test('proxy mode: /api/* is forwarded to LEGACY_ORIGIN with method, body and query', async () => {
  f = stubFetch(url => url.startsWith('https://card.nexbizrise.com/api/order') ? json({ ok: 1 }) : undefined);
  const r = await worker.fetch(request('/api/order?a=1', { method: 'POST', body: '{"x":1}', headers: { 'Content-Type': 'application/json' } }), env({ MODE: 'proxy' }));
  assert.equal(r.status, 200);
  assert.equal(f.calls[0].url, 'https://card.nexbizrise.com/api/order?a=1');
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].body, '{"x":1}');
  assert.equal(f.calls[0].headers['x-brand'], 'linkcardly');
});

test('proxy mode: Location headers from the legacy origin are rewritten', async () => {
  f = stubFetch(() => new Response(null, { status: 302, headers: { Location: 'https://card.nexbizrise.com/create?paid=1' } }));
  const r = await worker.fetch(request('/api/pay/return'), env({ MODE: 'proxy' }));
  assert.equal(r.headers.get('Location'), 'https://linkcardly.com/create?paid=1');
});

test('proxy mode: card links and edit links are served in place, keeping the path', async () => {
  f = stubFetch(() => undefined);
  for (const p of ['/alexmorgan', '/c/nbr_ab12cd', '/e/' + 'a'.repeat(40)]) {
    const r = await worker.fetch(request(p), env({ MODE: 'proxy' }));
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /<html/i, p);
  }
  assert.equal(f.calls.length, 0);
});

test('proxy mode: only /api/* is forwarded; other unknown paths (e.g. /admin/x) are a local 404', async () => {
  f = stubFetch(() => new Response('legacy'));
  for (const p of ['/admin/x', '/alex/contact.vcf', '/wp-login.php/x']) {
    const r = await worker.fetch(request(p), env({ MODE: 'proxy' }));
    assert.equal(r.status, 404, p);
    assert.match(await r.text(), /couldn't find that page/, p);
  }
  assert.equal(f.calls.length, 0);
});

test('proxy mode: cookies and Authorization are not forwarded, and Set-Cookie is not passed back', async () => {
  f = stubFetch(() => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=1; Path=/' } }));
  const r = await worker.fetch(request('/api/card/alex', { headers: { Cookie: 'a=1', Authorization: 'Bearer x' } }), env({ MODE: 'proxy' }));
  assert.equal(f.calls[0].headers.cookie, undefined);
  assert.equal(f.calls[0].headers.authorization, undefined);
  assert.equal(r.headers.get('set-cookie'), null);
});

test('proxy mode: upstream network failure degrades to a JSON 502', async () => {
  f = stubFetch(() => { throw new TypeError('network'); });
  const r = await worker.fetch(request('/api/order', { method: 'POST', body: '{}' }), env({ MODE: 'proxy' }));
  assert.equal(r.status, 502);
  assert.ok((await r.json()).message);
});

test('native mode: card and edit links serve the card and order app, same as proxy mode', async () => {
  for (const [p, marker] of [['/sandeep-k', 'card'], ['/c/nbr_ab12cd', 'card'], ['/e/' + 'a'.repeat(40), 'order']]) {
    const r = await worker.fetch(request(p), env());
    assert.equal(r.status, 200, p);
    assert.equal(assets.calls.at(-1), '/app/' + marker, p);
  }
});

test('security headers on every response; CSP only on pages this repo renders', async () => {
  f = stubFetch(() => new Response('legacy', { headers: { 'Content-Type': 'text/html' } }));
  for (const [p, mode, csp] of [['/', 'proxy', true], ['/designs', 'proxy', true], ['/nope.css', 'proxy', true], ['/create', 'proxy', false], ['/alexmorgan', 'proxy', false], ['/e/' + 'a'.repeat(40), 'proxy', false], ['/admin', 'proxy', false], ['/admin/x', 'proxy', true]]) {
    const r = await worker.fetch(request(p), env({ MODE: mode }));
    for (const h of ['strict-transport-security', 'x-content-type-options', 'referrer-policy', 'x-frame-options']) assert.ok(r.headers.get(h), `${p}: ${h}`);
    assert.equal(!!r.headers.get('content-security-policy'), csp, `${p}: CSP`);
  }
});

test('edit links are not cached and send no referrer', async () => {
  const r = await worker.fetch(request('/e/' + 'b'.repeat(40)), env({ MODE: 'proxy' }));
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.match(r.headers.get('cache-control'), /no-store/);
});

test('rate limiter: blocked requests get a 429 and limited routes are keyed per IP and route', async () => {
  const keys = [];
  const RATE_LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
  f = stubFetch(() => json({}));
  const r = await worker.fetch(request('/api/order', { method: 'POST', body: '{}', headers: { 'CF-Connecting-IP': '1.2.3.4' } }), env({ MODE: 'proxy', RATE_LIMITER }));
  assert.equal(r.status, 429);
  assert.deepEqual(keys, ['1.2.3.4:order']);
  // Card-view analytics are not rate limited.
  assert.equal((await worker.fetch(request('/api/hit', { method: 'POST', body: '{}' }), env({ MODE: 'proxy', RATE_LIMITER }))).status, 200);
});

test('logs never contain edit tokens', async () => {
  const lines = [], orig = console.log;
  console.log = l => lines.push(l);
  try { await worker.fetch(request('/e/' + 'c'.repeat(40)), env({ MODE: 'proxy' })); } finally { console.log = orig; }
  assert.ok(lines.length);
  assert.ok(!lines.join('\n').includes('c'.repeat(40)));
});

test('vendored app pages get a report-only CSP; marketing pages keep the enforced one', async () => {
  for (const [p, ro] of [['/create', true], ['/alexmorgan', true], ['/e/' + 'a'.repeat(40), true], ['/', false]]) {
    const r = await worker.fetch(request(p), env({ MODE: 'proxy' }));
    assert.equal(!!r.headers.get('content-security-policy-report-only'), ro, p);
    if (ro) assert.match(r.headers.get('content-security-policy-report-only'), /report-uri \/api\/csp-report/, p);
  }
});

test('/api/csp-report logs the violation without the edit token and is not proxied', async () => {
  f = stubFetch(() => new Response('legacy'));
  const lines = [], orig = console.warn;
  console.warn = l => lines.push(l);
  let r;
  try {
    r = await worker.fetch(request('/api/csp-report', { method: 'POST', body: JSON.stringify({ 'csp-report': { 'document-uri': 'https://linkcardly.com/e/' + 'd'.repeat(40) + '?x=1', 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.test/x.js?q' } }) }), env({ MODE: 'proxy' }));
  } finally { console.warn = orig; }
  assert.equal(r.status, 204);
  assert.equal(f.calls.length, 0);
  const log = JSON.parse(lines[0]);
  assert.deepEqual(log, { t: 'csp', page: 'https://linkcardly.com/e/:token', directive: 'script-src', blocked: 'https://evil.test/x.js' });
});

test('proxy mode: link-preview bots get the card owner in the share preview; people get the page untouched', async () => {
  const row = { first_name: 'Alex', last_name: 'Morgan', title: 'Realtor', company: 'Skyline <Realty>', tagline: 'Homes in KC', photo_url: 'https://cdn.test/a.jpg', extras: { og_image: 'https://cdn.test/og.png' } };
  f = stubFetch(url => /\/api\/card\/(alexmorgan|nbr_ab12cd)$/.test(url) ? json({ row }) : undefined);
  const bot = { 'User-Agent': 'WhatsApp/2.23' };
  let html = await (await worker.fetch(request('/alexmorgan', { headers: bot }), env({ MODE: 'proxy' }))).text();
  assert.match(html, /<title>Alex Morgan · Realtor, Skyline &lt;Realty&gt; \| Linkcardly<\/title>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/cdn\.test\/og\.png">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/linkcardly\.com\/alexmorgan">/);
  assert.match(html, /<meta name="twitter:description" content="Homes in KC">/);
  assert.equal(f.calls[0].url, 'https://card.nexbizrise.com/api/card/alexmorgan');
  html = await (await worker.fetch(request('/c/nbr_ab12cd', { headers: bot }), env({ MODE: 'proxy' }))).text();
  assert.match(html, /<link rel="canonical" href="https:\/\/linkcardly\.com\/c\/nbr_ab12cd">/);
  assert.equal(f.calls[1].url, 'https://card.nexbizrise.com/api/card/nbr_ab12cd');
  // A person: no extra request, default meta.
  const n = f.calls.length;
  html = await (await worker.fetch(request('/alexmorgan', { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone)' } }), env({ MODE: 'proxy' }))).text();
  assert.equal(f.calls.length, n);
  assert.match(html, /<meta property="og:title" content="Digital business card \| Linkcardly">/);
});

test('proxy mode: share preview falls back to the default page when the card lookup fails', async () => {
  f = stubFetch(() => { throw new TypeError('network'); });
  const r = await worker.fetch(request('/alexmorgan', { headers: { 'User-Agent': 'facebookexternalhit/1.1' } }), env({ MODE: 'proxy' }));
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<meta property="og:title" content="Digital business card \| Linkcardly">/);
});

test('CSP lets the browser reach only this environment\'s database (the one in /app/config.js)', async () => {
  for (const [e, origin] of [[env(), 'https://db.test'], [env({ MODE: 'proxy' }), 'https://hyaqvmrtqafqhbhcdecd.supabase.co']]) {
    const page = await worker.fetch(request('/contact'), e);
    assert.match(page.headers.get('content-security-policy'), new RegExp(`connect-src 'self' ${origin.replace(/\./g, '\\.')};`));
    assert.doesNotMatch(page.headers.get('content-security-policy'), /\*\.supabase\.co/);
    const app = await worker.fetch(request('/create'), e);
    assert.match(app.headers.get('content-security-policy-report-only'), new RegExp(`connect-src 'self' ${origin.replace(/\./g, '\\.')} `));
  }
});

test('/admin serves the admin page: report-only app CSP, never indexed or cached', async () => {
  const r = await worker.fetch(request('/admin'), env());
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>Linkcardly Admin<\/title>/);
  assert.equal(assets.calls.at(-1), '/app/admin');
  assert.ok(r.headers.get('content-security-policy-report-only'));
  assert.equal(r.headers.get('content-security-policy'), null);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(r.headers.get('content-security-policy-report-only'), /esm\.sh/);
  assert.equal((await worker.fetch(request('/admin/x'), env())).status, 404);
});

test('partner link /r/<code>: counts the visit, remembers the code 30 days, opens the order page with it', async () => {
  let called = null;
  f = stubFetch((url, req, body) => { if (url.includes('/rpc/partner_click')) { called = JSON.parse(body); return json({ ok: true, code: 'RIYA' }); } });
  const r = await worker.fetch(raw('https://linkcardly.com/r/riya'), env());
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('Location'), '/create?partner=RIYA');
  assert.deepEqual(called, { p_code: 'RIYA' });
  assert.match(r.headers.get('Set-Cookie'), /^lc_partner=RIYA; Max-Age=2592000; Path=\/; Secure; SameSite=Lax$/);
});

test('partner link: unknown or paused code, bad code and proxy mode just open the order page, without a cookie', async () => {
  f = stubFetch(url => url.includes('/rpc/partner_click') ? json({ ok: false }) : undefined);
  for (const [path, e] of [['/r/nobody', env()], ['/r/a!', env()], ['/r/riya', env({ MODE: 'proxy' })]]) {
    const r = await worker.fetch(raw('https://linkcardly.com' + path), e);
    assert.equal(r.status, 302, path); assert.equal(r.headers.get('Location'), '/create'); assert.equal(r.headers.get('Set-Cookie'), null);
  }
  f.restore();
  f = stubFetch(() => json({}, 500));
  const r = await worker.fetch(raw('https://linkcardly.com/r/riya'), env());
  assert.equal(r.headers.get('Location'), '/create', 'a database error never blocks the visitor');
});

test('partner page API: same origin only, checks the key format, passes key + PIN to the database', async () => {
  const post = (path, body, origin = 'https://linkcardly.com') => worker.fetch(new Request('https://linkcardly.com/api/partner/' + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env());
  const key = 'a'.repeat(40);
  let sent = null;
  f = stubFetch((url, req, body) => { if (url.includes('/rpc/partner_me_token')) { sent = JSON.parse(body); return json({ ok: true, partner: { code: 'RIYA' } }); } if (url.includes('/rpc/partner_set_payout_token')) { sent = JSON.parse(body); return json({ ok: true }); } });
  assert.equal((await post('me', { token: key, pin: '2233' }, 'https://evil.example')).status, 403);
  assert.equal((await post('me', { token: 'nope', pin: '2233' })).status, 400);
  assert.equal((await (await post('me', { token: key, pin: '12' })).json()).error, 'wrong pin');
  const r = await post('me', { token: key, pin: '2233' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(sent, { p_token: key, p_pin: '2233' });
  await post('payout', { token: key, pin: '2233', upi_id: ' riya@okicici ' });
  assert.deepEqual(sent, { p_token: key, p_pin: '2233', p: { upi_id: 'riya@okicici', pan: '', pan_name: '' } });
});

// ---------- partner programme: Worker leak checks (L18–L25) ----------
test('L18 partner API answers POST only', async () => {
  const r = await worker.fetch(new Request('https://linkcardly.com/api/partner/me', { headers: { Origin: 'https://linkcardly.com' } }), env());
  assert.equal(r.status, 404);
});
test('L19 the partner key is never written to the logs', async () => {
  const key = 'b'.repeat(40), seen = [], orig = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...a) => seen.push(a.join(' '));
  f = stubFetch(url => url.includes('/rpc/') ? json({ ok: true, partner: { code: 'X' } }) : undefined);
  try { await worker.fetch(new Request('https://linkcardly.com/api/partner/me', { method: 'POST', headers: { Origin: 'https://linkcardly.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: key, pin: '1234' }) }), env()); }
  finally { [console.log, console.warn, console.error] = orig; }
  assert.ok(!seen.join('\n').includes(key)); assert.ok(!seen.join('\n').includes('1234'));
});
test('L20 the partner page is never cached or indexed', async () => {
  const r = await worker.fetch(raw('https://linkcardly.com/partner'), env());
  assert.equal(r.headers.get('Cache-Control'), 'no-store'); assert.match(r.headers.get('X-Robots-Tag') || '', /noindex/);
});
test('L21 partner links are never cached (each visit is counted)', async () => {
  f = stubFetch(url => url.includes('/rpc/partner_click') ? json({ ok: true, code: 'RIYA' }) : undefined);
  const r = await worker.fetch(raw('https://linkcardly.com/r/riya'), env());
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});
test('L22 an over-long or odd partner code never reaches the database', async () => {
  f = stubFetch(() => json({ ok: true }));
  for (const c of ['x'.repeat(40), 'ri%27ya', 'abc']) await worker.fetch(raw('https://linkcardly.com/r/' + c), env());
  assert.equal(f.calls.filter(x => x.url.includes('/rpc/')).length, 0);
});
test('L23 partner payout API refuses other sites', async () => {
  const r = await worker.fetch(new Request('https://linkcardly.com/api/partner/payout', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(40), pin: '1234', upi_id: 'x@ok' }) }), env());
  assert.equal(r.status, 403);
});
test('L24 database errors reach the partner page as a generic message, never table or function names', async () => {
  f = stubFetch(url => url.includes('/rpc/') ? json({ code: '42P01', message: 'relation partner.partners does not exist' }, 400) : undefined);
  const r = await worker.fetch(new Request('https://linkcardly.com/api/partner/me', { method: 'POST', headers: { Origin: 'https://linkcardly.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(40), pin: '1234' }) }), env());
  const s = await r.text(); assert.ok(!/partner\.partners|relation/.test(s), s);
});
test('L25 the Worker secret goes to the database but never back to the browser', async () => {
  f = stubFetch(url => url.includes('/rpc/') ? json({ ok: true, partner: { code: 'X' } }) : undefined);
  const e = env({ WORKER_SECRET: 's'.repeat(32) });
  const r = await worker.fetch(new Request('https://linkcardly.com/api/partner/me', { method: 'POST', headers: { Origin: 'https://linkcardly.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(40), pin: '1234' }) }), e);
  const call = f.calls.find(x => x.url.includes('/rpc/partner_me_token'));
  assert.equal(call.headers['x-nbr-secret'], 's'.repeat(32)); assert.ok(!(await r.text()).includes('s'.repeat(32)));
  for (const [k, v] of r.headers) assert.ok(!String(v).includes('s'.repeat(32)), k);
});
