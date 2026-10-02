// /health → "ok <version>[ proxy]" (cheap liveness). /health?deep=1 → JSON with dependency checks (readiness).
import { VERSION, TIMEOUTS } from '../config.js';
import { json, fetchWithTimeout } from '../http.js';

async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); return { name, ok: true, ms: Date.now() - t0 }; }
  catch (e) { return { name, ok: false, ms: Date.now() - t0, error: String(e && e.message || e).slice(0, 200) }; }
}

export async function health(env, url, proxyMode) {
  if (!url.searchParams.has('deep')) return new Response(`ok ${VERSION}${proxyMode ? ' proxy' : ''}`, { headers: { 'Cache-Control': 'no-store' } });
  const checks = [];
  if (proxyMode) {
    checks.push(await check('legacy_origin', async () => {
      const r = await fetchWithTimeout(new URL('/health', env.LEGACY_ORIGIN), {}, TIMEOUTS.health);
      if (r.status >= 500) throw new Error(`status ${r.status}`);
    }));
  } else {
    checks.push(await check('supabase', async () => {
      const r = await fetchWithTimeout(`${env.SUPABASE_URL}/rest/v1/cards?select=id&limit=1`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }, TIMEOUTS.health);
      if (!r.ok) throw new Error(`status ${r.status}`);
    }));
    checks.push({ name: 'turnstile_secret', ok: !!env.TURNSTILE_SECRET });
  }
  const ok = checks.every(c => c.ok);
  return json({ ok, version: VERSION, mode: proxyMode ? 'proxy' : 'native', checks }, ok ? 200 : 503, { 'Cache-Control': 'no-store' });
}
