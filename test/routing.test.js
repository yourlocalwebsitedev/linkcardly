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

test('proxy mode: other unknown paths (e.g. /admin) are forwarded to the legacy worker', async () => {
  f = stubFetch(() => new Response('legacy'));
  assert.equal(await (await worker.fetch(request('/admin/x'), env({ MODE: 'proxy' }))).text(), 'legacy');
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
  for (const [p, mode, csp] of [['/', 'proxy', true], ['/designs', 'proxy', true], ['/nope.css', 'proxy', true], ['/create', 'proxy', false], ['/alexmorgan', 'proxy', false], ['/admin', 'proxy', false]]) {
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
