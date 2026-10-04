export const VERSION = 'v3';

import { pages } from '../site/pages.js';

// Marketing pages served as static files from /public: derived from the page registry, so a new
// page is one entry in site/pages.js. The 404 page is a file, not a route.
export const STATIC_PAGES = new Set(pages.filter(p => p.path !== '/404').map(p => p.path.slice(1)));
export const STATIC_PREFIXES = new Set(['assets', 'app']);

// /create serves the vendored order app (opens on Plan). Old paths redirect there.
export const ORDER_ALIASES = new Set(['order', 'pricing']);

// Asset paths without ".html": the assets binding redirects *.html URLs, which would drop the
// card handle or edit token from the address bar (the vendored app reads them from location).
export const APP = { order: '/app/order', card: '/app/card', admin: '/app/admin' };

// A first path segment ending in one of these is a static file. Handles may contain dots,
// so only real file extensions count (handles.js rejects handles that end in one).
export const FILE_EXT = /\.(html?|css|m?js|json|xml|txt|svg|png|jpe?g|gif|webp|avif|ico|webmanifest|map|woff2?|ttf|otf|pdf|mp4|webm|vcf)$/i;

// Upstream and third-party timeouts (ms).
export const TIMEOUTS = { db: 8000, turnstile: 5000, proxy: 60000, health: 4000, og: 2500 };
