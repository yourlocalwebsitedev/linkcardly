// Payments. India: UPI straight to Linkcardly's UPI ID (no fee; the customer enters the UTR and an admin confirms
// the credit with Mark paid) and Razorpay (cards, netbanking, wallets) with a convenience fee the customer pays.
// US: Stripe. Each one is off until its settings are on the Worker (UPI_VPA, RAZORPAY_KEY_*, STRIPE_SECRET_KEY).
// Prices are never taken from the browser: the order's total comes from the database (place_order /
// get_order_for_pay), and an order becomes paid only through mark_order_paid, which needs the Worker secret
// and checks the amount and currency against the order.
import { productName } from './products.js';
export async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison of two hex signatures.
export function safeEq(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Provider API calls. Any failure (network, timeout, non-2xx) throws, so a webhook answers 5xx and the provider
// retries it later instead of the event being lost.
export class ProviderError extends Error {
  constructor(provider, path, status) { super(`${provider} ${path.split('/')[0]} failed (${status})`); this.status = 502; }
}
async function call(provider, url, path, init) {
  let r;
  try { r = await fetch(url + path, { ...init, signal: AbortSignal.timeout(10000) }); }
  catch (_) { throw new ProviderError(provider, path, 'network'); }
  if (!r.ok) { console.error(JSON.stringify({ t: 'payment', provider, path: path.split('/')[0], status: r.status })); throw new ProviderError(provider, path, r.status); }
  return r.json();
}
const rzpAuth = env => 'Basic ' + btoa(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET);
export const razorpay = (env, path, init = {}) =>
  call('razorpay', 'https://api.razorpay.com/v1/', path, { ...init, headers: { authorization: rzpAuth(env), 'Content-Type': 'application/json', ...(init.headers || {}) } });
export const stripe = (env, path, init = {}) =>
  call('stripe', 'https://api.stripe.com/v1/', path, { ...init, headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, ...(init.headers || {}) } });

export const upiReady = env => /^[\w.-]{2,}@[a-z][a-z0-9]{1,}$/i.test(String(env.UPI_VPA || ''));
export const rzpReady = env => !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
export const payReady = (env, currency) => currency === 'INR' ? upiReady(env) || rzpReady(env) : !!env.STRIPE_SECRET_KEY;

// Convenience fee on Razorpay payments: RAZORPAY_FEE_PCT of the total (default 2.36 = Razorpay's 2% plus 18% GST
// on it), rounded up to whole rupees. 0 turns it off. The order page shows the same sum before ordering
// (order.html convFee, with the percentage from /app/config.js).
export const feePct = env => { const n = Number(env.RAZORPAY_FEE_PCT ?? 2.36); return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 2.36; };
export const convFee = (env, total) => Math.max(0, Math.ceil(Number(total) * feePct(env) / 100 - 1e-9));

// UPI payment link (NPCI deep-link format) for the QR code and the "Open UPI app" button. The payee address is
// kept unencoded: some UPI apps don't decode %40.
export const upiUri = (env, o) => 'upi://pay?pa=' + String(env.UPI_VPA).trim() + '&pn=' + encodeURIComponent(env.UPI_NAME || 'Linkcardly')
  + '&am=' + Number(o.total).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent('Linkcardly ' + o.order_no);

// Starts a payment for an order the database has already priced. Returns what the order page needs to open
// the checkout, or null when payments aren't set up for that currency.
// o: { order_no, total, currency, plan, product, customer_email, customer_phone }
// method (India): 'upi' (default) or 'razorpay'; falls back to the other one when the asked one isn't set up.
export async function startPay(env, o, siteUrl, method) {
  const minor = Math.round(Number(o.total) * 100);
  if (!o.order_no || !(minor > 0) || !payReady(env, o.currency)) return null;
  const desc = productName(o);
  if (o.currency === 'INR') {
    const fee = convFee(env, o.total), useUpi = upiReady(env) && (method !== 'razorpay' || !rzpReady(env));
    if (useUpi) return { provider: 'upi', vpa: String(env.UPI_VPA).trim(), name: env.UPI_NAME || 'Linkcardly', amount: Number(o.total), currency: 'INR', uri: upiUri(env, o), card: rzpReady(env) ? { fee } : null };
    const gross = Math.round((Number(o.total) + fee) * 100);
    const j = await razorpay(env, 'orders', { method: 'POST', body: JSON.stringify({ amount: gross, currency: 'INR', receipt: o.order_no, notes: { order_no: o.order_no, convenience_fee: fee } }) }).catch(() => ({}));
    if (!j.id) return null;
    return { provider: 'razorpay', key: env.RAZORPAY_KEY_ID, order_id: j.id, amount: gross, fee, currency: 'INR', description: desc, email: o.customer_email || '', contact: o.customer_phone || '', upi: upiReady(env) };
  }
  const back = siteUrl.replace(/\/$/, '') + '/create';
  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('client_reference_id', o.order_no);
  f.set('metadata[order_no]', o.order_no);
  f.set('payment_intent_data[metadata][order_no]', o.order_no);
  f.set('line_items[0][quantity]', '1');
  f.set('line_items[0][price_data][currency]', 'usd');
  f.set('line_items[0][price_data][unit_amount]', String(minor));
  f.set('line_items[0][price_data][product_data][name]', 'Linkcardly ' + desc);
  if (/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(o.customer_email || '')) f.set('customer_email', o.customer_email);
  f.set('success_url', back + '?paid={CHECKOUT_SESSION_ID}');
  f.set('cancel_url', back + '?unpaid=' + encodeURIComponent(o.order_no));
  const j = await stripe(env, 'checkout/sessions', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() }).catch(() => ({}));
  return j.url ? { provider: 'stripe', url: j.url } : null;
}
