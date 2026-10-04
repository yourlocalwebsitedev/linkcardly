// Per-card share previews (QA.md D). Link-preview bots don't run JavaScript, so they
// only ever saw the generic Linkcardly title and image. For those bots (and only them, so people
// never wait on an extra request) the card's name, role and photo go into the page's meta tags.
import { TIMEOUTS } from '../config.js';
import { cardData } from './native.js';

export const PREVIEW_BOT = /facebookexternalhit|facebot|twitterbot|whatsapp|linkedinbot|slackbot|telegrambot|discordbot|skypeuripreview|pinterest|applebot|googlebot|bingbot|redditbot|embedly|vkshare|iframely|snapchat|viber|line\//i;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const httpsUrl = u => { try { const x = new URL(String(u)); return x.protocol === 'https:' ? x.href : ''; } catch (_) { return ''; } };

export function cardMeta(row, url) {
  const name = clip([row.prefix, row.first_name, row.last_name].filter(Boolean).join(' '), 80);
  if (!name) return null;
  const role = clip([row.title, row.company].filter(Boolean).join(', '), 100);
  const x = row.extras || {};
  return {
    title: `${name}${role ? ' · ' + role : ''} | Linkcardly`,
    description: clip(row.tagline || row.bio || `Save ${name}'s contact, call, WhatsApp or email in one tap.`, 200),
    image: httpsUrl(x.og_image) || httpsUrl(row.photo_url),
    url
  };
}

// Rewrites the static meta tags in card.html. Plain string replacement (the tags are fixed in the
// vendored file), so it runs the same in Workers and in the Node tests.
export function applyMeta(html, m) {
  const set = (attr, key, value) => {
    const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
    html = html.replace(re, (_, a, b) => a + esc(value) + b);
  };
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, (_, a, b) => a + esc(m.url) + b);
  set('name', 'description', m.description);
  for (const [attr, p] of [['property', 'og'], ['name', 'twitter']]) {
    set(attr, `${p}:title`, m.title);
    set(attr, `${p}:description`, m.description);
    if (m.image) set(attr, `${p}:image`, m.image);
  }
  set('property', 'og:url', m.url);
  if (m.image) {
    // A photo isn't 1200×630: drop the fixed size and use the small card layout.
    html = html.replace(/<meta property="og:image:(width|height)" content="[^"]*">\n?/g, '');
    set('name', 'twitter:card', 'summary');
  }
  return html;
}

// key: the slug or nbr_ public id the card app looks up; path: the card's URL path. Native mode reads the card
// itself (cached like /api/card); proxy mode asks the old worker.
export async function withCardPreview(res, req, env, key, path, ctx) {
  if (req.method !== 'GET' || !res.ok || !PREVIEW_BOT.test(req.headers.get('User-Agent') || '')) return res;
  let row = null;
  try {
    if (env.MODE === 'native') row = await cardData(env, key, ctx);
    else {
      const r = await fetch(new URL('/api/card/' + encodeURIComponent(key), env.LEGACY_ORIGIN), { headers: { 'X-Brand': 'linkcardly' }, signal: AbortSignal.timeout(TIMEOUTS.og) });
      if (r.ok) row = ((await r.json()) || {}).row || null;
    }
  } catch (e) {
    console.error(JSON.stringify({ t: 'og', key, error: String(e && e.message || e) }));
  }
  const m = row && cardMeta(row, env.SITE_URL + path);
  if (!m) return res;
  const headers = new Headers(res.headers);
  headers.delete('Content-Length');
  headers.delete('ETag');
  return new Response(applyMeta(await res.text(), m), { status: res.status, headers });
}
