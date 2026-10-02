import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHandle, normalizeHandle, suggestions, RESERVED } from '../src/lib/handles.js';
import { buildVCard } from '../src/lib/vcard.js';
import { splitRows, svg, ICONS } from '../src/lib/icons.js';
import { theme, THEMES } from '../src/lib/themes.js';

test('handles: valid examples', () => {
  for (const h of ['abc', 'alex-morgan', 'sandeep.k', 'a1b', 'x'.repeat(30)]) assert.equal(validateHandle(h).ok, true, h);
});

test('handles: normalisation lowercases and strips', () => {
  assert.equal(normalizeHandle('  Alex_Morgan! '), 'alexmorgan');
  assert.equal(validateHandle('ALEX').handle, 'alex');
});

test('handles: invalid examples are rejected with a reason', () => {
  const cases = { '': '3–30', ab: '3–30', ['x'.repeat(31)]: '3–30', '-abc': 'Letters', 'abc-': 'Letters', 'a--b': 'Letters', 'a.-b': 'Letters', '.abc': 'Letters' };
  for (const [h, why] of Object.entries(cases)) {
    const v = validateHandle(h);
    assert.equal(v.ok, false, h);
    assert.match(v.reason, new RegExp(why));
  }
  assert.equal(validateHandle(undefined).ok, false);
});

test('handles: a missing value (null, e.g. /api/handle with no ?h=) is invalid', { todo: 'DEF-22: null normalises to the handle "null"' }, () => {
  assert.equal(validateHandle(null).ok, false);
});

test('handles: every reserved word of 3+ chars is blocked', () => {
  for (const r of RESERVED) if (r.length >= 3 && /^[a-z0-9.-]+$/.test(r)) assert.equal(validateHandle(r).ok, false, r);
});

test('handles: every static marketing page is reserved', async () => {
  const { STATIC_PAGES, STATIC_PREFIXES, ORDER_ALIASES } = await import('../src/config.js');
  for (const p of [...STATIC_PAGES, ...STATIC_PREFIXES, ...ORDER_ALIASES]) if (p) assert.ok(RESERVED.has(p), p);
});

test('handles: suggestions are themselves valid handles', () => {
  for (const s of suggestions('alex')) assert.equal(validateHandle(s).ok, true, s);
});

test('handles: browser reserved list (assets/js/config.js) matches the server list', { todo: 'DEF-17: lists diverge' }, async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../public/assets/js/config.js', import.meta.url), 'utf8');
  const client = new Set(JSON.parse(src.match(/reserved:\s*(\[[^\]]*\])/)[1].replace(/'/g, '"')));
  for (const r of RESERVED) if (r.length >= 3 && !r.includes('.')) assert.ok(client.has(r), `missing in browser list: ${r}`);
});

test('handles: DB check constraint matches HANDLE_RE', async () => {
  const sql = await (await import('node:fs/promises')).readFile(new URL('../supabase/migrations/0001_init.sql', import.meta.url), 'utf8');
  assert.match(sql, /\^\[a-z0-9\]\[a-z0-9\.-\]\{1,28\}\[a-z0-9\]\$/);
});

test('vcard: escapes special characters and uses CRLF', () => {
  const v = buildVCard({ full_name: 'Ann Lee, Jr', company: 'A;B', title: 'Line1\nLine2', phone: '+1 555', email: 'a@b.co', public_url: 'https://linkcardly.com/ann' });
  assert.ok(v.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n'));
  assert.ok(v.endsWith('END:VCARD'));
  assert.match(v, /N:Lee\\, Jr;Ann;;;/);
  assert.ok(v.includes('ORG:A\\;B'));
  assert.match(v, /TITLE:Line1\\nLine2/);
  assert.ok(!v.includes('undefined'));
});

test('vcard: CR characters cannot inject extra properties', { todo: 'DEF-24: \\r is not escaped' }, () => {
  const v = buildVCard({ full_name: 'Eve\rEMAIL:attacker@evil.test', public_url: 'x' });
  assert.ok(!/\r(EMAIL|TEL|URL)[:;]/.test(v.replace(/\r\n/g, '\n')));
});

test('vcard: lines over 75 octets are folded (RFC 2426)', { todo: 'DEF-25: no line folding' }, () => {
  const v = buildVCard({ full_name: 'A'.repeat(120), public_url: 'x' });
  for (const line of v.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line.length);
});

test('icons: row split rules', () => {
  assert.deepEqual(splitRows(3), [3]);
  assert.deepEqual(splitRows(6), [6]);
  assert.deepEqual(splitRows(7), [4, 3]);
  assert.deepEqual(splitRows(8), [4, 4]);
  assert.deepEqual(splitRows(9), [5, 4]);
  assert.deepEqual(splitRows(10), [5, 5]);
});

test('icons: unknown icon falls back to link', () => {
  assert.equal(svg('nope'), svg('link'));
  assert.ok(Object.keys(ICONS).length > 10);
});

test('themes: unknown key falls back to folio', () => {
  assert.equal(theme('nope'), THEMES.folio);
});

test('themes: every colourway offered in the browser catalogue exists on the server', { todo: 'DEF-19: estate, hivis missing in themes.js' }, async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../public/assets/js/catalogue.js', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/^\s{4}([a-z]+): \[/gm)].map(m => m[1]);
  assert.ok(keys.length > 5);
  for (const k of keys) assert.ok(THEMES[k], `missing theme ${k}`);
});
