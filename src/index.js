// Cloudflare Worker entry: routing only. Handlers live in routes/.
import { VERSION, STATIC_PAGES, STATIC_PREFIXES, ORDER_ALIASES, APP } from './config.js';
import { validateHandle } from './lib/handles.js';
import { serveAsset, notFound } from './http.js';
import { proxy } from './routes/proxy.js';
import { api } from './routes/api.js';
import { serveCard } from './routes/cards.js';

const isFile = s => /\.[a-z0-9]+$/i.test(s);
const isEditLink = parts => parts[0] === 'e' && /^[a-f0-9]{40}$/.test(parts[1] || '');
const isCardLink = parts => (parts[0] === 'c' && /^nbr_[a-f0-9]{6}$/.test(parts[1] || '')) || (parts.length === 1 && validateHandle(parts[0]).ok);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const proxyMode = env.MODE === 'proxy' && !!env.LEGACY_ORIGIN;

    // Hosts
    if ((env.LEGACY_HOSTS || '').split(',').includes(url.hostname)) return Response.redirect(`${env.SITE_URL}${url.pathname}${url.search}`, 301);
    if (url.hostname === 'www.linkcardly.com') return Response.redirect(`${env.SITE_URL}${url.pathname}${url.search}`, 301);

    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const first = parts[0] || '';

    if (first === 'health') return new Response(`ok ${VERSION}${proxyMode ? ' proxy' : ''}`);

    // Ordering
    if (first === 'create') return serveAsset(env, req, APP.order, url.search);
    if (ORDER_ALIASES.has(first)) return Response.redirect(`${env.SITE_URL}/create${url.search}`, 301);

    // API
    if (first === 'api') return proxyMode ? proxy(req, env, url) : api(parts.slice(1), req, env, url);

    // Static pages and assets
    if (STATIC_PAGES.has(first) || STATIC_PREFIXES.has(first) || isFile(first)) {
      const res = await env.ASSETS.fetch(req);
      return res.status === 404 ? notFound(env, req) : res;
    }

    // Cards and edit links
    if (proxyMode) {
      if (isEditLink(parts)) return serveAsset(env, req, APP.order);
      if (isCardLink(parts)) return serveAsset(env, req, APP.card, url.search);
      return proxy(req, env, url);
    }
    return serveCard(req, env, parts);
  }
};
