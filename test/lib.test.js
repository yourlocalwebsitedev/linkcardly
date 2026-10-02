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

test('handles: a missing value (null, e.g. /api/handle with no ?h=) is invalid', () => {
  assert.equal(validateHandle(null).ok, false);
});

test('handles: every reserved word of 3+ chars is blocked', () => {
  for (const r of RESERVED) if (r.length >= 3 && /^[a-z0-9.-]+$/.test(r)) assert.equal(validateHandle(r).ok, false, r);
});

test('handles: every routed path segment, including each page in site/pages.js, is reserved', async () => {
  const { STATIC_PAGES, STATIC_PREFIXES, ORDER_ALIASES } = await import('../src/config.js');
  for (const p of [...STATIC_PAGES, ...STATIC_PREFIXES, ...ORDER_ALIASES, 'create', 'api', 'health', 'e', 'c']) if (p) assert.ok(RESERVED.has(p), p);
  const { pages } = await import('../site/pages.js');
  for (const p of pages) if (p.path !== '/404') assert.ok(STATIC_PAGES.has(p.path.slice(1)), p.path);
});

test('handles: suggestions are themselves valid handles, even for 30-character names', () => {
  for (const h of ['alex', 'x'.repeat(30), 'a'.repeat(27) + '-bc']) {
    const s = suggestions(h);
    assert.equal(s.length, 3, h);
    for (const x of s) assert.equal(validateHandle(x).ok, true, x);
  }
});

test('handles: names that would be routed as files are reserved', () => {
  for (const h of ['me.png', 'site.css', 'favicon.svg', 'card.vcf']) assert.equal(validateHandle(h).ok, false, h);
  assert.equal(validateHandle('alex.co').ok, true);
});

test('handles: browser reserved list is generated from the server list', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../public/assets/js/rules.js', import.meta.url), 'utf8');
  const client = JSON.parse(src.match(/window\.LC_RULES = (\{.*\});/)[1]);
  assert.deepEqual(client.reserved, [...RESERVED].sort());
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

test('vcard: CR characters cannot inject extra properties', () => {
  const v = buildVCard({ full_name: 'Eve\rEMAIL:attacker@evil.test', public_url: 'x' });
  assert.ok(!/\r(EMAIL|TEL|URL)[:;]/.test(v.replace(/\r\n/g, '\n')));
});

test('vcard: lines over 75 octets are folded (RFC 2426) without splitting characters', () => {
  const v = buildVCard({ full_name: 'A'.repeat(120) + 'é'.repeat(60), public_url: 'x' });
  for (const line of v.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line.length);
  assert.match(v.replace(/\r\n /g, ''), new RegExp('FN:' + 'A'.repeat(120) + 'é'.repeat(60)));
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

test('themes: the browser catalogue is generated from src/lib/themes.js (same colours, no copy)', async () => {
  const { runInNewContext } = await import('node:vm');
  const src = await (await import('node:fs/promises')).readFile(new URL('../public/assets/js/catalogue.js', import.meta.url), 'utf8');
  assert.match(src, /^\/\/ Generated by scripts\/build\.mjs/);
  const ctx = { window: {} };
  runInNewContext(src, ctx);
  const entries = Object.entries(ctx.window.LC.themes);
  assert.ok(entries.length > 5);
  for (const [k, [, , bg, ink, btn, btnInk]] of entries) assert.deepEqual({ bg, ink, btn, btnInk }, (({ bg, ink, btn, btnInk }) => ({ bg, ink, btn, btnInk }))(THEMES[k]), k);
  for (const c of ctx.window.LC.categories) assert.ok(ctx.window.LC.themes[c.theme], `${c.id} uses unknown theme ${c.theme}`);
});

test('sanitizeHtml / safeUrl', async () => {
  const { sanitizeHtml, safeUrl } = await import('../src/lib/sanitize.js');
  assert.equal(sanitizeHtml('<b>Hi</b> & <i>you</i>'), '<b>Hi</b> &amp; <i>you</i>');
  assert.equal(sanitizeHtml('a &amp; b'), 'a &amp; b');
  assert.equal(sanitizeHtml('<svg onload=alert(1)>x</svg>'), 'x');
  assert.equal(sanitizeHtml('<a href=" javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(sanitizeHtml('1 < 2 > 0'), '1 &lt; 2 &gt; 0');
  assert.equal(sanitizeHtml(null), '');
  assert.equal(safeUrl('https://a.b/c'), 'https://a.b/c');
  assert.equal(safeUrl('http://a.b'), '');
  assert.equal(safeUrl('http://a.b', ['http:']), 'http://a.b');
  assert.equal(safeUrl('not a url'), '');
});

test('self-hosted React and Babel are byte-identical to the SRI-pinned unpkg files support.js expects', async () => {
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const pub = new URL('../public/', import.meta.url);
  const support = await readFile(new URL('app/support.js', pub), 'utf8');
  const resources = await readFile(new URL('app/vendor/resources.js', pub), 'utf8');
  const map = Object.fromEntries([...resources.matchAll(/'(https:\/\/unpkg\.com\/[^']+)': '([^']+)'/g)].map(m => [m[1], m[2]]));
  for (const [name, sri] of [['REACT', 'REACT_SRI'], ['REACT_DOM', 'REACT_DOM_SRI'], ['BABEL', 'BABEL_SRI']]) {
    const url = support.match(new RegExp(`var ${name}_URL = "([^"]+)"`))[1];
    const want = support.match(new RegExp(`var ${sri} = "([^"]+)"`))[1];
    assert.ok(map[url], `${url} is self-hosted`);
    const got = 'sha384-' + createHash('sha384').update(await readFile(new URL('.' + map[url], pub))).digest('base64');
    assert.equal(got, want, url);
  }
  for (const page of ['order', 'card']) {
    const html = await readFile(new URL(`app/${page}.html`, pub), 'utf8');
    assert.ok(html.indexOf('/app/vendor/resources.js') > 0 && html.indexOf('/app/vendor/resources.js') < html.indexOf('/app/support.js'), page);
  }
});

test('order app uses the handle claimed on the home page (/create?h=) when it is allowed', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../public/app/order.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/assets\/js\/rules\.js"><\/script>/);
  assert.match(html, /uniqueSlug\(claimedSlug\(\) \|\| autoSlug\(d\)\)/);
  // Run the helper as the browser would.
  const src = html.match(/const slugify = [^\n]+/)[0] + '\n' + html.match(/const claimedSlug = [^\n]+/)[0];
  const run = (search, reserved = ['create']) => new Function('location', 'window', 'URLSearchParams', src + '\nreturn claimedSlug();')({ search }, { LC_RULES: { reserved } }, URLSearchParams);
  assert.equal(run('?h=alex.co'), 'alex-co');
  assert.equal(run('?h=Sandeep'), 'sandeep');
  assert.equal(run('?h=create'), '');
  assert.equal(run('?h=ab'), '');
  assert.equal(run(''), '');
});

test('order app, phone Preview step: uses the CardStyleControls component; desktop keeps its panel', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../public/app/order.html', import.meta.url), 'utf8');
  const use = html.match(/<x-import component-from-global-scope="LcCardStyleControls"[^>]*>/);
  assert.ok(use, 'phone preview renders the component');
  for (const a of ['options="{{ scs.options }}"', 'value="{{ scs.value }}"', 'open="{{ scs.open }}"', 'on-toggle="{{ scs.toggle }}"', 'on-select="{{ scs.select }}"', 'on-next="{{ next }}"', 'next-label="{{ pv.nextText }}"']) assert.ok(use[0].includes(a), a);
  // Props must not collide with the runtime's host-style names or its style-* pseudo-class prefix.
  for (const [, name] of use[0].matchAll(/\s([a-z-]+)="/g)) assert.ok(!/^(position|left|right|top|bottom|inset|width|height|z-index|transform|style-.*)$/.test(name), name);
  assert.match(html, /<sc-if value="\{\{ pv\.desktop \}\}"[^>]*><div ref="\{\{ barRef \}\}"/, 'desktop bar only on desktop');
  assert.ok(!/pillBlocks|swPillBd|handleTouchStart|lc-rise/.test(html), 'no phone-only leftovers in the shared bar');
});

test('CardStyleControls: renders trigger, next button, selector and options from props alone', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const src = await readFile(new URL('../public/app/components/card-style-controls.js', import.meta.url), 'utf8');
  // Minimal React stand-in: records the element tree; hooks return stable refs.
  const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() });
  const React = { createElement: el, useRef: v => ({ current: v ?? null }), useEffect: () => {} };
  const doc = { getElementById: () => ({}), head: { appendChild() {} }, createElement: () => ({}), currentScript: { src: 'https://x.test/app/components/card-style-controls.js' } };
  const win = { React };
  runInNewContext(src, { window: win, document: doc, URL, Set });
  const C = win.LcCardStyleControls;
  assert.equal(typeof C, 'function');
  for (const k of ['StyleTrigger', 'NextButton', 'StyleSelector', 'StyleOption']) assert.equal(typeof C.parts[k], 'function', k);
  const calls = [];
  const options = [{ id: 'a', name: 'Skyline', group: 'Personal', thumb: { bg: '#000', blocks: [{ l: '0px', t: '0px', w: '10px', h: '10px', r: '0', bg: '#fff' }] } },
    { id: 'b', name: 'Emerald', group: 'Personal', thumb: { bg: '#030', dot: '#fff' } }, { id: 'c', name: 'Dusk', group: 'Luxury', thumb: { bg: '#123' } }];
  const render = node => { if (!node || typeof node !== 'object') return node; if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children })); return { ...node, children: node.children.map(render) }; };
  const all = (n, out = []) => { if (n && typeof n === 'object') { out.push(n); n.children.forEach(c => all(c, out)); } return out; };
  const tree = render(el(C, { options, value: 'b', open: false, onToggle: () => calls.push('toggle'), onSelect: id => calls.push('select:' + id), onNext: () => calls.push('next'), nextLabel: 'Continue to payment' }));
  const nodes = all(tree), cls = c => nodes.filter(n => String(n.props.className || '').split(' ').includes(c));
  const trigger = cls('lcs-trigger')[0], next = cls('lcs-next')[0], selector = cls('lcs-selector')[0];
  assert.equal(trigger.props['aria-expanded'], 'false');
  assert.equal(trigger.props['aria-controls'], selector.props.id);
  assert.match(trigger.props['aria-label'], /Current style: Emerald/);
  assert.equal(next.props['aria-label'], 'Continue to payment');
  assert.equal(selector.props['aria-hidden'], 'true', 'closed selector is hidden from assistive tech');
  assert.ok(!cls('lcs')[0].props.className.includes('is-open'));
  const opts = cls('lcs-option');
  assert.deepEqual(opts.map(o => o.props['aria-checked']), ['false', 'true', 'false']);
  assert.deepEqual(opts.map(o => o.props.tabIndex), [-1, 0, -1], 'roving tabindex');
  assert.equal(cls('lcs-selector__sep').length, 1, 'divider between collections');
  trigger.props.onClick(); next.props.onClick(); opts[2].props.onClick();
  assert.deepEqual(calls, ['toggle', 'next', 'select:c']);
  const open = all(render(el(C, { options, value: 'a', open: true, onToggle() {}, onSelect() {}, onNext() {}, nextIcon: 'check', busy: true })));
  assert.ok(open.find(n => String(n.props.className || '').startsWith('lcs ')).props.className.includes('is-open'));
  assert.equal(open.find(n => n.props.className === 'lcs-selector').props['aria-hidden'], undefined);
  assert.ok(open.find(n => String(n.props.className || '').startsWith('lcs ')).props.className.includes('lcs--dark'), '#000 card: dark glass');
  assert.equal(open.find(n => n.props.className === 'lcs-selector__title').children[0], 'Personal styles');
  assert.equal(open.find(n => n.props.className === 'lcs-selector__count').children[0], '1 of 2');
  assert.ok(open.find(n => n.props.className === 'lcs__dim'), 'dim layer behind the open sheet');
  assert.equal(C.toneOf('#F4F1EC'), 'light'); assert.equal(C.toneOf('#14213D'), 'dark'); assert.equal(C.toneOf('linear-gradient(red,blue)'), 'dark');
  const light = all(render(el(C, { options: [{ id: 'l', name: 'Yard Sign', thumb: { bg: '#fff' } }], value: 'l', onToggle() {}, onSelect() {}, onNext() {} })));
  assert.ok(light.find(n => String(n.props.className || '').startsWith('lcs ')).props.className.includes('lcs--light'));
  assert.equal(open.find(n => String(n.props.className || '').split(' ').includes('lcs-next')).props.disabled, true);
});

test('CardStyleControls CSS: liquid glass, spec sizes, safe area, tokens and reduced motion', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../public/app/components/card-style-controls.css', import.meta.url), 'utf8');
  assert.match(css, /padding:10px 16px max\(24px,calc\(16px \+ env\(safe-area-inset-bottom\)\)\)/);
  assert.match(css, /\.lcs-trigger\{width:auto;min-width:160px;[^}]*height:56px;[^}]*border-radius:28px/);
  assert.match(css, /\.lcs-next\{width:56px;height:56px;[^}]*border-radius:28px/);
  assert.match(css, /\.lcs-glass\{[^}]*background:var\(--lcs-glass\);[^}]*backdrop-filter:var\(--lcs-blur\)/);
  assert.match(css, /\.lcs__panel\{[^}]*left:8px;right:8px;bottom:8px;[^}]*border-radius:34px;\s*background:var\(--lcs-sheet\)/);
  assert.match(css, /\.lcs--light\{[^}]*--lcs-ink:var\(--lcs-navy\)/, 'light cards get navy ink');
  assert.match(css, /\.lcs__fade\{[^}]*var\(--lcs-card\)/, 'fade uses the card colour');
  assert.ok(!/rgba\(10,20,40/.test(css), 'no navy panel');
  // Palette comes from the card UI tokens, not hex values in the component.
  assert.match(css, /--lcs-navy:var\(--lc-navy/);
  assert.match(css, /--lcs-cream:var\(--lc-cream/);
  assert.match(css, /--lcs-accent:var\(--lc-terracotta/);
  assert.match(css, /@supports not/, 'opaque fallback without backdrop-filter');
  assert.match(css, /prefers-reduced-motion:reduce/);
});
