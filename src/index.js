// Cloudflare Worker entry: routing, security headers, logging and error handling. Handlers live in routes/.
import { VERSION, STATIC_PAGES, STATIC_PREFIXES, ORDER_ALIASES, APP, FILE_EXT } from './config.js';
import { validateHandle } from './lib/handles.js';
import { serveAsset, notFound, errorPage, json, secure } from './http.js';
import { proxy } from './routes/proxy.js';
import { nativeApi, scheduled, localImage } from './routes/native.js';
import { health } from './routes/health.js';
import { withCardPreview } from './routes/og.js';
import { appConfig, browserDbOrigin } from './routes/app-config.js';

const isFile = s => FILE_EXT.test(s);
// API routes behind the per-IP rate limit (not /api/hit or /api/card, which every card view calls).
const LIMITED = new Set(['order', 'contact', 'lead', 'edit', 'upload', 'pay', 'admin', 'purge', 'csp-report']);
const isAdmin = parts => parts[0] === 'admin' && parts.length === 1;
const isEditLink = parts => parts[0] === 'e' && /^[a-f0-9]{40}$/.test(parts[1] || '');
const isCardLink = parts => (parts[0] === 'c' && /^nbr_[a-f0-9]{6}$/.test(parts[1] || '')) || (parts.length === 1 && validateHandle(parts[0]).ok);

// Edit tokens are secrets: never log them.
const logPath = p => p.replace(/^\/e\/[^/]+/, '/e/:token');

// CSP violation reports from the vendored app's report-only policy (APP_CSP): logged, never stored.
async function cspReport(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  const body = (await req.text()).slice(0, 8192);
  let r = {};
  try { r = JSON.parse(body)['csp-report'] || {}; } catch (_) {}
  const page = String(r['document-uri'] || '').replace(/\/e\/[a-f0-9]{40}/, '/e/:token').replace(/\?.*$/, '');
  console.warn(JSON.stringify({ t: 'csp', page, directive: r['violated-directive'] || r['effective-directive'], blocked: String(r['blocked-uri'] || '').replace(/\?.*$/, '') }));
  return new Response(null, { status: 204 });
}

async function route(req, env, url, parts, ctx) {
  const proxyMode = env.MODE === 'proxy' && !!env.LEGACY_ORIGIN;
  const first = parts[0] || '';

  // Hosts
  if ((env.LEGACY_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean).includes(url.hostname)) return Response.redirect(`${env.SITE_URL}${url.pathname}${url.search}`, 301);
  if (url.hostname === 'www.linkcardly.com') return Response.redirect(`${env.SITE_URL}${url.pathname}${url.search}`, 301);

  if (first === 'health') return health(env, url, proxyMode);

  // Admin (vendored NexBizRise admin page: Supabase admin login, cards, orders, leads, coupons, Mark paid)
  if (isAdmin(parts)) return serveAsset(env, req, APP.admin);

  // Ordering
  if (first === 'create') return serveAsset(env, req, APP.order, url.search);
  if (ORDER_ALIASES.has(first)) return Response.redirect(`${env.SITE_URL}/create${url.search}`, 301);

  // API (rate limited per client IP and route when the RATE_LIMITER binding exists)
  if (first === 'api') {
    if (env.RATE_LIMITER && LIMITED.has(parts[1])) {
      const { success } = await env.RATE_LIMITER.limit({ key: `${req.headers.get('CF-Connecting-IP') || 'anon'}:${parts[1] || ''}` });
      if (!success) return json({ error: 'Too many requests. Please wait a minute and try again.', message: 'too many requests' }, 429, { 'Retry-After': '60' });
    }
    if (parts[1] === 'csp-report') return cspReport(req);
    return proxyMode ? proxy(req, env, url) : nativeApi(parts.slice(1), req, env, url, ctx);
  }

  // Local development only (SERVE_IMG = "1", never set in wrangler.toml): photos from the local R2 bucket, since
  // img.linkcardly.com can't see it. The end-to-end suite points img.linkcardly.com/p/* here.
  if (first === 'img' && env.SERVE_IMG === '1') return localImage(parts, env);

  // The app's settings for this environment (database, Turnstile), read by order.html and card.html.
  if (first === 'app' && parts[1] === 'config.js' && parts.length === 2) return appConfig(env);

  // Static pages and assets
  if (STATIC_PAGES.has(first) || STATIC_PREFIXES.has(first) || isFile(first)) {
    const res = await env.ASSETS.fetch(req);
    return res.status === 404 ? notFound(env, req) : res;
  }

  // Cards and edit links: the card and order app in both modes (its data comes from /api/*).
  if (isEditLink(parts)) return serveAsset(env, req, APP.order);
  if (isCardLink(parts)) return withCardPreview(await serveAsset(env, req, APP.card, url.search), req, env, parts[parts.length - 1], url.pathname, ctx);
  return notFound(env, req);
}

export default {
  // Daily job (wrangler.toml [triggers]). Runs in proxy mode too: it reads Linkcardly's own database (empty of
  // customers until cutover, so no emails), which keeps that Supabase Free project from pausing.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduled(env).catch(e => console.error(JSON.stringify({ t: 'cron', error: String(e && e.message || e) }))));
  },
  async fetch(req, env, ctx) {
    const t0 = Date.now(), url = new URL(req.url);
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const first = parts[0] || '';
    let res;
    try {
      res = await route(req, env, url, parts, ctx);
    } catch (err) {
      console.error(JSON.stringify({ t: 'error', method: req.method, path: logPath(url.pathname), error: String(err && err.message || err), stack: err && err.stack }));
      res = first === 'api'
        ? json({ error: 'Something went wrong. Please try again.', message: 'server error' }, 500)
        : errorPage(503);
    }
    // CSP only on pages this repo renders (marketing pages, 404), never on the
    // vendored app (/app, /create, card and edit links) or API responses.
    const vendored = ['app', 'create'].includes(first) || isAdmin(parts) || isCardLink(parts) || isEditLink(parts);
    const csp = !vendored && first !== 'api';
    res = secure(res, { csp, appCsp: vendored, editLink: isEditLink(parts), db: browserDbOrigin(env) });
    if (isAdmin(parts) || url.pathname.startsWith('/app/admin')) { res.headers.set('X-Robots-Tag', 'noindex, nofollow'); res.headers.set('Cache-Control', 'no-store'); }
    console.log(JSON.stringify({ t: 'req', method: req.method, path: logPath(url.pathname), status: res.status, ms: Date.now() - t0, mode: env.MODE, ray: req.headers.get('cf-ray') || undefined }));
    return res;
  }
};
