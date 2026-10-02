// Shared page shell for every marketing page: <head>, header, footer and scripts.
import { SITE_URL, NAV, FOOTER_LINKS } from './site.config.js';

const logo = '<a class="logo" href="/" aria-label="Linkcardly home">link<span>card</span>ly</a>';

const head = p => `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.title}</title><meta name="description" content="${p.description}">
<link rel="canonical" href="${SITE_URL}${p.path}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Linkcardly"><meta property="og:title" content="${p.title}"><meta property="og:description" content="${p.description}"><meta property="og:url" content="${SITE_URL}${p.path}"><meta property="og:image" content="${SITE_URL}/assets/img/brand/og-image.png">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#f5ead8">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/assets/img/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="/assets/css/site.css">`;

const header = p => `<header class="top">
  <nav class="nav" aria-label="Main">
    ${logo}
    <div class="nav-links">${NAV.map(([label, href, key]) => `<a href="${href}"${key === p.active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div>
    <a class="btn btn-dark" href="/create">Create my card →</a>
    <button class="menu-btn" type="button" aria-label="Menu" aria-expanded="false">☰</button>
  </nav>
  <div class="menu">${NAV.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}</div>
</header>`;

const claimCta = `<h2 style="font-size:clamp(38px,6vw,80px);line-height:1;max-width:820px">Next time someone asks for your card, send a link.</h2>
    <form class="claim" data-claim style="box-shadow:none"><span>linkcardly.com/</span><input name="h" placeholder="yourname" aria-label="Your link name" autocomplete="off"><button class="btn btn-accent" type="submit">Claim it →</button></form>`;

const footer = p => `<footer class="foot">
  <div class="wrap stack" style="--g:24px;align-items:flex-start">
    ${p.cta ? claimCta : ''}
    <nav aria-label="Footer" style="width:100%">${logo}${FOOTER_LINKS.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}</nav>
    <p style="font-size:13px">© ${new Date().getFullYear()} Linkcardly</p>
  </div>
</footer>`;

const stickyBar = '<div class="sticky"><span>Your business card, in a link</span><a class="btn btn-accent" href="/create" style="font-size:15px">Claim it →</a></div>';

export const layout = (p, body) => `<!doctype html>
<html lang="en"><head>
${head(p)}
</head><body>
<a class="skip" href="#main">Skip to content</a>
${header(p)}
<main id="main">
${body}</main>
${footer(p)}
${p.sticky ? stickyBar : ''}
${p.turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
<script src="/assets/js/config.js"></script><script src="/assets/js/rules.js"></script><script src="/assets/js/catalogue.js"></script><script src="/assets/js/icons.js"></script><script src="/assets/js/site.js" defer></script>
</body></html>
`;
