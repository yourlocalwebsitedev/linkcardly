export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export const serveAsset = (env, req, path, search = '') =>
  env.ASSETS.fetch(new Request(new URL(path + search, req.url), req));

export async function notFound(env, req) {
  const r = await env.ASSETS.fetch(new Request(new URL('/404.html', req.url)));
  return new Response(r.body, { status: 404, headers: r.headers });
}
