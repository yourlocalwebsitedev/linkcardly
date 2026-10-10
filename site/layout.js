// Shared page shell for every marketing page: <head>, header, footer and scripts. Design: Linkcardly Home v13.
import { SITE_URL, NAV, FOOTER_LINKS } from './site.config.js';

const logo = '<a class="logo" href="/" aria-label="Linkcardly home">Link<span>card</span>ly</a>';
const arrow = '<i class="ic ic-arrow" aria-hidden="true"></i>';

const head = p => `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.title}</title><meta name="description" content="${p.description}">
<link rel="canonical" href="${SITE_URL}${p.path}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Linkcardly"><meta property="og:title" content="${p.title}"><meta property="og:description" content="${p.description}"><meta property="og:url" content="${SITE_URL}${p.path}"><meta property="og:image" content="${SITE_URL}/assets/img/brand/og-image.png">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#EEDFD4">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/assets/img/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/css/tokens.css"><link rel="stylesheet" href="/assets/css/site.css">${p.preload ? `<link rel="preload" as="image" href="${p.preload}" fetchpriority="high">` : ''}`;

const header = p => `<header class="top">
  <nav class="nav" aria-label="Main">
    ${logo}
    <div class="nav-links">${NAV.map(([label, href, key]) => `<a href="${href}"${key === p.active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div>
    <a class="btn nav-cta" href="/create">Create my card${arrow}</a>
    <button class="menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="menu"><i class="ic ic-menu" aria-hidden="true"></i></button>
  </nav>
  <div class="menu" id="menu">${NAV.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}<a class="btn" href="/create">Create my card →</a></div>
</header>`;

const footer = () => `<footer class="foot">
  <div class="foot-in">
    ${logo}
    <nav aria-label="Footer">${FOOTER_LINKS.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}</nav>
    <small>© ${new Date().getFullYear()} Linkcardly</small>
  </div>
</footer>`;

export const layout = (p, body) => `<!doctype html>
<html lang="en"><head>
${head(p)}
</head><body>
<a class="skip" href="#main">Skip to content</a>
${header(p)}
<main id="main">
${body}</main>
${footer()}
<script src="/app/config.js"></script><script src="/assets/js/rules.js"></script><script src="/assets/js/site.js" defer></script>${(p.scripts || []).map(s => `<script src="${s}" defer></script>`).join('')}
</body></html>
`;
