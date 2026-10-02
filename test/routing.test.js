import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { env, request, stubFetch, json } from './helpers.js';

let f;
afterEach(() => f && f.restore());

test('health returns version and mode', async () => {
  assert.equal(await (await worker.fetch(request('/health'), env())).text(), 'ok v2');
  assert.equal(await (await worker.fetch(request('/health'), env({ MODE: 'proxy' }))).text(), 'ok v2 proxy');
});

test('legacy host and www redirect 301 to the same path and query', async () => {
  let r = await worker.fetch(new Request('https://card.nexbizrise.com/alex?x=1', { redirect: 'manual' }), env());
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://linkcardly.com/alex?x=1');
  r = await worker.fetch(new Request('https://www.linkcardly.com/designs', { redirect: 'manual' }), env());
  assert.equal(r.headers.get('Location'), 'https://linkcardly.com/designs');
});

test('empty LEGACY_HOSTS does not redirect anything', async () => {
  const r = await worker.fetch(new Request('https://linkcardly.com/health', { redirect: 'manual' }), env({ LEGACY_HOSTS: '' }));
  assert.equal(r.status, 200);
});

test('/order and /pricing redirect to /create keeping the query', async () => {
  for (const p of ['/order?colour=x', '/pricing?colour=x']) {
    const r = await worker.fetch(request(p), env());
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('Location'), 'https://linkcardly.com/create?colour=x');
  }
});

test('/create serves the vendored order app in place (no redirect)', { todo: 'DEF-00: serveAsset asks for /app/order.html, assets 307 to /app/order' }, async () => {
  const r = await worker.fetch(request('/create'), env());
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Order your digital business card \| Linkcardly/);
});

test('every marketing page and asset is served', async () => {
  for (const p of ['/', '/designs/', '/teams/', '/contact/', '/privacy/', '/terms/', '/refunds/', '/robots.txt', '/sitemap.xml', '/favicon.svg', '/assets/css/site.css', '/assets/js/icons.js']) {
    const r = await worker.fetch(request(p), env());
    assert.equal(r.status, 200, p);
  }
});

test('canonical/sitemap page URLs (no trailing slash) answer 200, not a redirect', { todo: 'DEF-16: /designs 307s to /designs/ while canonical and sitemap say /designs' }, async () => {
  for (const p of ['/designs', '/teams', '/contact', '/privacy', '/terms', '/refunds']) assert.equal((await worker.fetch(request(p), env())).status, 200, p);
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

test('proxy mode: card links and edit links are served in place, keeping the path', { todo: 'DEF-00: 307 to /app/card loses the handle, so every card shows the demo card' }, async () => {
  f = stubFetch(() => undefined);
  for (const p of ['/alexmorgan', '/c/nbr_ab12cd', '/e/' + 'a'.repeat(40)]) {
    const r = await worker.fetch(request(p), env({ MODE: 'proxy' }));
    assert.equal(r.status, 200, p);
  }
  assert.equal(f.calls.length, 0);
});

test('proxy mode: other unknown paths (e.g. /admin) are forwarded to the legacy worker', async () => {
  f = stubFetch(() => new Response('legacy'));
  const r = await worker.fetch(request('/admin/x'), env({ MODE: 'proxy' }));
  assert.equal(await r.text(), 'legacy');
});

test('proxy mode: upstream network failure degrades to a 502, not an exception', { todo: 'DEF-09: no error handling in proxy()' }, async () => {
  f = stubFetch(() => { throw new TypeError('network'); });
  const r = await worker.fetch(request('/api/order', { method: 'POST', body: '{}' }), env({ MODE: 'proxy' }));
  assert.equal(r.status, 502);
});

test('a valid handle containing a dot reaches the card route', { todo: 'DEF-01: isFile() treats /sandeep.k as a static file' }, async () => {
  f = stubFetch(url => url.includes('/handle_history') ? json([]) : url.includes('/cards') ? json([{ id: '1', handle: 'sandeep.k', full_name: 'S K', status: 'live', links: [] }]) : undefined);
  const r = await worker.fetch(request('/sandeep.k'), env());
  assert.equal(r.status, 200);
});

test('security headers are set on HTML responses', { todo: 'DEF-12: no CSP / HSTS / X-Content-Type-Options / frame-ancestors' }, async () => {
  const r = await worker.fetch(request('/'), env());
  for (const h of ['content-security-policy', 'strict-transport-security', 'x-content-type-options']) assert.ok(r.headers.get(h), h);
});
