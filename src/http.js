export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// Fetches a file from /public for the current URL. A fresh Request (not the incoming one) so the
// assets binding follows its own redirects instead of passing them on to the browser.
export const serveAsset = (env, req, path, search = '') =>
  env.ASSETS.fetch(new Request(new URL(path + search, req.url), { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: req.headers }));

export async function notFound(env, req) {
  const r = await env.ASSETS.fetch(new Request(new URL('/404.html', req.url)));
  return new Response(r.body, { status: 404, headers: r.headers });
}

export const errorPage = (status = 503) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Something went wrong · Linkcardly</title></head>
<body style="font:16px/1.5 system-ui,sans-serif;background:#f5ead8;color:#201e1d;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;text-align:center">
<main><h1 style="font-size:28px;margin:0 0 8px">Something went wrong</h1><p>Please try again in a minute.</p><p><a href="/" style="color:#8c491a">Linkcardly home</a></p></main></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30' } });

// Content-Security-Policy for pages this repo renders (marketing pages, native card page).
// The vendored app (public/app) and proxied responses are excluded: they use inline scripts,
// unpkg, Babel and payment SDKs, and are kept identical to NexBizRise.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "connect-src 'self' https://*.supabase.co",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

// Adds security headers. Responses from fetch/ASSETS have immutable headers, so copy first.
export function secure(res, { csp = false, editLink = false } = {}) {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('Referrer-Policy', editLink ? 'no-referrer' : 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")');
  if (!h.has('X-Frame-Options')) h.set('X-Frame-Options', 'SAMEORIGIN');
  if (csp && /text\/html/.test(h.get('Content-Type') || '')) h.set('Content-Security-Policy', CSP);
  if (editLink) h.set('Cache-Control', 'private, no-store');
  return out;
}

// Same-origin fetch with a timeout.
export const fetchWithTimeout = (input, init = {}, ms = 8000) => fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
