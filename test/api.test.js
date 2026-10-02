import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { env, request, stubFetch, json } from './helpers.js';

let f;
afterEach(() => f && f.restore());

const post = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const turnstileOk = url => url.includes('turnstile') ? json({ success: true }) : undefined;
const turnstileNo = url => url.includes('turnstile') ? json({ success: false }) : undefined;
const order = { turnstile: 't', handle: 'Alex-Morgan', full_name: 'Alex Morgan', email: 'a@b.co', phone: '+1 555 0100', instagram: 'alex', plan: 'motion' };

test('GET /api/handle: invalid handle', async () => {
  const j = await (await worker.fetch(request('/api/handle?h=ab'), env())).json();
  assert.deepEqual(j, { available: false, reason: 'Use 3–30 characters.' });
});

test('GET /api/handle: reserved handle', async () => {
  const j = await (await worker.fetch(request('/api/handle?h=admin'), env())).json();
  assert.equal(j.available, false);
  assert.match(j.reason, /reserved/);
});

test('GET /api/handle: available and taken', async () => {
  f = stubFetch(url => url.includes('/cards?handle=eq.free') ? json([]) : url.includes('/cards?') ? json([{ id: 1 }]) : undefined);
  assert.deepEqual(await (await worker.fetch(request('/api/handle?h=Free'), env())).json(), { available: true, handle: 'free' });
  const t = await (await worker.fetch(request('/api/handle?h=taken'), env())).json();
  assert.equal(t.available, false);
  assert.equal(t.suggestions.length, 3);
  assert.equal(f.calls[0].headers.authorization, 'Bearer service-key');
});

test('GET /api/handle: a former handle (handle_history) is not offered as available', { todo: 'DEF-05: only cards is checked' }, async () => {
  f = stubFetch(url => url.includes('/handle_history') ? json([{ card_id: 'x' }]) : url.includes('/cards') ? json([]) : undefined);
  const j = await (await worker.fetch(request('/api/handle?h=oldname'), env())).json();
  assert.equal(j.available, false);
});

test('POST /api/order: rejects when Turnstile fails, before touching the DB', async () => {
  f = stubFetch(turnstileNo);
  const r = await worker.fetch(post('/api/order', order), env());
  assert.equal(r.status, 400);
  assert.equal(f.calls.filter(c => c.url.includes('db.test')).length, 0);
});

test('POST /api/order: rejects missing token without calling Turnstile', async () => {
  f = stubFetch(() => undefined);
  const r = await worker.fetch(post('/api/order', { ...order, turnstile: '' }), env());
  assert.equal(r.status, 400);
  assert.equal(f.calls.length, 0);
});

test('POST /api/order: validation errors', async () => {
  f = stubFetch(turnstileOk);
  assert.equal((await worker.fetch(post('/api/order', { ...order, handle: 'api' }), env())).status, 400);
  assert.equal((await worker.fetch(post('/api/order', { ...order, email: 'nope' }), env())).status, 400);
  assert.equal((await worker.fetch(post('/api/order', { ...order, full_name: '  ' }), env())).status, 400);
});

test('POST /api/order: malformed JSON body is a 400', async () => {
  f = stubFetch(turnstileOk);
  const r = await worker.fetch(request('/api/order', { method: 'POST', body: '{not json' }), env());
  assert.equal(r.status, 400);
});

test('POST /api/order: taken handle is a 409 with suggestions', async () => {
  f = stubFetch(url => turnstileOk(url) || (url.includes('/cards?') ? json([{ id: 1 }]) : undefined));
  const r = await worker.fetch(post('/api/order', order), env());
  assert.equal(r.status, 409);
  assert.ok((await r.json()).suggestions);
});

test('POST /api/order: creates a pending card and its links, server-side fields only', async () => {
  f = stubFetch((url, req, body) => turnstileOk(url) || (url.includes('/cards?') ? json([]) : url.endsWith('/cards') ? json([{ id: 'card-1' }]) : url.endsWith('/links') ? json([{}]) : undefined));
  const r = await worker.fetch(post('/api/order', { ...order, status: 'live', paid_until: '2099-01-01', edit_token: 'x' }), env());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, handle: 'alex-morgan' });
  const card = JSON.parse(f.calls.find(c => c.url.endsWith('/cards')).body);
  assert.equal(card.status, 'pending');
  assert.equal(card.plan, 'motion');
  assert.equal(card.paid_until, undefined);
  assert.equal(card.edit_token, undefined);
  const links = f.calls.filter(c => c.url.endsWith('/links')).map(c => JSON.parse(c.body));
  assert.deepEqual(links.map(l => l.type), ['call', 'whatsapp', 'email', 'instagram']);
  assert.deepEqual(links.map(l => l.sort_order), [0, 1, 2, 3]);
});

test('POST /api/order: concurrent duplicate insert returns 409, not 500', { todo: 'DEF-04: unique violation surfaces as an uncaught exception' }, async () => {
  f = stubFetch(url => turnstileOk(url) || (url.includes('/cards?') ? json([]) : url.endsWith('/cards') ? json({ code: '23505' }, 409) : undefined));
  const r = await worker.fetch(post('/api/order', order), env());
  assert.equal(r.status, 409);
});

test('POST /api/order: Supabase outage returns a JSON 503, not an exception', { todo: 'DEF-04: no error handling around db()' }, async () => {
  f = stubFetch(url => turnstileOk(url) || json({}, 500));
  const r = await worker.fetch(post('/api/order', order), env());
  assert.equal(r.status, 503);
});

test('POST /api/contact: Turnstile, validation and insert', async () => {
  f = stubFetch(turnstileNo);
  assert.equal((await worker.fetch(post('/api/contact', { turnstile: 't', name: 'A', email: 'a@b.co', message: 'hi' }), env())).status, 400);
  f.restore();
  f = stubFetch(url => turnstileOk(url) || (url.endsWith('/contact_messages') ? json([{}]) : undefined));
  assert.equal((await worker.fetch(post('/api/contact', { turnstile: 't', name: 'A', email: 'bad', message: 'hi' }), env())).status, 400);
  const r = await worker.fetch(post('/api/contact', { turnstile: 't', name: 'A', email: 'a@b.co', message: 'x'.repeat(9000) }), env());
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(f.calls.at(-1).body).message.length, 4000);
});

test('POST /api/lead: stores lead for a live card and redirects back', async () => {
  f = stubFetch(url => turnstileOk(url) || (url.includes('/cards?') ? json([{ id: 'c1' }]) : url.endsWith('/leads') ? json([{}]) : undefined));
  const fd = new FormData();
  fd.set('cf-turnstile-response', 't'); fd.set('handle', 'alex'); fd.set('name', 'Bo'); fd.set('message', 'hello');
  const r = await worker.fetch(request('/api/lead', { method: 'POST', body: fd }), env());
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('Location'), 'https://linkcardly.com/alex?sent=1');
  assert.match(f.calls.find(c => c.url.includes('/cards?')).url, /status=eq\.live/);
});

test('POST /api/lead: unknown card is a 404', async () => {
  f = stubFetch(url => turnstileOk(url) || (url.includes('/cards?') ? json([]) : undefined));
  const fd = new FormData(); fd.set('cf-turnstile-response', 't'); fd.set('handle', 'ghost');
  assert.equal((await worker.fetch(request('/api/lead', { method: 'POST', body: fd }), env())).status, 404);
});

test('POST /api/lead: JSON body (as sent by the vendored card app) is a 400, not an exception', { todo: 'DEF-06: req.formData() throws' }, async () => {
  f = stubFetch(turnstileOk);
  const r = await worker.fetch(post('/api/lead', { name: 'x' }), env());
  assert.equal(r.status, 400);
});

test('GET /api/qr: temporary redirect to a third-party QR service', async () => {
  const r = await worker.fetch(request('/api/qr?u=https://linkcardly.com/alex'), env());
  assert.equal(r.status, 302);
  assert.match(r.headers.get('Location'), /^https:\/\/api\.qrserver\.com\/.*data=https%3A%2F%2Flinkcardly\.com%2Falex/);
});

test('GET /api/qr: only linkcardly.com URLs are encoded', { todo: 'DEF-15: arbitrary data accepted and sent to a third party' }, async () => {
  const r = await worker.fetch(request('/api/qr?u=https://evil.test'), env());
  assert.equal(r.status, 400);
});

test('unknown API route and wrong method are 404 JSON', async () => {
  for (const [p, m] of [['/api/nope', 'GET'], ['/api/order', 'GET'], ['/api/handle', 'POST']]) {
    const r = await worker.fetch(request(p, { method: m, body: m === 'POST' ? '{}' : undefined }), env());
    assert.equal(r.status, 404, `${m} ${p}`);
  }
});

test('POST /api/order: payment is started or a payable order is returned', { todo: 'DEF-02: native mode has no payment lifecycle' }, async () => {
  f = stubFetch((url) => turnstileOk(url) || (url.includes('/cards?') ? json([]) : url.endsWith('/cards') ? json([{ id: 'c' }]) : json([{}])));
  const j = await (await worker.fetch(post('/api/order', order), env())).json();
  assert.ok(j.pay || j.checkout_url);
});
