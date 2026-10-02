import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { env, request, stubFetch, json } from './helpers.js';

let f;
afterEach(() => f && f.restore());

const post = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const form = (path, fields) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return request(path, { method: 'POST', body: fd }); };
const turnstileOk = url => url.includes('turnstile') ? json({ success: true }) : undefined;
const turnstileNo = url => url.includes('turnstile') ? json({ success: false }) : undefined;
const free = url => url.includes('/handle_history?') ? json([]) : url.includes('/cards?handle=') ? json([]) : undefined;
const order = { turnstile: 't', handle: 'Alex-Morgan', full_name: 'Alex Morgan', email: 'a@b.co', phone: '+1 555 0100', instagram: 'alex', plan: 'motion' };

test('GET /api/handle: invalid, missing and reserved handles', async () => {
  assert.deepEqual(await (await worker.fetch(request('/api/handle?h=ab'), env())).json(), { available: false, reason: 'Use 3–30 characters.' });
  assert.equal((await (await worker.fetch(request('/api/handle'), env())).json()).available, false);
  const j = await (await worker.fetch(request('/api/handle?h=admin'), env())).json();
  assert.equal(j.available, false);
  assert.match(j.reason, /reserved/);
});

test('GET /api/handle: available and taken', async () => {
  f = stubFetch(url => url.includes('/handle_history?') ? json([]) : url.includes('/cards?handle=eq.free') ? json([]) : url.includes('/cards?') ? json([{ id: 1 }]) : undefined);
  assert.deepEqual(await (await worker.fetch(request('/api/handle?h=Free'), env())).json(), { available: true, handle: 'free' });
  const t = await (await worker.fetch(request('/api/handle?h=taken'), env())).json();
  assert.equal(t.available, false);
  assert.equal(t.suggestions.length, 3);
  assert.equal(f.calls[0].headers.authorization, 'Bearer service-key');
});

test('GET /api/handle: a former handle (handle_history) is not offered as available', async () => {
  f = stubFetch(url => url.includes('/handle_history') ? json([{ card_id: 'x' }]) : url.includes('/cards') ? json([]) : undefined);
  assert.equal((await (await worker.fetch(request('/api/handle?h=oldname'), env())).json()).available, false);
});

test('POST /api/order: rejects when Turnstile fails, before touching the DB', async () => {
  f = stubFetch(turnstileNo);
  assert.equal((await worker.fetch(post('/api/order', order), env())).status, 400);
  assert.equal(f.calls.filter(c => c.url.includes('db.test')).length, 0);
});

test('POST /api/order: missing token or secret fails closed without calling Turnstile', async () => {
  f = stubFetch(() => undefined);
  assert.equal((await worker.fetch(post('/api/order', { ...order, turnstile: '' }), env())).status, 400);
  assert.equal((await worker.fetch(post('/api/order', order), env({ TURNSTILE_SECRET: '' }))).status, 400);
  assert.equal(f.calls.length, 0);
});

test('POST /api/order: Turnstile outage fails closed with a 400, not an exception', async () => {
  f = stubFetch(url => url.includes('turnstile') ? new Response('<html>', { status: 502 }) : undefined);
  assert.equal((await worker.fetch(post('/api/order', order), env())).status, 400);
});

test('POST /api/order: validation errors', async () => {
  f = stubFetch(turnstileOk);
  assert.equal((await worker.fetch(post('/api/order', { ...order, handle: 'api' }), env())).status, 400);
  assert.equal((await worker.fetch(post('/api/order', { ...order, email: 'nope' }), env())).status, 400);
  assert.equal((await worker.fetch(post('/api/order', { ...order, email: 'a b@c.d' }), env())).status, 400);
  assert.equal((await worker.fetch(post('/api/order', { ...order, full_name: '  ' }), env())).status, 400);
});

test('POST /api/order: malformed JSON body is a 400', async () => {
  f = stubFetch(turnstileOk);
  assert.equal((await worker.fetch(request('/api/order', { method: 'POST', body: '{not json' }), env())).status, 400);
});

test('POST /api/order: taken handle is a 409 with suggestions', async () => {
  f = stubFetch(url => turnstileOk(url) || (url.includes('/handle_history?') ? json([]) : url.includes('/cards?') ? json([{ id: 1 }]) : undefined));
  const r = await worker.fetch(post('/api/order', order), env());
  assert.equal(r.status, 409);
  assert.ok((await r.json()).suggestions);
});

test('POST /api/order: creates a pending card and all its links in one request, server-side fields only', async () => {
  f = stubFetch(url => turnstileOk(url) || free(url) || (url.endsWith('/cards') ? json([{ id: 'card-1' }]) : url.endsWith('/links') ? json([{}]) : undefined));
  const r = await worker.fetch(post('/api/order', { ...order, status: 'live', paid_until: '2099-01-01', edit_token: 'x' }), env());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, handle: 'alex-morgan' });
  const card = JSON.parse(f.calls.find(c => c.url.endsWith('/cards')).body);
  assert.equal(card.status, 'pending');
  assert.equal(card.plan, 'motion');
  assert.equal(card.paid_until, undefined);
  assert.equal(card.edit_token, undefined);
  const linkCalls = f.calls.filter(c => c.url.endsWith('/links'));
  assert.equal(linkCalls.length, 1);
  const links = JSON.parse(linkCalls[0].body);
  assert.deepEqual(links.map(l => l.type), ['call', 'whatsapp', 'email', 'instagram']);
  assert.deepEqual(links.map(l => l.sort_order), [0, 1, 2, 3]);
});

test('POST /api/order: concurrent duplicate insert returns 409, not 500', async () => {
  f = stubFetch(url => turnstileOk(url) || free(url) || (url.endsWith('/cards') ? json({ code: '23505' }, 409) : undefined));
  assert.equal((await worker.fetch(post('/api/order', order), env())).status, 409);
});

test('POST /api/order: if the links insert fails the card is removed so the order can be retried', async () => {
  f = stubFetch((url, req) => turnstileOk(url) || free(url) || (url.endsWith('/cards') ? json([{ id: 'card-9' }]) : url.endsWith('/links') ? json({}, 500) : req.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined));
  const r = await worker.fetch(post('/api/order', order), env());
  assert.equal(r.status, 503);
  assert.ok(f.calls.some(c => c.method === 'DELETE' && c.url.includes('/cards?id=eq.card-9')));
});

test('POST /api/order: Supabase outage returns a JSON 503, not an exception', async () => {
  f = stubFetch(url => turnstileOk(url) || json({}, 500));
  const r = await worker.fetch(post('/api/order', order), env());
  assert.equal(r.status, 503);
  assert.ok((await r.json()).error);
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

test('POST /api/lead: form post stores the lead for a live card with the form on, and redirects back', async () => {
  f = stubFetch(url => turnstileOk(url) || (url.includes('/cards?') ? json([{ id: 'c1' }]) : url.endsWith('/leads') ? json([{}]) : undefined));
  const r = await worker.fetch(form('/api/lead', { 'cf-turnstile-response': 't', handle: 'alex', name: 'Bo', message: 'hello' }), env());
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('Location'), 'https://linkcardly.com/alex?sent=1');
  const q = f.calls.find(c => c.url.includes('/cards?')).url;
  assert.match(q, /status=eq\.live/);
  assert.match(q, /lead_form=is\.true/);
  assert.match(q, /paid_until/);
});

test('POST /api/lead: JSON body is accepted and answered with JSON', async () => {
  f = stubFetch(url => turnstileOk(url) || (url.includes('/cards?') ? json([{ id: 'c1' }]) : url.endsWith('/leads') ? json([{}]) : undefined));
  const r = await worker.fetch(post('/api/lead', { turnstile: 't', handle: 'alex', name: 'Bo', email: 'bo@x.co' }), env());
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(f.calls.at(-1).body).email, 'bo@x.co');
});

test('POST /api/lead: unknown card is a 404; empty lead is a 400', async () => {
  f = stubFetch(url => turnstileOk(url) || (url.includes('/cards?') ? json([]) : undefined));
  assert.equal((await worker.fetch(form('/api/lead', { 'cf-turnstile-response': 't', handle: 'ghost', name: 'Bo' }), env())).status, 404);
  assert.equal((await worker.fetch(form('/api/lead', { 'cf-turnstile-response': 't', handle: 'ghost' }), env())).status, 400);
});

test('GET /api/qr: SVG generated in the Worker for linkcardly.com URLs only', async () => {
  f = stubFetch(() => undefined);
  const r = await worker.fetch(request('/api/qr?u=https://linkcardly.com/alex'), env());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'image/svg+xml');
  assert.match(await r.text(), /^<svg/);
  assert.equal(f.calls.length, 0, 'no third-party call');
  assert.equal((await worker.fetch(request('/api/qr?u=https://evil.test'), env())).status, 400);
  assert.equal((await worker.fetch(request('/api/qr?u=https://linkcardly.com.evil.test/x'), env())).status, 400);
});

test('unknown API route and wrong method are 404 JSON', async () => {
  for (const [p, m] of [['/api/nope', 'GET'], ['/api/order', 'GET'], ['/api/handle', 'POST']]) {
    const r = await worker.fetch(request(p, { method: m, body: m === 'POST' ? '{}' : undefined }), env());
    assert.equal(r.status, 404, `${m} ${p}`);
  }
});

test('POST /api/order: payment is started or a payable order is returned', { todo: 'DEF-02: native mode has no payment lifecycle' }, async () => {
  f = stubFetch(url => turnstileOk(url) || free(url) || (url.endsWith('/cards') ? json([{ id: 'c' }]) : json([{}])));
  const j = await (await worker.fetch(post('/api/order', order), env())).json();
  assert.ok(j.pay || j.checkout_url);
});

test('native mode implements every endpoint the vendored app calls', { todo: 'DEF-28: native mode is not at parity with NexBizRise' }, async () => {
  f = stubFetch(() => json([]));
  for (const [m, p] of [['GET', '/api/card/alex'], ['POST', '/api/hit'], ['POST', '/api/upload'], ['POST', '/api/edit'], ['POST', '/api/pay/start'], ['POST', '/api/pay/verify'], ['GET', '/api/pay/status?sid=x']]) {
    const r = await worker.fetch(request(p, { method: m, body: m === 'POST' ? '{}' : undefined }), env());
    assert.notEqual(r.status, 404, `${m} ${p}`);
  }
});
