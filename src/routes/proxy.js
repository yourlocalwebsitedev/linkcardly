// Forwards a request to the existing NexBizRise worker (LEGACY_ORIGIN), unchanged.
import { TIMEOUTS } from '../config.js';
import { json } from '../http.js';

export async function proxy(req, env, url) {
  const target = new URL(url.pathname + url.search, env.LEGACY_ORIGIN);
  const headers = new Headers(req.headers);
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
  const out = new Response(res.body, res);
  const loc = out.headers.get('Location');
  if (loc && loc.startsWith(env.LEGACY_ORIGIN)) out.headers.set('Location', env.SITE_URL + loc.slice(env.LEGACY_ORIGIN.length));
  return out;
}
