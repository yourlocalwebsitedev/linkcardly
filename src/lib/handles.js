import { FILE_EXT, STATIC_PAGES, STATIC_PREFIXES, ORDER_ALIASES } from '../config.js';

// Handles that can't be claimed: every first path segment the Worker routes itself (derived from
// config.js, so new pages and prefixes are reserved automatically), plus words kept for later use.
const ROUTED = ['create', 'api', 'health', 'e', 'c', ...STATIC_PAGES, ...STATIC_PREFIXES, ...ORDER_ALIASES];
const KEPT = ['admin', 'login', 'logout', 'signup', 'edit', 'help', 'about', 'blog', 'static', 'favicon.ico', 'robots.txt', 'sitemap.xml'];
export const RESERVED = new Set([...ROUTED, ...KEPT].filter(Boolean));

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9.-]{1,28})[a-z0-9]$/;

export function normalizeHandle(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
}

export function validateHandle(raw) {
  const h = normalizeHandle(raw);
  if (h.length < 3 || h.length > 30) return { ok: false, handle: h, reason: 'Use 3–30 characters.' };
  if (!HANDLE_RE.test(h) || /[.-]{2}/.test(h)) return { ok: false, handle: h, reason: 'Letters, numbers, dots and dashes only.' };
  if (RESERVED.has(h)) return { ok: false, handle: h, reason: 'That name is reserved.' };
  // Would be routed as a static file (e.g. "me.png").
  if (FILE_EXT.test(h)) return { ok: false, handle: h, reason: 'That name is reserved.' };
  return { ok: true, handle: h };
}

// Up to three valid alternatives, trimmed so each stays within 30 characters.
export function suggestions(h) {
  const fit = suffix => `${h.slice(0, 30 - suffix.length).replace(/[.-]+$/, '')}${suffix}`;
  return ['.co', '-card', String(new Date().getFullYear() % 100)].map(fit).filter(s => validateHandle(s).ok);
}
