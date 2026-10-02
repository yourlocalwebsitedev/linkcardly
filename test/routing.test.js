import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { env, request, stubFetch, json } from './helpers.js';

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

test('/order and /pricing redirect to /create keeping the query', async () => {
  for (const p of ['/order?colour=x', '/pricing?colour=x']) {
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
  for (const p of ['/', '/designs', '/teams', '/contact', '/privacy', '/terms', '/refunds', '/robots.txt', '/sitemap.xml', '/favicon.svg', '/assets/css/site.css', '/assets/js/icons.js', '/assets/js/rules.js']) {
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

test('proxy mode: only /api/* is forwarded; other unknown paths (e.g. /admin) are a local 404', async () => {
  f = stubFetch(() => new Response('legacy'));
  for (const p of ['/admin', '/admin/x', '/alex/contact.vcf', '/wp-login.php/x']) {
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

test('a valid handle containing a dot reaches the card route', async () => {
  f = stubFetch(url => url.includes('/cards?') ? json([{ id: '1', handle: 'sandeep.k', full_name: 'S K', status: 'live', links: [] }]) : undefined);
  const r = await worker.fetch(request('/sandeep.k'), env());
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<h1>S K<\/h1>/);
});

test('security headers on every response; CSP only on pages this repo renders', async () => {
  f = stubFetch(() => new Response('legacy', { headers: { 'Content-Type': 'text/html' } }));
  for (const [p, mode, csp] of [['/', 'proxy', true], ['/designs', 'proxy', true], ['/nope.css', 'proxy', true], ['/create', 'proxy', false], ['/alexmorgan', 'proxy', false], ['/e/' + 'a'.repeat(40), 'proxy', false], ['/admin', 'proxy', true]]) {
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
