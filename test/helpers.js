// Test doubles for the Worker: an ASSETS binding backed by public/, and a stubbed global fetch.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Workers accept a streamed Request body without `duplex`; Node's undici does not. Match the Workers runtime.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input, init) { super(input, init && init.body && !init.duplex ? { ...init, duplex: 'half' } : init); }
};

const PUBLIC = new URL('../public/', import.meta.url).pathname;

// Stand-in for the Workers static-assets binding with html_handling = "drop-trailing-slash",
// including its 307s: /x.html → /x, /x/index.html → /x, /x/ → /x; /x serves x.html or x/index.html.
// A Request built fresh in the Worker has redirect "follow" and the binding follows the 307 itself;
// one built from the incoming request inherits redirect "manual" and the 307 reaches the browser.
const exists = async p => { try { return await readFile(join(PUBLIC, decodeURIComponent(p))); } catch (_) { return null; } };
const redirect = (req, to) => new Response(null, { status: 307, headers: { Location: new URL(to, req.url).href } });
const ok = (body, p) => new Response(body, { status: 200, headers: { 'Content-Type': /\.html$/.test(p) ? 'text/html; charset=utf-8' : 'application/octet-stream' } });
export const assets = {
  calls: [],
  async fetch(req) {
    const res = await this.raw(req);
    return res.status === 307 && req.redirect === 'follow' ? this.raw(new Request(res.headers.get('Location'), { redirect: 'manual' })) : res;
  },
  async raw(req) {
    const u = new URL(req.url), path = u.pathname;
    this.calls.push(path);
    if (path.endsWith('/index.html')) return redirect(req, (path.slice(0, -11) || '/') + u.search);
    if (path.endsWith('.html')) return redirect(req, path.slice(0, -5) + u.search);
    if (path === '/') return ok(await exists('/index.html'), '.html');
    if (path.endsWith('/')) return redirect(req, path.slice(0, -1) + u.search);
    let b = await exists(path); if (b) return ok(b, path);
    b = await exists(path + '.html'); if (b) return ok(b, '.html');
    b = await exists(path + '/index.html'); if (b) return ok(b, '.html');
    return new Response('nope', { status: 404 });
  }
};

export const env = (over = {}) => ({
  SITE_URL: 'https://linkcardly.com',
  MODE: 'native',
  LEGACY_ORIGIN: 'https://card.nexbizrise.com',
  LEGACY_HOSTS: 'card.nexbizrise.com',
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_KEY: 'service-key',
  TURNSTILE_SECRET: 'ts-secret',
  TURNSTILE_SITE_KEY: 'site-key',
  ASSETS: assets,
  ...over
});

// Replace global fetch with a router: handler(url, init) returns a Response or undefined (→ 599).
export function stubFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.clone().text();
    calls.push({ url: req.url, method: req.method, body, headers: Object.fromEntries(req.headers) });
    return (await handler(req.url, req, body)) || new Response('unrouted', { status: 599 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// Incoming Worker requests carry redirect: 'manual'.
export const request = (path, init) => new Request(new URL(path, 'https://linkcardly.com'), { redirect: 'manual', ...init });
