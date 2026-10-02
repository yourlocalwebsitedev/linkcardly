// Server-rendered public card (MODE = "native").
import { svg, splitRows, LABELS } from '../lib/icons.js';
import { theme } from '../lib/themes.js';
import { safeUrl, sanitizeHtml } from '../lib/sanitize.js';

const e = (v = '') => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mix = (a, b, p) => `color-mix(in srgb, ${a} ${p}%, ${b})`;

function linkHref(l) {
  const v = l.url || '';
  switch (l.type) {
    case 'call': return `tel:${v.replace(/[^\d+]/g, '')}`;
    case 'sms': return `sms:${v.replace(/[^\d+]/g, '')}`;
    case 'whatsapp': return `https://wa.me/${v.replace(/\D/g, '')}`;
    case 'email': return `mailto:${v}`;
    case 'directions': return `https://maps.google.com/?q=${encodeURIComponent(v)}`;
    default: return safeUrl(/^https?:\/\//i.test(v) ? v : `https://${v}`, ['https:', 'http:']) || '#';
  }
}

function iconRows(links) {
  const sizes = splitRows(links.length);
  let at = 0;
  return sizes.map(len => {
    const items = links.slice(at, at += len);
    const cls = links.length <= 3 ? 'tight' : len === 6 ? 'six' : '';
    return `<div class="ic-row ${cls}">${items.map(l => `
      <a class="ic" href="${e(linkHref(l))}" target="_blank" rel="noopener" aria-label="${e(l.label || LABELS[l.type] || 'Link')}">
        <span class="ic-dot">${svg(l.type)}</span><span class="ic-lbl">${e(l.label || LABELS[l.type] || 'Link')}</span>
      </a>`).join('')}</div>`;
  }).join('');
}

export function renderCard(card, links, env, opts = {}) {
  const t = theme(card.theme);
  const url = `${env.SITE_URL}/${card.handle}`;
  const title = `${card.full_name}${card.title ? ' · ' + card.title : ''} | Linkcardly`;
  const desc = card.bio || [card.title, card.company].filter(Boolean).join(' at ') || 'Digital business card';
  const visible = links.filter(l => l.is_visible !== false).sort((a, b) => a.sort_order - b.sort_order).slice(0, 10);
  const details = [['Area', card.service_area], ['City', card.city], ['Hours', card.hours]].filter(([, v]) => v);
  const tags = (card.services || []).slice(0, 6);
  const avatar = safeUrl(card.avatar_url), cover = safeUrl(card.cover_url), video = safeUrl(card.video_url), booking = safeUrl(card.booking_url, ['https:', 'http:']);
  const focus = /^\d{1,3}% \d{1,3}%$/.test(card.cover_focus || '') ? card.cover_focus : '50% 30%';
  const portrait = video && card.plan === 'motion'
    ? `<video class="cover-media" src="${e(video)}" autoplay muted loop playsinline poster="${e(cover)}"></video>`
    : cover ? `<img class="cover-media" src="${e(cover)}" alt="" style="object-position:${focus}">` : '';

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${e(title)}</title><meta name="description" content="${e(desc)}">
<link rel="canonical" href="${e(url)}">
<meta property="og:type" content="profile"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:url" content="${e(url)}">
${avatar ? `<meta property="og:image" content="${e(avatar)}">` : ''}<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="${t.bg}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="/assets/css/card.css">
<style>:root{--bg:${t.bg};--ink:${t.ink};--btn:${t.btn};--btn-ink:${t.btnInk};--tint:${mix(t.ink, t.bg, 8)};--line:${mix(t.ink, t.bg, 16)};--muted:${mix(t.ink, t.bg, 72)}}</style>
</head><body>
<main class="card">
  <div class="cover">${portrait}<div class="cover-shade"></div>
    <button class="share" data-share="${e(url)}" aria-label="Share this card">${svg('share', 18)}</button>
  </div>
  <div class="body">
    <header class="who">
      <div class="avatar">${avatar ? `<img src="${e(avatar)}" alt="${e(card.full_name)}">` : ''}</div>
      <h1>${e(card.full_name)}</h1>
      ${card.title ? `<p class="role">${e(card.title)}</p>` : ''}
      ${card.company ? `<p class="co">${e(card.company)}</p>` : ''}
      ${card.bio ? `<p class="bio">${e(card.bio)}</p>` : ''}
    </header>
    ${visible.length ? `<nav class="icons" aria-label="Contact options">${iconRows(visible)}</nav>` : ''}
    <div class="actions">
      <a class="btn primary" href="/${e(card.handle)}/contact.vcf">${svg('userPlus', 19)}Save contact</a>
      ${booking ? `<a class="btn" href="${e(booking)}" target="_blank" rel="noopener">${svg('calendar', 19)}${e(card.booking_label || 'Book a time')}</a>` : ''}
      <button class="btn" data-qr="${e(url)}">${svg('qr', 19)}Show QR code</button>
    </div>
    ${details.length || tags.length ? `<section class="details">
      ${details.map(([k, v]) => `<div class="row"><span>${k}</span><strong>${e(v)}</strong></div>`).join('')}
      ${tags.length ? `<div class="tags">${tags.map(s => `<span>${e(s)}</span>`).join('')}</div>` : ''}
    </section>` : ''}
    ${card.lead_form ? `<form class="lead" method="post" action="/api/lead">
      <h2>Leave your details</h2>
      <input type="hidden" name="handle" value="${e(card.handle)}">
      <input name="name" placeholder="Your name" required autocomplete="name">
      <input name="phone" placeholder="Phone" type="tel" autocomplete="tel">
      <textarea name="message" placeholder="Message" rows="3"></textarea>
      <div class="cf-turnstile" data-sitekey="${e(env.TURNSTILE_SITE_KEY)}"></div>
      <button class="btn primary" type="submit">Send</button>
    </form>` : ''}
    ${card.compliance_html ? `<footer class="compliance">${sanitizeHtml(card.compliance_html)}</footer>` : ''}
    ${card.powered_by !== false ? `<a class="powered" href="${env.SITE_URL}/create">Powered by Linkcardly · Get a card like this</a>` : ''}
  </div>
</main>
<dialog id="qr"><div class="qr-box"><img alt="QR code for ${e(url)}" src="/api/qr?u=${encodeURIComponent(url)}"><p>${e(url.replace(/^https?:\/\//, ''))}</p><button class="btn" data-close>Close</button></div></dialog>
${card.lead_form ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
<script src="/assets/js/card.js" defer></script>
</body></html>`;
}
