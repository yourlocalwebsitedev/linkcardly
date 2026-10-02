import { FILE_EXT } from '../config.js';

export const RESERVED = new Set([
  'designs', 'pricing', 'teams', 'create', 'contact', 'privacy', 'terms', 'refunds',
  'admin', 'login', 'logout', 'signup', 'api', 'edit', 'help', 'about', 'blog',
  'assets', 'static', 'app', 'order', 'e', 'c', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'health'
]);

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
