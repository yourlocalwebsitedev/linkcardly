// Forwards an /api/* request to the existing NexBizRise worker (LEGACY_ORIGIN).
// Credentials never cross between the two sites: no cookies or Authorization header go up
// (the vendored app sends neither), and no cookies come back down onto linkcardly.com.
import { TIMEOUTS } from '../config.js';
import { json } from '../http.js';

const DROP_UP = ['cookie', 'authorization'];

// Database errors relayed by the legacy worker carry PostgREST internals (code, details, hint, table and
// constraint names). Keep only messages the database raised on purpose (SQLSTATE P0001, e.g. "link taken",
// "invalid coupon"), which the app shows or matches on; anything else becomes a generic message.
export async function cleanError(res) {
  const headers = new Headers(res.headers);
  if (!/json/i.test(headers.get('Content-Type') || '')) return new Response(res.body, res);
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  const own = body && typeof body === 'object' && typeof body.message === 'string' && (!body.code || body.code === 'P0001');
  const message = own ? body.message.slice(0, 200) : 'Something went wrong. Please try again.';
  const out = own && !('code' in body) ? { ...body } : { message };
  delete out.details; delete out.hint; delete out.code;
  headers.delete('Content-Length');
  return new Response(JSON.stringify(out), { status: res.status, statusText: res.statusText, headers });
}

export async function proxy(req, env, url) {
  const target = new URL(url.pathname + url.search, env.LEGACY_ORIGIN);
  const headers = new Headers(req.headers);
  for (const h of DROP_UP) headers.delete(h);
  headers.set('X-Forwarded-Host', url.hostname);
  headers.set('X-Brand', 'linkcardly');
  let res;
  try {
    res = await fetch(new Request(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUTS.proxy)
    }));
  } catch (e) {
    console.error(JSON.stringify({ t: 'proxy', path: url.pathname.replace(/^\/e\/[^/]+/, '/e/:token'), error: String(e && e.message || e) }));
    // The vendored app reads `message`; the marketing site reads `error`.
    return json({ error: 'Service temporarily unavailable. Please try again.', message: 'upstream unavailable' }, 502, { 'Retry-After': '30' });
  }
  const out = res.status >= 400 ? await cleanError(res) : new Response(res.body, res);
  out.headers.delete('Set-Cookie');
  const loc = out.headers.get('Location');
  if (loc && loc.startsWith(env.LEGACY_ORIGIN)) out.headers.set('Location', env.SITE_URL + loc.slice(env.LEGACY_ORIGIN.length));
  return out;
}
