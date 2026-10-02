// Forwards a request to the existing NexBizRise worker (LEGACY_ORIGIN), unchanged.
export async function proxy(req, env, url) {
  const target = new URL(url.pathname + url.search, env.LEGACY_ORIGIN);
  const headers = new Headers(req.headers);
  headers.set('X-Forwarded-Host', url.hostname);
  headers.set('X-Brand', 'linkcardly');
  const res = await fetch(new Request(target, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
    redirect: 'manual'
  }));
  const out = new Response(res.body, res);
  const loc = out.headers.get('Location');
  if (loc) out.headers.set('Location', loc.replace(env.LEGACY_ORIGIN, env.SITE_URL));
  return out;
}
