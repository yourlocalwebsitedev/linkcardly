// Partner links: linkcardly.com/r/<code> (the partner's QR points here and never changes).
// Native mode counts the visit (partner_click, approved partners only), remembers the code for 30 days in a
// first-party cookie and opens the order page with it; the order page applies it as the partner's coupon.
// Unknown or paused codes, and proxy mode, just open the order page.
import { rpc } from '../lib/live.js';

export const PARTNER_COOKIE = 'lc_partner';
export const PARTNER_DAYS = 30;
const CODE_RE = /^[A-Z0-9]{4,20}$/;

export async function referral(env, req, parts, proxyMode) {
  const code = String(parts[1] || '').toUpperCase();
  const go = (path, cookie) => new Response(null, { status: 302, headers: { Location: path, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
  if (proxyMode || !CODE_RE.test(code)) return go('/create');
  let ok = false;
  try { ok = !!(await rpc(env, 'partner_click', { p_code: code }, { ip: req.headers.get('cf-connecting-ip') || '' }) || {}).ok; } catch (_) {}
  if (!ok) return go('/create');
  return go('/create?partner=' + code, `${PARTNER_COOKIE}=${code}; Max-Age=${PARTNER_DAYS * 86400}; Path=/; Secure; SameSite=Lax`);
}
