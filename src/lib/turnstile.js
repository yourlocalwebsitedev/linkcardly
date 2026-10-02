import { TIMEOUTS } from '../config.js';

// Fails closed: a missing token or secret, a timeout or an unreadable reply all count as "not verified".
export async function verifyTurnstile(env, token, ip) {
  if (!token || !env.TURNSTILE_SECRET) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', String(token).slice(0, 2048));
  if (ip) body.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUTS.turnstile) });
    const j = await r.json();
    return !!j.success;
  } catch (e) {
    console.error(JSON.stringify({ t: 'turnstile', error: String(e && e.message || e) }));
    return false;
  }
}
