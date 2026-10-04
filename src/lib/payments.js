// Payments: Razorpay (INR) and Stripe (USD). Each provider is off until its keys are set on the Worker.
// Prices are never taken from the browser: the order's total comes from the database (place_order /
// get_order_for_pay), and an order becomes paid only through mark_order_paid, which needs the Worker secret
// and checks the amount and currency against the order.
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

export const payReady = (env, currency) => currency === 'INR'
  ? !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET)
  : !!env.STRIPE_SECRET_KEY;

// Starts a payment for an order the database has already priced. Returns what the order page needs to open
// the checkout, or null when payments aren't set up for that currency.
// o: { order_no, total, currency, plan, customer_email, customer_phone }
export async function startPay(env, o, siteUrl) {
  const minor = Math.round(Number(o.total) * 100);
  if (!o.order_no || !(minor > 0) || !payReady(env, o.currency)) return null;
  const desc = (o.plan === 'motion' ? 'Motion Card' : 'Digital Card') + ' · 1 year';
  if (o.currency === 'INR') {
    const j = await razorpay(env, 'orders', { method: 'POST', body: JSON.stringify({ amount: minor, currency: 'INR', receipt: o.order_no, notes: { order_no: o.order_no } }) }).catch(() => ({}));
    if (!j.id) return null;
    return { provider: 'razorpay', key: env.RAZORPAY_KEY_ID, order_id: j.id, amount: minor, currency: 'INR', description: desc, email: o.customer_email || '', contact: o.customer_phone || '' };
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
