export const VERSION = 'v2';

// Paths served as static files from /public.
export const STATIC_PAGES = new Set(['', 'designs', 'teams', 'contact', 'privacy', 'terms', 'refunds']);
export const STATIC_PREFIXES = new Set(['assets', 'app']);

// /create serves the vendored order app (opens on Plan). Old paths redirect there.
export const ORDER_ALIASES = new Set(['order', 'pricing']);

export const APP = { order: '/app/order.html', card: '/app/card.html' };
