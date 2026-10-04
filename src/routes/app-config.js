// /app/config.js: the browser's settings for this environment (marketing pages, order and card app), so the same
// files work on production, staging and previews. The one place these values reach the browser. In proxy mode the
// app still talks to the NexBizRise database and widget (the old worker does ordering until cutover); in native mode
// it uses Linkcardly's own (wrangler.toml), and `payments` says whether this Worker has payment keys.
import { payReady } from '../lib/payments.js';

const LEGACY = {
  supabaseUrl: 'https://hyaqvmrtqafqhbhcdecd.supabase.co',
  supabaseKey: 'sb_publishable_bqmJ-YGyd6h1UEnpM3RryA_eTWdpNbV',
  turnstileSiteKey: '0x4AAAAAAFIAJl64rp47Hazn'
};

// The browser's settings for this environment. Also gives the database origin for the pages' CSP (src/http.js).
export function browserSettings(env) {
  const c = env.MODE === 'native'
    ? { native: true, supabaseUrl: env.SUPABASE_URL || '', supabaseKey: env.SUPABASE_ANON_KEY || '', turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
        payments: payReady(env, 'INR') || payReady(env, 'USD') }
    : { native: false, ...LEGACY };
  return { ...c, orderUrl: '/create' };
}

export const browserDbOrigin = env => { try { return new URL(browserSettings(env).supabaseUrl).origin; } catch (_) { return 'https://*.supabase.co'; } };

export function appConfig(env) {
  return new Response(`window.LC_CONFIG=${JSON.stringify(browserSettings(env))};\n`, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
  });
}
