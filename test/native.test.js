// Native API (MODE = "native", src/routes/native.js) against a stubbed Supabase, Turnstile, Resend, Razorpay and
// Stripe. The SQL behind each call is covered for real in live-db.test.js; this file checks what the Worker does
// around it: origin and bot checks, what it sends and withholds, signatures, emails, cache purges, the daily job.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { scheduled } from '../src/routes/native.js';
import { hmacHex } from '../src/lib/payments.js';
import { env as baseEnv, request, stubFetch, json } from './helpers.js';

let f;
afterEach(() => { f && f.restore(); f = null; delete globalThis.caches; });

const env = (over = {}) => baseEnv({ SUPABASE_ANON_KEY: 'pub-key', WORKER_SECRET: 'w-secret', RESEND_API_KEY: 're_test', ADMIN_EMAIL: 'hello@linkcardly.com', IMG_BASE: 'https://img.linkcardly.com', ...over });
const ctx = () => { const jobs = []; return { jobs, waitUntil: p => jobs.push(p), done: () => Promise.all(jobs) }; };
const post = (path, body, headers = {}) => request(path, { method: 'POST', headers: { Origin: 'https://linkcardly.com', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5', ...headers }, body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
const rpcCalls = (fn) => f.calls.filter(c => c.url === 'https://db.test/rest/v1/rpc/' + fn);
const mails = () => f.calls.filter(c => c.url === 'https://api.resend.com/emails').map(c => JSON.parse(c.body));

// A small in-memory edge cache, like caches.default.
function fakeCache() {
  const m = new Map();
  globalThis.caches = { default: {
    store: m,
    match: async r => { const v = m.get(r.url); return v ? new Response(v) : undefined; },
    put: async (r, res) => { m.set(r.url, await res.text()); },
    delete: async r => m.delete(r.url)
  } };
  return m;
}

// Supabase + Turnstile + Resend stand-in. `rpcs` maps function name → result (or a function of the body).
function backend(rpcs = {}, { ts = true, views = {} } = {}) {
  return stubFetch(async (url, req, body) => {
    if (url.startsWith('https://challenges.cloudflare.com/')) return json({ success: ts });
    if (url === 'https://api.resend.com/emails') return json({ id: 'em_1' });
    const m = url.match(/^https:\/\/db\.test\/rest\/v1\/rpc\/(\w+)$/);
    if (m && m[1] in rpcs) { const v = rpcs[m[1]]; return typeof v === 'function' ? v(JSON.parse(body || '{}'), req) : json(v); }
    const v = url.match(/^https:\/\/db\.test\/rest\/v1\/(public_cards|public_card_extras)\?/);
    if (v) return json(views[v[1]] || []);
    return undefined;
  });
}

// ---------- card data ----------
test('card data: read from the public views with the publishable key, cached, extras merged', async () => {
  const cache = fakeCache();
  f = backend({}, { views: { public_cards: [{ slug: 'ryan', first_name: 'Ryan' }], public_card_extras: [{ extras: { greeting: 'Hi' } }] } });
  const c = ctx();
  let r = await worker.fetch(request('/api/card/ryan'), env(), c);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).row, { slug: 'ryan', first_name: 'Ryan', extras: { greeting: 'Hi' } });
  assert.equal(f.calls[0].headers.apikey, 'pub-key');
  assert.equal(f.calls[0].headers.authorization, undefined, 'the publishable key is never sent as a Bearer token');
  await c.done();
  assert.ok(cache.has('https://linkcardly.com/api/card/ryan'));
  const n = f.calls.length;
  r = await worker.fetch(request('/api/card/ryan'), env(), ctx());
  assert.equal((await r.json()).row.first_name, 'Ryan');
  assert.equal(f.calls.length, n, 'second read comes from the edge cache');
  assert.equal((await worker.fetch(request('/api/card/Bad..Name'), env(), ctx())).status, 404);
  assert.match(f.calls.find(c => c.url.includes('public_cards')).url, /slug=eq\.ryan/);
  await worker.fetch(request('/api/card/nbr_abc123'), env(), ctx());
  assert.ok(f.calls.some(c => /public_id=eq\.nbr_abc123/.test(c.url)));
});

test('card data: an unknown card is null, not an error', async () => {
  f = backend();
  const r = await worker.fetch(request('/api/card/nobody'), env(), ctx());
  assert.equal(r.status, 200);
  assert.equal((await r.json()).row, null);
});

// ---------- visit counts ----------
test('hit: valid events go to Analytics Engine; junk is ignored; always 204', async () => {
  const points = [];
  const e = env({ STATS: { writeDataPoint: p => points.push(p) } });
  for (const body of [{ k: 'ryan', e: 'view' }, { k: 'ryan', e: 'hack' }, { k: '../x', e: 'view' }, 'not json']) {
    const r = await worker.fetch(post('/api/hit', body), e, ctx());
    assert.equal(r.status, 204);
  }
  assert.equal(points.length, 1);
  assert.deepEqual(points[0].indexes, ['ryan']);
  assert.equal(points[0].blobs[0], 'view');
});

// ---------- uploads ----------
test('upload: the file bytes decide the type; stored under p/<24 hex> on R2; address on img.linkcardly.com', async () => {
  const puts = [];
  const e = env({ PHOTOS: { put: async (k, b, o) => puts.push({ k, o }) } });
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
  let r = await worker.fetch(post('/api/upload', png, { 'Content-Type': 'image/webp' }), e, ctx());
  assert.equal(r.status, 200);
  const { url } = await r.json();
  assert.match(url, /^https:\/\/img\.linkcardly\.com\/p\/[a-f0-9]{24}\.png$/);
  assert.equal(puts[0].o.httpMetadata.contentType, 'image/png');
  r = await worker.fetch(post('/api/upload', new TextEncoder().encode('<svg onload=alert(1)>'), { 'Content-Type': 'image/png' }), e, ctx());
  assert.equal(r.status, 415);
  r = await worker.fetch(post('/api/upload', png, { 'Content-Length': String(6 * 1048576) }), e, ctx());
  assert.equal(r.status, 413);
  assert.equal((await worker.fetch(post('/api/upload', png), env(), ctx())).status, 503, 'no bucket bound');
});

// ---------- origin check ----------
test('forms are refused from other sites (403) before anything else runs', async () => {
  f = backend({ place_order: { order_no: 'NBR-AAAAAA' } });
  for (const p of ['/api/upload', '/api/order', '/api/edit', '/api/lead', '/api/contact', '/api/pay/start', '/api/pay/verify']) {
    const r = await worker.fetch(post(p, {}, { Origin: 'https://evil.example' }), env(), ctx());
    assert.equal(r.status, 403, p);
  }
  assert.equal(f.calls.length, 0);
  // Webhooks come from the providers, not a browser: no origin check there.
  assert.equal((await worker.fetch(post('/api/razorpay/webhook', {}, { Origin: '' }), env(), ctx())).status, 503);
});

// ---------- orders ----------
const payload = (over = {}) => ({ mode: 'builder', plan: 'basic', region: 'IN', customer_name: 'Asha Rao', customer_email: 'asha@example.com', customer_phone: '9811111111', card: { slug: 'asha' }, ...over });

test('order: bot check first; a failed check never reaches the database', async () => {
  f = backend({ place_order: {} }, { ts: false });
  const r = await worker.fetch(post('/api/order', { ts: 'tok', body: { payload: payload() } }), env(), ctx());
  assert.equal(r.status, 403);
  assert.equal(rpcCalls('place_order').length, 0);
});

test('order (unpaid): sent with the worker secret and real IP; edit token withheld; payment started; emails sent', async () => {
  // One stand-in for all services:
  f = stubFetch(async (url, req, body) => {
    if (url === 'https://api.razorpay.com/v1/orders') return json({ id: 'order_R1' });
    if (url.startsWith('https://challenges.cloudflare.com/')) return json({ success: true });
    if (url === 'https://api.resend.com/emails') return json({ id: 'em' });
    if (url === 'https://db.test/rest/v1/rpc/place_order') return json({ order_no: 'NBR-AB12CD', slug: 'asha', total: 199, pay_status: 'pending', edit_token: 'secret-token' });
  });
  const c = ctx();
  const r = await worker.fetch(post('/api/order', { ts: 'tok', body: { payload: payload() } }), env({ RAZORPAY_KEY_ID: 'rzp_test_1', RAZORPAY_KEY_SECRET: 'rk' }), c);
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.edit_token, undefined, 'unpaid orders never get the edit link back');
  assert.deepEqual(out.pay, { provider: 'razorpay', key: 'rzp_test_1', order_id: 'order_R1', amount: 19900, currency: 'INR', description: 'Digital Card · 1 year', email: 'asha@example.com', contact: '9811111111' });
  const call = rpcCalls('place_order')[0];
  assert.equal(call.headers['x-nbr-secret'], 'w-secret');
  assert.equal(call.headers['x-nbr-ip'], '203.0.113.5');
  assert.deepEqual(JSON.parse(call.body), { payload: payload() });
  const rz = JSON.parse(f.calls.find(c => c.url === 'https://api.razorpay.com/v1/orders').body);
  assert.deepEqual([rz.amount, rz.currency, rz.receipt], [19900, 'INR', 'NBR-AB12CD']);
  await c.done();
  const m = mails();
  assert.equal(m.length, 1, 'online payment: only the admin email (the customer gets one when paid)');
  assert.deepEqual(m[0].to, ['hello@linkcardly.com']);
  assert.match(m[0].subject, /New order NBR-AB12CD/);
  assert.doesNotMatch(JSON.stringify(m), /secret-token/);
});

test('order (unpaid, payments not set up): customer told a payment link follows; pay is null', async () => {
  f = backend({ place_order: { order_no: 'NBR-AB12CD', slug: 'asha', total: 199, pay_status: 'pending', edit_token: 'secret-token' } });
  const c = ctx();
  const out = await (await worker.fetch(post('/api/order', { ts: 'tok', body: { payload: payload() } }), env(), c)).json();
  assert.equal(out.pay, null);
  await c.done();
  const m = mails();
  assert.deepEqual(m.map(x => x.to[0]).sort(), ['asha@example.com', 'hello@linkcardly.com']);
  assert.match(m.find(x => x.to[0] === 'hello@linkcardly.com').html, /Payment is not set up online/);
});

test('order (already paid: test mode or free coupon): edit link returned and emailed; repeat orders send nothing', async () => {
  f = backend({ place_order: { order_no: 'NBR-AB12CD', slug: 'asha', total: 49, pay_status: 'paid', edit_token: 'tok123', test: true } });
  const c = ctx();
  const out = await (await worker.fetch(post('/api/order', { ts: 'tok', body: { payload: payload() } }), env(), c)).json();
  assert.equal(out.edit_token, 'tok123');
  assert.equal(out.pay, undefined);
  await c.done();
  const cust = mails().find(x => x.to[0] === 'asha@example.com');
  assert.equal(cust.subject, 'Your Linkcardly card is live');
  assert.match(cust.html, /https:\/\/linkcardly\.com\/e\/tok123/);
  assert.match(cust.html, /https:\/\/linkcardly\.com\/asha/);
  assert.equal(mails().find(x => x.to[0] === 'hello@linkcardly.com').subject, 'Test order (no payment): NBR-AB12CD');
  f.restore();
  f = backend({ place_order: { order_no: 'NBR-AB12CD', slug: 'asha', total: 0, pay_status: 'paid', edit_token: 'tok123', repeat: true } });
  const c2 = ctx();
  await worker.fetch(post('/api/order', { ts: 'tok', body: { payload: payload() } }), env(), c2);
  await c2.done();
  assert.equal(mails().length, 0);
});

test('order: database refusals ("link taken") pass through; internal errors do not leak', async () => {
  f = backend({ place_order: () => json({ code: 'P0001', message: 'link taken' }, 400) });
  let r = await worker.fetch(post('/api/order', { ts: 't', body: { payload: payload() } }), env(), ctx());
  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, 'link taken');
  f.restore();
  f = backend({ place_order: () => json({ code: '42P01', message: 'relation "orders" does not exist' }, 500) });
  r = await worker.fetch(post('/api/order', { ts: 't', body: { payload: payload() } }), env(), ctx());
  assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /relation|orders/);
});

// ---------- edits ----------
test('edit: saves through update_card_by_token and purges the cached card (name and id)', async () => {
  const cache = fakeCache();
  cache.set('https://linkcardly.com/api/card/asha', '{"row":{}}');
  cache.set('https://linkcardly.com/api/card/nbr_abc123', '{"row":{}}');
  f = backend({ update_card_by_token: { ok: true, slug: 'asha', public_id: 'nbr_abc123' } });
  const body = { p_token: 't0k', p: { first_name: 'Asha' } };
  const r = await worker.fetch(post('/api/edit', { body }), env(), ctx());
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(rpcCalls('update_card_by_token')[0].body), body);
  assert.equal(cache.size, 0);
});

// ---------- card contact form ----------
test('lead: emails the card owner; owner details never go back to the visitor', async () => {
  f = backend({ submit_lead: { ok: true, owner_email: 'owner@example.com', owner_name: 'Owner' } });
  const c = ctx();
  const r = await worker.fetch(post('/api/lead', { ts: 't', body: { p_slug: 'asha', p_name: '<b>Vik</b>', p_phone: '9812345678' } }), env(), c);
  const out = await r.json();
  assert.deepEqual(out, { ok: true });
  await c.done();
  const m = mails()[0];
  assert.deepEqual(m.to, ['owner@example.com']);
  assert.match(m.html, /&lt;b&gt;Vik&lt;\/b&gt;/, 'visitor text is escaped');
});

// ---------- linkcardly.com contact form ----------
test('contact: Turnstile token from the form; maps to submit_site_lead; emails Linkcardly', async () => {
  f = backend({ submit_site_lead: { ok: true } });
  const c = ctx();
  const r = await worker.fetch(post('/api/contact', { name: 'Asha', company: 'Asha Co', email: 'a@example.com', message: 'Need 20 cards please', turnstile: 'tok' }), env(), c);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(rpcCalls('submit_site_lead')[0].body).p, { name: 'Asha', business_name: 'Asha Co', email: 'a@example.com', phone: '', message: 'Need 20 cards please', preferred_contact_method: 'email' });
  await c.done();
  assert.deepEqual(mails()[0].to, ['hello@linkcardly.com']);
  f.restore();
  f = backend({ submit_site_lead: { ok: true } }, { ts: false });
  assert.equal((await worker.fetch(post('/api/contact', { name: 'A', turnstile: '' }), env(), ctx())).status, 403);
});

// ---------- payments ----------
const RZP = { RAZORPAY_KEY_ID: 'rzp_test_1', RAZORPAY_KEY_SECRET: 'rk_secret', RAZORPAY_WEBHOOK_SECRET: 'wh_secret' };

test('pay/start: checks order number and idem, re-prices from the database', async () => {
  f = stubFetch(async url => {
    if (url === 'https://db.test/rest/v1/rpc/get_order_for_pay') return json({ order_no: 'NBR-AB12CD', total: 499, currency: 'USD', pay_status: 'pending', plan: 'motion' });
    if (url === 'https://api.stripe.com/v1/checkout/sessions') return json({ url: 'https://checkout.stripe.com/c/x' });
  });
  const idem = '11111111-2222-3333-4444-555555555555';
  assert.equal((await worker.fetch(post('/api/pay/start', { order_no: 'bad', idem }), env(), ctx())).status, 400);
  assert.equal((await worker.fetch(post('/api/pay/start', { order_no: 'NBR-AB12CD', idem }), env(), ctx())).status, 503, 'stripe not set up');
  const r = await worker.fetch(post('/api/pay/start', { order_no: 'NBR-AB12CD', idem }), env({ STRIPE_SECRET_KEY: 'sk_test' }), ctx());
  assert.deepEqual((await r.json()).pay, { provider: 'stripe', url: 'https://checkout.stripe.com/c/x' });
  const form = new URLSearchParams(f.calls.find(c => c.url.endsWith('/checkout/sessions')).body);
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '49900');
  assert.equal(form.get('client_reference_id'), 'NBR-AB12CD');
  assert.equal(form.get('success_url'), 'https://linkcardly.com/create?paid={CHECKOUT_SESSION_ID}');
});

test('pay/verify (Razorpay): a wrong signature is refused; a right one marks the order paid with the captured amount', async () => {
  f = stubFetch(async url => {
    if (url === 'https://api.razorpay.com/v1/payments/pay_1') return json({ status: 'captured', order_id: 'order_R1', amount: 19900, currency: 'INR' });
    if (url === 'https://api.razorpay.com/v1/orders/order_R1') return json({ receipt: 'NBR-AB12CD' });
    if (url === 'https://db.test/rest/v1/rpc/mark_order_paid') return json({ first: true, order_no: 'NBR-AB12CD', slug: 'asha', mode: 'builder', customer_email: 'asha@example.com', edit_token: 'new-tok', total: 199, currency: 'INR' });
    if (url === 'https://api.resend.com/emails') return json({});
  });
  const body = { razorpay_order_id: 'order_R1', razorpay_payment_id: 'pay_1', razorpay_signature: 'f'.repeat(64) };
  assert.equal((await worker.fetch(post('/api/pay/verify', body), env(RZP), ctx())).status, 400);
  body.razorpay_signature = await hmacHex('rk_secret', 'order_R1|pay_1');
  const c = ctx();
  const r = await worker.fetch(post('/api/pay/verify', body), env(RZP), c);
  const out = await r.json();
  assert.deepEqual(out, { ok: true, paid: true, order_no: 'NBR-AB12CD', slug: 'asha', mode: 'builder' });
  assert.equal(out.edit_token, undefined, 'the new edit link goes by email only');
  assert.deepEqual(JSON.parse(f.calls.find(c => c.url.endsWith('/mark_order_paid')).body), { p_order_no: 'NBR-AB12CD', p_provider: 'razorpay', p_ref: 'pay_1', p_amount_minor: 19900, p_currency: 'INR' });
  await c.done();
  assert.match(mails().find(m => m.to[0] === 'asha@example.com').html, /\/e\/new-tok/);
});

const rzpHook = async (event, payload) => {
  const raw = JSON.stringify({ event, payload });
  return post('/api/razorpay/webhook', raw, { Origin: '', 'X-Razorpay-Signature': await hmacHex('wh_secret', raw) });
};

test('Razorpay webhook: signature checked; paid marks paid; full refund marks refunded; partial refund does not', async () => {
  const marks = [];
  f = stubFetch(async (url, req, body) => {
    if (url.endsWith('/rpc/mark_order_paid') || url.endsWith('/rpc/mark_order_refunded')) { marks.push([url.split('/').pop(), JSON.parse(body)]); return json({ first: false, changed: false }); }
    if (url === 'https://api.razorpay.com/v1/orders/order_R1') return json({ receipt: 'NBR-AB12CD' });
    if (url === 'https://api.razorpay.com/v1/payments/pay_full') return json({ order_id: 'order_R1', amount: 19900, amount_refunded: 19900 });
    if (url === 'https://api.razorpay.com/v1/payments/pay_part') return json({ order_id: 'order_R1', amount: 19900, amount_refunded: 5000 });
  });
  const bad = post('/api/razorpay/webhook', '{"event":"order.paid"}', { Origin: '', 'X-Razorpay-Signature': 'nope' });
  assert.equal((await worker.fetch(bad, env(RZP), ctx())).status, 400);
  assert.equal((await worker.fetch(await rzpHook('order.paid', { payment: { entity: { id: 'pay_1', status: 'captured', order_id: 'order_R1', amount: 19900, currency: 'INR' } } }), env(RZP), ctx())).status, 200);
  await worker.fetch(await rzpHook('refund.processed', { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_full' } } }), env(RZP), ctx());
  await worker.fetch(await rzpHook('refund.processed', { refund: { entity: { id: 'rfnd_2', payment_id: 'pay_part' } } }), env(RZP), ctx());
  await worker.fetch(await rzpHook('payment.failed', { payment: { entity: { id: 'pay_x', order_id: 'order_R1', error_reason: 'payment_failed' } } }), env(RZP), ctx());
  assert.deepEqual(marks, [
    ['mark_order_paid', { p_order_no: 'NBR-AB12CD', p_provider: 'razorpay', p_ref: 'pay_1', p_amount_minor: 19900, p_currency: 'INR' }],
    ['mark_order_refunded', { p_order_no: 'NBR-AB12CD', p_provider: 'razorpay', p_ref: 'rfnd_1' }]
  ]);
});

test('Stripe webhook: stale or wrong signatures refused; paid and refunded events handled', async () => {
  const marks = [];
  f = stubFetch(async (url, req, body) => {
    if (url.endsWith('/rpc/mark_order_paid') || url.endsWith('/rpc/mark_order_refunded')) { marks.push(url.split('/').pop() + ':' + JSON.parse(body).p_order_no); return json({ first: false, changed: false }); }
    if (url === 'https://api.stripe.com/v1/payment_intents/pi_1') return json({ metadata: { order_no: 'NBR-ZZ12CD' } });
  });
  const e = env({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'whsec' });
  const hook = async (obj, t = Math.floor(Date.now() / 1000), secret = 'whsec') => {
    const raw = JSON.stringify(obj);
    return post('/api/stripe/webhook', raw, { Origin: '', 'Stripe-Signature': `t=${t},v1=${await hmacHex(secret, t + '.' + raw)}` });
  };
  const paid = { type: 'checkout.session.completed', data: { object: { payment_status: 'paid', client_reference_id: 'NBR-ZZ12CD', payment_intent: 'pi_1', amount_total: 499, currency: 'usd' } } };
  assert.equal((await worker.fetch(await hook(paid, Math.floor(Date.now() / 1000) - 3600), e, ctx())).status, 400, 'older than 10 minutes');
  assert.equal((await worker.fetch(await hook(paid, undefined, 'other'), e, ctx())).status, 400);
  assert.equal((await worker.fetch(await hook(paid), e, ctx())).status, 200);
  await worker.fetch(await hook({ type: 'charge.refunded', data: { object: { id: 'ch_1', refunded: true, payment_intent: 'pi_1' } } }), e, ctx());
  await worker.fetch(await hook({ type: 'charge.refunded', data: { object: { id: 'ch_2', refunded: false, payment_intent: 'pi_1' } } }), e, ctx());
  assert.deepEqual(marks, ['mark_order_paid:NBR-ZZ12CD', 'mark_order_refunded:NBR-ZZ12CD']);
});

test('webhooks are off (503) until their secrets are set', async () => {
  assert.equal((await worker.fetch(post('/api/razorpay/webhook', '{}', { Origin: '' }), env(), ctx())).status, 503);
  assert.equal((await worker.fetch(post('/api/stripe/webhook', '{}', { Origin: '' }), env(), ctx())).status, 503);
});

// ---------- admin ----------
test('stats and purge need a Supabase admin login', async () => {
  f = stubFetch(async (url, req) => {
    if (url.endsWith('/rpc/is_admin')) return json(req.headers.get('authorization') === 'Bearer good.jwt');
    if (url.includes('/analytics_engine/sql')) return json({ data: [{ k: 'asha', e: 'view', n: 3 }] });
  });
  const e = env({ CF_ANALYTICS_TOKEN: 'cfat', CF_ACCOUNT_ID: 'acc', STATS_DATASET: 'linkcardly_stats_staging' });
  assert.equal((await worker.fetch(request('/api/stats'), e, ctx())).status, 401);
  assert.equal((await worker.fetch(request('/api/stats', { headers: { Authorization: 'Bearer bad.jwt' } }), e, ctx())).status, 401);
  const r = await worker.fetch(request('/api/stats', { headers: { Authorization: 'Bearer good.jwt' } }), e, ctx());
  assert.deepEqual((await r.json()).data, [{ k: 'asha', e: 'view', n: 3 }]);
  assert.match(f.calls.find(c => c.url.includes('analytics_engine')).body, /FROM linkcardly_stats_staging /);
  assert.equal((await worker.fetch(post('/api/purge', { keys: ['asha'] }), e, ctx())).status, 401);
});

test('unknown API routes are 404 in native mode', async () => {
  assert.equal((await worker.fetch(request('/api/nope'), env(), ctx())).status, 404);
});

// ---------- app settings ----------
test('/app/config.js: Linkcardly settings in native mode, NexBizRise ones in proxy mode', async () => {
  const read = async e => { const t = await (await worker.fetch(request('/app/config.js'), e, ctx())).text(); const w = {}; new Function('window', t)(w); return w.LC_CONFIG; };
  assert.deepEqual(await read(env({ SUPABASE_ANON_KEY: 'sb_publishable_new', TURNSTILE_SITE_KEY: '0xNEW' })), { native: true, supabaseUrl: 'https://db.test', supabaseKey: 'sb_publishable_new', turnstileSiteKey: '0xNEW', payments: false, orderUrl: '/create' });
  assert.equal((await read(env({ RAZORPAY_KEY_ID: 'rzp', RAZORPAY_KEY_SECRET: 'x' }))).payments, true, 'payments on once a provider has keys');
  const p = await read(env({ MODE: 'proxy' }));
  assert.equal(p.native, false);
  assert.equal(p.supabaseUrl, 'https://hyaqvmrtqafqhbhcdecd.supabase.co');
});

// ---------- daily job ----------
test('scheduled: renewal reminders emailed; the cron key is sent; off without it', async () => {
  f = stubFetch(async url => {
    if (url.endsWith('/rpc/renewal_due')) return json([{ r_email: 'asha@example.com', r_first_name: 'Asha', r_slug: 'asha', r_days: 7, r_renewal: '2026-10-10' }, { r_email: 'bad', r_days: 0 }]);
    if (url === 'https://api.resend.com/emails') return json({});
  });
  assert.deepEqual(await scheduled(env()), { ok: false, reason: 'not configured' });
  const r = await scheduled(env({ CRON_KEY: 'ck' }));
  assert.deepEqual(r, { ok: true, due: 2, sent: 1 });
  assert.deepEqual(JSON.parse(f.calls.find(c => c.url.endsWith('/renewal_due')).body), { p_key: 'ck' });
  assert.equal(mails()[0].subject, 'Your Linkcardly card renews in 7 days');
});

test('scheduled handler runs in both modes (keeps the database active before cutover)', async () => {
  f = stubFetch(async () => json([]));
  for (const MODE of ['proxy', 'native']) {
    const c = ctx();
    await worker.scheduled({}, env({ MODE, CRON_KEY: 'ck' }), c);
    await c.done();
  }
  assert.equal(f.calls.filter(x => x.url.endsWith('/renewal_due')).length, 2);
});

test('local photos (/img/p/...) are served only when SERVE_IMG = "1"', async () => {
  const PHOTOS = { get: async k => k === 'p/0123456789abcdef01234567.png' ? { body: 'PNG', httpMetadata: { contentType: 'image/png' } } : null };
  assert.equal((await worker.fetch(request('/img/p/0123456789abcdef01234567.png'), env({ PHOTOS }), ctx())).status, 404);
  const r = await worker.fetch(request('/img/p/0123456789abcdef01234567.png'), env({ PHOTOS, SERVE_IMG: '1' }), ctx());
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Type'), 'image/png');
  assert.equal((await worker.fetch(request('/img/p/../secret'), env({ PHOTOS, SERVE_IMG: '1' }), ctx())).status, 404);
});

test('deep health reads the public view with the publishable key only, and flags a missing Worker secret', async () => {
  f = stubFetch(url => url.startsWith('https://db.test/rest/v1/public_cards') ? json([]) : undefined);
  let r = await worker.fetch(request('/health?deep=1'), env(), ctx());
  assert.equal(r.status, 200);
  assert.equal(f.calls[0].headers.apikey, 'pub-key');
  assert.equal(f.calls[0].headers.authorization, undefined);
  r = await worker.fetch(request('/health?deep=1'), env({ WORKER_SECRET: '' }), ctx());
  assert.equal(r.status, 503);
  assert.equal((await r.json()).checks.find(c => c.name === 'worker_secret').ok, false);
});

// ---------- review fixes ----------
test('Razorpay webhook: if Razorpay\'s API is down the webhook answers 5xx (so Razorpay retries), never 200', async () => {
  f = stubFetch(async url => {
    if (url === 'https://api.razorpay.com/v1/orders/order_R1') return json({ error: 'down' }, 500);
  });
  const r = await worker.fetch(await rzpHook('payment.captured', { payment: { entity: { id: 'pay_1', status: 'captured', order_id: 'order_R1', amount: 19900, currency: 'INR' } } }), env(RZP), ctx());
  assert.ok(r.status >= 500, 'answered ' + r.status);
  assert.equal(f.calls.filter(c => c.url.endsWith('/mark_order_paid')).length, 0);
});

test('Stripe webhook: database down while marking paid → 5xx so Stripe retries', async () => {
  f = stubFetch(async url => { if (url.endsWith('/rpc/mark_order_paid')) return json({ message: 'down' }, 503); });
  const e = env({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'whsec' });
  const t = Math.floor(Date.now() / 1000), raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', client_reference_id: 'NBR-ZZ12CD', amount_total: 499, currency: 'usd' } } });
  const r = await worker.fetch(post('/api/stripe/webhook', raw, { Origin: '', 'Stripe-Signature': `t=${t},v1=${await hmacHex('whsec', t + '.' + raw)}` }), e, ctx());
  assert.ok(r.status >= 500, 'answered ' + r.status);
});

test('bot check fails closed: a widget on the page but no secret on the Worker refuses the form', async () => {
  f = backend({ place_order: { order_no: 'NBR-AB12CD', slug: 'a', pay_status: 'paid' }, submit_site_lead: { ok: true } });
  const e = env({ TURNSTILE_SECRET: '' });
  assert.equal((await worker.fetch(post('/api/order', { ts: 'x', body: { payload: payload() } }), e, ctx())).status, 403);
  assert.equal((await worker.fetch(post('/api/contact', { name: 'Asha', turnstile: 'x' }), e, ctx())).status, 403);
  assert.equal(rpcCalls('place_order').length, 0);
  // Local development with no widget at all: no check.
  assert.equal((await worker.fetch(post('/api/order', { ts: '', body: { payload: payload() } }), env({ TURNSTILE_SECRET: '', TURNSTILE_SITE_KEY: '' }), ctx())).status, 200);
});

test('card cache: "not found" and cards whose extras failed are not cached; a refund drops the card from the cache', async () => {
  const cache = fakeCache();
  f = backend({}, { views: {} });
  let c = ctx(); await worker.fetch(request('/api/card/nobody'), env(), c); await c.done();
  assert.equal(cache.size, 0, 'not found is not cached');
  f.restore();
  f = stubFetch(async url => url.includes('public_card_extras') ? json({}, 500) : url.includes('public_cards') ? json([{ slug: 'asha' }]) : undefined);
  c = ctx(); const r = await worker.fetch(request('/api/card/asha'), env(), c); await c.done();
  assert.equal((await r.json()).row.slug, 'asha');
  assert.equal(r.headers.get('Cache-Control'), 'no-cache');
  assert.equal(cache.size, 0, 'a card without its extras is not cached');
  f.restore();
  cache.set('https://linkcardly.com/api/card/asha', '{"row":{}}');
  f = stubFetch(async url => {
    if (url.endsWith('/rpc/mark_order_refunded')) return json({ changed: true, order_no: 'NBR-AB12CD', slug: 'asha', public_id: 'nbr_abc123' });
    if (url === 'https://api.razorpay.com/v1/payments/pay_full') return json({ order_id: 'order_R1', amount: 100, amount_refunded: 100 });
    if (url === 'https://api.razorpay.com/v1/orders/order_R1') return json({ receipt: 'NBR-AB12CD' });
    if (url === 'https://api.resend.com/emails') return json({});
  });
  await worker.fetch(await rzpHook('refund.processed', { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_full' } } }), env(RZP), ctx());
  assert.equal(cache.size, 0);
});
