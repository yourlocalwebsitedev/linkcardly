// /health → "ok <version>[ proxy]" (cheap liveness). /health?deep=1 → JSON with dependency checks (readiness).
import { VERSION, TIMEOUTS } from '../config.js';
import { json, fetchWithTimeout } from '../http.js';
import { view } from '../lib/live.js';

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
    // The same read a visitor's card page makes (publishable key, public view): no privileged key needed.
    checks.push(await check('supabase', () => view(env, 'public_cards', 'select=slug&limit=1')));
    // Without these every order fails: the database refuses calls without the Worker secret, and the bot check fails closed.
    checks.push({ name: 'worker_secret', ok: !!env.WORKER_SECRET });
    checks.push({ name: 'turnstile_secret', ok: !!env.TURNSTILE_SECRET });
  }
  const ok = checks.every(c => c.ok);
  return json({ ok, version: VERSION, mode: proxyMode ? 'proxy' : 'native', checks }, ok ? 200 : 503, { 'Cache-Control': 'no-store' });
}
