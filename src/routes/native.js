// Native API (MODE = "native"): everything the old NexBizRise worker did for linkcardly.com, against the live
// database (supabase/live/*.sql), Linkcardly's R2 bucket, Turnstile widget, Resend and payment accounts.
//
//   GET  /api/card/<name|nbr_id>   card data for the card page (cached 5 min at the edge, purged on edit)
//   POST /api/hit                  visit and tap counts → Analytics Engine
//   POST /api/upload               photo or video → R2, returns its img.linkcardly.com address
//   POST /api/order                place an order (bot check, database prices it, starts payment, emails)
//   POST /api/edit                 save changes from a private edit link (purges the card cache)
//   POST /api/lead                 contact form on a card (emails the card owner)
//   POST /api/contact              contact form on linkcardly.com (emails Linkcardly)
//   POST /api/pay/start | /api/pay/verify, GET /api/pay/status      Razorpay / Stripe checkout
//   POST /api/razorpay/webhook | /api/stripe/webhook                 paid, failed and refunded events
//   GET  /api/stats, POST /api/purge                                 admin only (Supabase admin login)
// The scheduled job (renewal reminders, which also keeps the database active) is `scheduled()` below.
import { rpc, view, RpcError } from '../lib/live.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { sendMail, mailHtml, esc } from '../lib/mail.js';
import { startPay, payReady, hmacHex, safeEq, razorpay, stripe, ProviderError } from '../lib/payments.js';
import { json } from '../http.js';

const KEY_RE = /^(nbr_[a-f0-9]{6}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const ORDER_NO = /^(NBR|LC)-[A-Z0-9]{6}$/;
const CARD_TTL = 300;
const MEDIA_MAX = 5 * 1048576;
const MEDIA_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const HIT_EVENTS = ['view', 'save', 'call', 'text', 'email', 'whatsapp', 'link', 'share', 'qr', 'lead'];
const noStore = { 'Cache-Control': 'no-store' };
const fail = (message, status) => json({ message, error: message }, status, noStore);
const edgeCache = () => (typeof caches !== 'undefined' && caches.default) || null;
const site = env => String(env.SITE_URL || 'https://linkcardly.com').replace(/\/$/, '');
const cardLink = (env, slug, pid) => site(env) + (slug ? '/' + slug : '/c/' + pid);
const editLink = (env, tok) => tok ? site(env) + '/e/' + tok : '';
const ipOf = req => req.headers.get('CF-Connecting-IP') || '';
const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'there';

// Bot check. Off only where no widget is configured at all (local development); if the page shows a widget but the
// Worker has no secret, it fails closed instead of letting every request through.
const botOk = (env, token, ip) => (!env.TURNSTILE_SITE_KEY && !env.TURNSTILE_SECRET) ? Promise.resolve(true) : verifyTurnstile(env, token, ip);

// Forms are only accepted from our own pages (the browser always sends Origin on a cross-site POST).
function sameOrigin(req, url, env) {
  const o = req.headers.get('Origin') || '';
  return o === url.origin || o === site(env);
}

async function readJson(req, max = 3500000) {
  const t = await req.text();
  if (t.length > max) throw new RpcError(413, 'payload too large');
  try { return JSON.parse(t || '{}') || {}; } catch (_) { throw new RpcError(400, 'bad request'); }
}

const later = (ctx, p) => { const q = Promise.resolve(p).catch(e => console.error(JSON.stringify({ t: 'after', error: String(e && e.message || e) }))); if (ctx && ctx.waitUntil) ctx.waitUntil(q); return q; };

// ---------- card data (shared with link previews in src/routes/og.js) ----------
const cacheKey = (env, key) => new Request(site(env) + '/api/card/' + key);

export async function cardData(env, key, ctx) {
  const cache = edgeCache(), ck = cacheKey(env, key);
  if (cache) { const hit = await cache.match(ck); if (hit) return (await hit.json()).row || null; }
  const col = key.startsWith('nbr_') ? 'public_id' : 'slug', q = `select=*&${col}=eq.${encodeURIComponent(key)}`;
  let extrasOk = true;
  const [rows, extras] = await Promise.all([view(env, 'public_cards', q), view(env, 'public_card_extras', `select=extras&${col}=eq.${encodeURIComponent(key)}`).catch(() => { extrasOk = false; return []; })]);
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (row && Array.isArray(extras) && extras[0] && extras[0].extras) row.extras = extras[0].extras;
  // Only a complete, existing card is cached: "not found" may become live any minute (payment), and a card whose
  // extras couldn't be read would lose its booking link and contact form for the whole cache time.
  if (cache && row && extrasOk) later(ctx, cache.put(ck, new Response(JSON.stringify({ row }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + CARD_TTL } })));
  return row;
}

async function purgeCards(env, keys) {
  const cache = edgeCache(); if (!cache) return;
  for (const k of keys) if (typeof k === 'string' && KEY_RE.test(k)) { try { await cache.delete(cacheKey(env, k)); } catch (_) {} }
}

// ---------- uploads ----------
function sniff(b) {
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'video/mp4';
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'video/webm';
  return '';
}

async function upload(req, env) {
  if (!env.PHOTOS) return fail('storage not configured', 503);
  if (Number(req.headers.get('Content-Length') || 0) > MEDIA_MAX) return fail('too large', 413);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length || buf.length > MEDIA_MAX) return fail('too large', 413);
  const type = sniff(buf);   // the file's own bytes decide the type, not what the browser claims
  if (!type) return fail('not an image', 415);
  const id = [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2, '0')).join('');
  const key = `p/${id}.${MEDIA_TYPES[type]}`;
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
  return json({ url: String(env.IMG_BASE || '').replace(/\/?$/, '/') + key }, 200, noStore);
}

// /img/p/<24 hex>.<ext> from the bound bucket: local development only (see src/index.js).
export async function localImage(parts, env) {
  const key = parts.slice(1).join('/');
  if (!env.PHOTOS || !/^p\/[a-f0-9]{24}\.(webp|jpg|png|gif|mp4|webm)$/.test(key)) return new Response('Not found', { status: 404 });
  const o = await env.PHOTOS.get(key);
  if (!o) return new Response('Not found', { status: 404 });
  return new Response(o.body, { headers: { 'Content-Type': (o.httpMetadata && o.httpMetadata.contentType) || 'application/octet-stream', 'Cache-Control': 'no-store' } });
}

// ---------- emails ----------
async function afterOrder(env, res, p) {
  if (res.repeat) return;
  const name = firstName(p.customer_name);
  if (res.pay_status === 'paid' || res.pay_status === 'waived') {
    return afterPaid(env, { first: true, order_no: res.order_no, mode: p.mode, plan: p.plan, total: res.total, currency: p.region === 'IN' ? 'INR' : 'USD',
      customer_email: p.customer_email, customer_name: p.customer_name, customer_phone: p.customer_phone, slug: res.slug, public_id: res.public_id, edit_token: res.edit_token, coupon: p.coupon, test: !!res.test });
  }
  const online = payReady(env, p.region === 'IN' ? 'INR' : 'USD');
  if (!online) await sendMail(env, p.customer_email, `We have your order (${res.order_no})`, mailHtml('Order received', [
    `Hi ${esc(name)}, thanks for your order <b>${esc(res.order_no)}</b>.`,
    'We will email you a secure payment link shortly. Your card goes live as soon as payment is confirmed.',
    'Questions? Just reply to this email.']));
  if (env.ADMIN_EMAIL) await sendMail(env, env.ADMIN_EMAIL, `New order ${res.order_no} · awaiting payment`, mailHtml(`New order ${res.order_no}`, [
    `${esc(p.customer_name)} · ${esc(p.customer_phone)} · ${esc(p.customer_email)}`,
    `Plan: ${esc(p.plan)} · ${esc(p.region)} · total ${esc(res.total)}`,
    online ? 'Payment: online checkout started. You will get another email when it is paid.' : '<b>Payment is not set up online.</b> Send the customer a payment link.',
    p.notes ? 'Notes: ' + esc(String(p.notes).slice(0, 1500)) : '']));
}

async function afterPaid(env, o) {
  if (!o || !o.first) return;
  const link = cardLink(env, o.slug, o.public_id), edit = editLink(env, o.edit_token), dfm = o.mode === 'dfm';
  const rows = dfm
    ? [`Hi ${esc(firstName(o.customer_name))}, payment received for order <b>${esc(o.order_no)}</b>. We're starting on your design and will message you when your card is live.`,
       `Your card link is reserved: <a href="${esc(link)}">${esc(link.replace('https://', ''))}</a>`]
    : [`Hi ${esc(firstName(o.customer_name))}, your digital card is live: <a href="${esc(link)}">${esc(link.replace('https://', ''))}</a>. Share the link, or open your card and tap <b>Show QR</b> to print your QR code.`,
       `Order number: <b>${esc(o.order_no)}</b>`];
  if (edit) rows.push(`<b>Edit your card yourself, any time, free.</b> Change your photo, details or style with your private edit link: <a href="${esc(edit)}">${esc(edit.replace('https://', ''))}</a><br>Keep this link private. Anyone with it can edit your card.`);
  rows.push('Prefer us to make a change? Just reply to this email.');
  await sendMail(env, o.customer_email, dfm ? `Payment received (${o.order_no})` : 'Your Linkcardly card is live', mailHtml(dfm ? 'Payment received' : 'Your card is ready', rows, dfm ? null : ['Open my card', link]));
  const what = o.test ? `Test order (no payment): ${o.order_no}` : Number(o.total) > 0 ? `Paid: ${o.order_no} · ${o.currency} ${o.total}` : `Free (coupon ${o.coupon || '?'}): ${o.order_no}`;
  if (env.ADMIN_EMAIL) await sendMail(env, env.ADMIN_EMAIL, what, mailHtml(`Order ${o.order_no}`, [
    `${esc(o.customer_name)} · ${esc(o.customer_phone)} · ${esc(o.customer_email)}`, `<a href="${esc(link)}">${esc(link)}</a>`]));
}

async function markPaid(env, ctx, orderNo, provider, ref, minor, currency) {
  const o = await rpc(env, 'mark_order_paid', { p_order_no: orderNo, p_provider: provider, p_ref: ref, p_amount_minor: minor, p_currency: String(currency || '').toUpperCase() });
  if (o && o.first) await purgeCards(env, [o.slug, o.public_id]);
  later(ctx, afterPaid(env, o));
  return o;
}

async function markRefunded(env, ctx, orderNo, provider, ref) {
  const o = await rpc(env, 'mark_order_refunded', { p_order_no: orderNo, p_provider: provider, p_ref: ref });
  if (o && o.changed) await purgeCards(env, [o.slug, o.public_id]);
  if (o && o.changed && env.ADMIN_EMAIL) later(ctx, sendMail(env, env.ADMIN_EMAIL, `Refunded: ${orderNo}`, mailHtml(`Refunded ${orderNo}`, [`${esc(o.customer_name)} · ${esc(o.customer_email)}`, 'The card is offline and any partner commission is reversed.'])));
  return o;
}

const paidOut = o => ({ ok: true, paid: true, order_no: o.order_no, slug: o.slug, public_id: o.public_id, mode: o.mode });

// ---------- routes ----------
async function order(req, env, url, ctx) {
  const j = await readJson(req), p = (j.body && j.body.payload) || {};
  if (!(await botOk(env, j.ts, ipOf(req)))) return fail('bot check failed', 403);
  const res = await rpc(env, 'place_order', { payload: p }, { ip: ipOf(req) });
  later(ctx, afterOrder(env, res, p));
  // The edit link is shown on the confirmation only when the order is already paid (test mode, free coupon).
  // For a paid checkout, payment makes a fresh link (mark_order_paid) and it's emailed, so this one is withheld.
  const out = { ...res };
  if (!(res.pay_status === 'paid' || res.pay_status === 'waived')) {
    delete out.edit_token;
    out.pay = await startPay(env, { order_no: res.order_no, total: res.total, currency: p.region === 'IN' ? 'INR' : 'USD', plan: p.plan, customer_email: p.customer_email, customer_phone: p.customer_phone }, site(env)).catch(() => null);
  }
  return json(out, 200, noStore);
}

async function edit(req, env, ctx) {
  const j = await readJson(req);
  const res = await rpc(env, 'update_card_by_token', j.body || {}, { ip: ipOf(req) });
  await purgeCards(env, [res && res.slug, res && res.public_id]);
  return json(res, 200, noStore);
}

async function lead(req, env, ctx) {
  const j = await readJson(req, 20000), b = j.body || {};
  if (!(await botOk(env, j.ts, ipOf(req)))) return fail('bot check failed', 403);
  const res = await rpc(env, 'submit_lead', b, { ip: ipOf(req) });
  const rows = [`<b>${esc(b.p_name)}</b> shared their contact from your digital card.`,
    `Mobile: <a href="tel:${esc(b.p_phone)}">${esc(b.p_phone)}</a>${b.p_email ? '<br>Email: ' + esc(b.p_email) : ''}${b.p_topic ? '<br>Interested in: ' + esc(b.p_topic) : ''}`,
    b.p_message ? 'Message: ' + esc(String(b.p_message).slice(0, 1000)) : '',
    'Reply soon: people who get a call back within an hour are far more likely to become clients.'];
  const to = (res && res.owner_email) || env.ADMIN_EMAIL;
  later(ctx, sendMail(env, to, 'New lead from your card: ' + String(b.p_name || '').slice(0, 60), mailHtml('You have a new lead', res && res.owner_email ? rows : [`(No email on card ${esc(b.p_slug)})`, ...rows])));
  const out = { ...(res || {}) }; delete out.owner_email; delete out.owner_name;
  return json(out, 200, noStore);
}

async function contact(req, env, ctx) {
  const b = await readJson(req, 20000);
  if (!(await botOk(env, b.turnstile, ipOf(req)))) return json({ error: 'Please complete the security check and try again.' }, 403, noStore);
  const name = String(b.name || '').trim();
  const res = await rpc(env, 'submit_site_lead', { p: { name, business_name: String(b.company || name).trim(), email: String(b.email || '').trim(), phone: String(b.phone || '').trim(), message: String(b.message || '').slice(0, 4000), preferred_contact_method: 'email' } }, { ip: ipOf(req) });
  if (env.ADMIN_EMAIL) later(ctx, sendMail(env, env.ADMIN_EMAIL, 'Website enquiry: ' + name.slice(0, 60), mailHtml('New enquiry from linkcardly.com', [
    `<b>${esc(name)}</b> · <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>${b.phone ? ' · ' + esc(b.phone) : ''}`, esc(String(b.message || '').slice(0, 4000)).replace(/\n/g, '<br>')])));
  return json({ ok: true, ...(res && typeof res === 'object' ? { id: res.id } : {}) }, 200, noStore);
}

async function payStart(req, env) {
  const j = await readJson(req, 2000);
  if (!ORDER_NO.test(String(j.order_no || '')) || !/^[a-f0-9-]{36}$/.test(String(j.idem || ''))) return fail('bad request', 400);
  const o = await rpc(env, 'get_order_for_pay', { p_order_no: j.order_no, p_idem: j.idem }).catch(() => null);
  if (!o) return fail('order not found', 404);
  if (o.pay_status === 'paid' || o.pay_status === 'waived') return json(paidOut(o), 200, noStore);
  const pay = await startPay(env, o, site(env)).catch(() => null);
  return pay ? json({ pay }, 200, noStore) : fail('payment not available', 503);
}

async function razorpayVerify(req, env, ctx) {
  if (!env.RAZORPAY_KEY_SECRET) return fail('payment not available', 503);
  const j = await readJson(req, 4000);
  const oid = String(j.razorpay_order_id || ''), pid = String(j.razorpay_payment_id || ''), sig = String(j.razorpay_signature || '');
  if (!/^order_\w+$/.test(oid) || !/^pay_\w+$/.test(pid)) return fail('bad request', 400);
  if (!safeEq(await hmacHex(env.RAZORPAY_KEY_SECRET, oid + '|' + pid), sig)) return fail('bad signature', 400);
  let pm = await razorpay(env, 'payments/' + pid);
  if (pm.status === 'authorized') pm = await razorpay(env, `payments/${pid}/capture`, { method: 'POST', body: JSON.stringify({ amount: pm.amount, currency: pm.currency }) });
  if (pm.status !== 'captured' || pm.order_id !== oid) return fail('not paid', 402);
  const ro = await razorpay(env, 'orders/' + oid);
  if (!ro.receipt) return fail('order not found', 404);
  return json(paidOut(await markPaid(env, ctx, ro.receipt, 'razorpay', pid, pm.amount, pm.currency)), 200, noStore);
}

async function stripeStatus(env, url, ctx) {
  const sid = url.searchParams.get('sid') || '';
  if (!/^cs_(test|live)_\w+$/.test(sid) || !env.STRIPE_SECRET_KEY) return json({ paid: false }, 400, noStore);
  const s = await stripe(env, 'checkout/sessions/' + sid);
  if (s.payment_status !== 'paid' || !s.client_reference_id) return json({ paid: false }, 200, noStore);
  return json(paidOut(await markPaid(env, ctx, s.client_reference_id, 'stripe', s.payment_intent || s.id, s.amount_total, s.currency)), 200, noStore);
}

async function razorpayWebhook(req, env, ctx) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !env.RAZORPAY_KEY_SECRET) return new Response('off', { status: 503 });
  const raw = await req.text();
  if (!safeEq(await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw), req.headers.get('X-Razorpay-Signature') || '')) return new Response('bad signature', { status: 400 });
  const ev = JSON.parse(raw), pl = ev.payload || {}, pm = pl.payment && pl.payment.entity;
  const receiptOf = async orderId => (pl.order && pl.order.entity && pl.order.entity.receipt) || (orderId ? (await razorpay(env, 'orders/' + orderId)).receipt : '');
  if ((ev.event === 'order.paid' || ev.event === 'payment.captured') && pm && pm.status === 'captured' && pm.order_id) {
    const receipt = await receiptOf(pm.order_id);
    if (receipt) await markPaid(env, ctx, receipt, 'razorpay', pm.id, pm.amount, pm.currency);
  } else if (ev.event === 'refund.processed') {
    const rf = pl.refund && pl.refund.entity;
    const pay = rf && rf.payment_id ? await razorpay(env, 'payments/' + rf.payment_id) : {};
    // Only a full refund takes the card offline; a partial refund (a goodwill discount) leaves it live.
    if (pay.order_id && Number(pay.amount_refunded) >= Number(pay.amount)) {
      const receipt = await receiptOf(pay.order_id);
      if (receipt) await markRefunded(env, ctx, receipt, 'razorpay', rf.id);
    }
  } else if (ev.event === 'payment.failed' && pm) {
    console.log(JSON.stringify({ t: 'payment', provider: 'razorpay', event: 'failed', order: pm.order_id, reason: pm.error_reason || pm.error_code || '' }));
  }
  return new Response('ok');
}

async function stripeWebhook(req, env, ctx) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) return new Response('off', { status: 503 });
  const raw = await req.text(), h = req.headers.get('Stripe-Signature') || '';
  const ts = Number((h.split(',').find(x => x.startsWith('t=')) || '').slice(2));
  const v1s = h.split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 600) return new Response('stale', { status: 400 });
  const want = await hmacHex(env.STRIPE_WEBHOOK_SECRET, ts + '.' + raw);
  if (!v1s.some(v => safeEq(v, want))) return new Response('bad signature', { status: 400 });
  const ev = JSON.parse(raw), o = ev.data && ev.data.object;
  if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && o && o.payment_status === 'paid' && o.client_reference_id) {
    await markPaid(env, ctx, o.client_reference_id, 'stripe', o.payment_intent || o.id, o.amount_total, o.currency);
  } else if (ev.type === 'charge.refunded' && o && o.refunded && o.payment_intent) {
    const pi = await stripe(env, 'payment_intents/' + o.payment_intent);
    const orderNo = pi.metadata && pi.metadata.order_no;
    if (orderNo) await markRefunded(env, ctx, orderNo, 'stripe', o.id);
  } else if (ev.type === 'checkout.session.expired' || ev.type === 'checkout.session.async_payment_failed') {
    console.log(JSON.stringify({ t: 'payment', provider: 'stripe', event: ev.type, order: o && o.client_reference_id }));
  }
  return new Response('ok');
}

async function isAdmin(req, env) {
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer [\w.-]+$/.test(auth)) return false;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY || '', authorization: auth, 'Content-Type': 'application/json' }, body: '{}' });
    return r.ok && (await r.json()) === true;
  } catch (_) { return false; }
}

async function stats(req, env) {
  if (!(await isAdmin(req, env))) return json({ error: 'unauthorized' }, 401, noStore);
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return json({ error: 'stats not configured', data: [] }, 200, noStore);
  const dataset = /^[a-z0-9_]+$/.test(env.STATS_DATASET || '') ? env.STATS_DATASET : 'linkcardly_stats';
  const q = `SELECT index1 AS k, blob1 AS e, SUM(_sample_interval) AS n FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '30' DAY GROUP BY k, e FORMAT JSON`;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, { method: 'POST', headers: { authorization: 'Bearer ' + env.CF_ANALYTICS_TOKEN }, body: q });
  if (!r.ok) return json({ error: 'stats upstream', data: [] }, 200, noStore);
  return json({ data: (await r.json()).data || [] }, 200, noStore);
}

async function hit(req, env) {
  const t = await req.text();
  if (!env.STATS || t.length > 300) return;
  let j = {}; try { j = JSON.parse(t); } catch (_) { return; }
  const k = String(j.k || ''), e = String(j.e || '');
  if (k.length > 40 || !KEY_RE.test(k) || !HIT_EVENTS.includes(e)) return;
  env.STATS.writeDataPoint({ indexes: [k], blobs: [e, (req.cf && req.cf.country) || ''], doubles: [1] });
}

export async function nativeApi(parts, req, env, url, ctx) {
  const [route, sub] = parts, m = req.method;
  const formRoute = ['upload', 'order', 'edit', 'lead', 'contact'].includes(route) || (route === 'pay' && m === 'POST');
  if (formRoute && !sameOrigin(req, url, env)) return fail('forbidden', 403);
  try {
    if (route === 'card' && m === 'GET' && parts.length === 2 && KEY_RE.test(sub || '')) {
      const row = await cardData(env, sub, ctx);
      return json({ row }, 200, { 'Cache-Control': 'no-cache' });   // the edge cache above is the cache; browsers re-check
    }
    if (route === 'hit' && m === 'POST') { await hit(req, env).catch(() => {}); return new Response(null, { status: 204 }); }
    if (route === 'upload' && m === 'POST') return await upload(req, env);
    if (route === 'order' && m === 'POST') return await order(req, env, url, ctx);
    if (route === 'edit' && m === 'POST') return await edit(req, env, ctx);
    if (route === 'lead' && m === 'POST') return await lead(req, env, ctx);
    if (route === 'contact' && m === 'POST') return await contact(req, env, ctx);
    if (route === 'pay' && sub === 'start' && m === 'POST') return await payStart(req, env);
    if (route === 'pay' && sub === 'verify' && m === 'POST') return await razorpayVerify(req, env, ctx);
    if (route === 'pay' && sub === 'status' && m === 'GET') return await stripeStatus(env, url, ctx);
    if (route === 'razorpay' && sub === 'webhook' && m === 'POST') return await razorpayWebhook(req, env, ctx);
    if (route === 'stripe' && sub === 'webhook' && m === 'POST') return await stripeWebhook(req, env, ctx);
    if (route === 'stats' && m === 'GET') return await stats(req, env);
    if (route === 'purge' && m === 'POST') {
      if (!(await isAdmin(req, env))) return json({ error: 'unauthorized' }, 401, noStore);
      const j = await readJson(req, 4000); await purgeCards(env, Array.isArray(j.keys) ? j.keys : []);
      return json({ ok: true }, 200, noStore);
    }
    return json({ error: 'Not found' }, 404, noStore);
  } catch (e) {
    if (e instanceof RpcError) return fail(e.message, e.status);
    if (e instanceof ProviderError) return fail('payment provider unavailable, please try again', 502);   // webhooks: the provider retries
    throw e;
  }
}

// Daily scheduled job (wrangler.toml [triggers]): renewal reminders. It queries the database every day, which also
// keeps a Supabase Free project from pausing for inactivity.
export async function scheduled(env) {
  if (!env.CRON_KEY || !env.SUPABASE_URL) {
    console.warn(JSON.stringify({ t: 'cron', job: 'reminders', skipped: 'CRON_KEY or SUPABASE_URL not set' }));
    return { ok: false, reason: 'not configured' };
  }
  const rows = await rpc(env, 'renewal_due', { p_key: env.CRON_KEY });
  let sent = 0;
  for (const x of rows || []) {
    const link = cardLink(env, x.r_slug, x.r_public_id), when = x.r_days === 0 ? 'today' : `in ${x.r_days} days`;
    const ok = await sendMail(env, x.r_email, `Your Linkcardly card renews ${when}`, mailHtml(`Your card renews ${when}`, [
      `Hi ${esc(x.r_first_name || 'there')}, your digital card (<a href="${esc(link)}">${esc(link.replace('https://', ''))}</a>) is due for renewal on <b>${esc(x.r_renewal)}</b>.`,
      'Renew to keep your link and QR code working. After the renewal date your card stays live for 15 more days.',
      'Reply to this email to renew.']));
    if (ok) sent++;
  }
  console.log(JSON.stringify({ t: 'cron', job: 'reminders', due: (rows || []).length, sent }));
  return { ok: true, due: (rows || []).length, sent };
}
