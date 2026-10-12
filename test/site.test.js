// Static checks on the built marketing site (run `npm run build` first; `npm test` does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pages } from '../site/pages.js';

const read = p => readFile(new URL('../public/' + p, import.meta.url), 'utf8');

test('every page builds with title, description, canonical, lang and one h1', async () => {
  for (const p of pages) {
    const html = await read(p.out);
    assert.match(html, /<html lang="en">/, p.name);
    assert.match(html, /<title>[^<]+<\/title>/, p.name);
    assert.match(html, /<meta name="description" content="[^"]+">/, p.name);
    assert.match(html, /<link rel="canonical" href="https:\/\/linkcardly\.com/, p.name);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${p.name}: h1 count`);
  }
});

test('sitemap lists every sitemap page plus /create', async () => {
  const xml = await read('sitemap.xml');
  for (const p of pages.filter(p => p.sitemap)) assert.ok(xml.includes(`<loc>https://linkcardly.com${p.path}</loc>`), p.path);
  assert.ok(xml.includes('https://linkcardly.com/create'));
  assert.ok(!xml.includes('/404'));
});

test('internal links on marketing pages resolve to a known route', async () => {
  const { STATIC_PAGES } = await import('../src/config.js');
  for (const p of pages) {
    const html = await read(p.out);
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)/g)) {
      const first = href.split('/')[1] || '';
      assert.ok(STATIC_PAGES.has(first) || ['create', 'assets', 'app', 'favicon.svg'].includes(first), `${p.name}: ${href}`);
      assert.ok(href === '/' || !href.endsWith('/'), `${p.name}: ${href} has a trailing slash`);
    }
  }
});

test('no NexBizRise branding on marketing pages', async () => {
  for (const p of pages) assert.ok(!/nexbizrise/i.test(await read(p.out)), p.name);
});

test('form inputs on marketing pages have accessible names', async () => {
  for (const p of pages) {
    const html = await read(p.out);
    for (const [tag] of html.matchAll(/<(input|textarea)\b[^>]*>/g)) {
      if (/type="hidden"/.test(tag)) continue;
      const labelled = /aria-label=/.test(tag) || new RegExp(`<label[^>]*>[^<]*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(html);
      assert.ok(labelled, `${p.name}: ${tag}`);
    }
  }
});

test('production config: forms get their Turnstile key at runtime from /app/config.js, never baked into pages', async () => {
  const html = await read('contact/index.html');
  assert.ok(!/YOUR_TURNSTILE_SITE_KEY|\{\{|data-sitekey=/.test(html));
  assert.match(html, /data-turnstile/);
  assert.match(html, /<script src="\/app\/config\.js"><\/script>/);
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.ok(!toml.includes('YOUR_TURNSTILE_SITE_KEY'));
  for (const k of toml.match(/^TURNSTILE_SITE_KEY = "([^"]*)"/gm)) assert.match(k, /"0x[0-9A-Za-z_-]+"/);
});

test('production content: legal pages have real policy text', async () => {
  for (const p of ['privacy', 'terms', 'refunds']) assert.ok(!(await read(p + '/index.html')).includes('Policy text goes here'), p);
});

test('claim form passes the typed handle to /create', async () => {
  const js = await read('assets/js/site.js');
  const block = js.slice(js.indexOf("form[data-claim]"), js.indexOf('// live availability'));
  assert.match(block, /'h=' \+ encodeURIComponent\(h\)/);
});

test('skip link becomes visible on focus', async () => {
  assert.match(await read('index.html'), /<a class="skip" href="#main">/);
  assert.match(await read('assets/css/site.css'), /\.skip:focus\{left:/);
});

test('vendored app README and legacy images are not published', async () => {
  assert.match(await read('.assetsignore'), /^app\/README\.md$/m);
  await assert.rejects(read('assets/img/legacy/nexbizrise-logo.png'));
});

test('design tokens: one source (tokens.css) loaded before site.css and the app skin; no hex colours in the skin', async () => {
  const css = p => readFile(new URL('../public/' + p, import.meta.url), 'utf8');
  const tokens = await css('assets/css/tokens.css');
  for (const t of ['--lc-paper', '--lc-sand', '--lc-white', '--lc-ink', '--lc-muted', '--lc-accent', '--lc-accent-hover', '--font-h', '--font-b']) assert.match(tokens, new RegExp(t + ':'), t);
  const site = await css('assets/css/site.css'), skin = await css('app/skin-v13.css');
  for (const t of ['--lc-paper', '--lc-accent', '--n100', '--a600', '--font-h']) assert.ok(!site.includes(t + ':') && !skin.includes(t + ':'), `${t} is redefined outside tokens.css`);
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(skin), 'app/skin-v13.css uses tokens, not hex colours');
  const html = await read('index.html'), order = await css('app/order.html');
  assert.ok(html.indexOf('tokens.css') < html.indexOf('site.css'));
  assert.ok(order.indexOf('tokens.css') > 0 && order.indexOf('tokens.css') < order.indexOf('skin-v13.css'));
});

test('every page uses the v13 sheet header and no inline layout styles', async () => {
  for (const p of pages) {
    const html = await read(p.out), main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    assert.match(main, /<section class="sheet[ "]/, p.name);
    assert.ok(!/style="/.test(main), `${p.name}: inline style in page body`);
  }
});

test('no previous-design leftovers: gold theme, old fonts, old stylesheets', async () => {
  for (const p of pages) {
    const html = await read(p.out);
    assert.ok(!/gold|Caprasimo|Figtree|Bricolage|theme\.css|icons\.js/i.test(html), p.name);
  }
  for (const f of ['assets/css/site.css', 'assets/css/tokens.css', 'assets/js/site.js', 'assets/js/designs.js', 'app/skin-v13.css']) assert.ok(!/gold|#ECC48F|Caprasimo/i.test((await read(f)).replace(/--gold:/g, '')), f);
  for (const f of ['assets/css/gold.css', 'assets/css/theme.css', 'app/skin-gold.css', 'app/skin.css', 'app/skin-paper.css', 'app/skin-warm.css', 'app/brand.js']) await assert.rejects(read(f), f);
});

test('home is Home v13: one claim form, hero copy, photos, features, site footer', async () => {
  const html = await read('index.html');
  assert.equal((html.match(/<form class="claim[ "][^>]*data-claim>/g) || []).length, 1);
  assert.match(html, /Your identity\.<br><span>One simple link\.<\/span>/);
  assert.equal((html.match(/class="perk"/g) || []).length, 4, 'perks under the hero');
  assert.equal((html.match(/class="flow-step"/g) || []).length, 4, 'create-your-card steps');
  assert.equal((html.match(/class="way"/g) || []).length, 4, 'share methods');
  assert.ok(!/samples\/portrait\.svg|ic ic-users/.test(html));
  for (const f of ['arjun', 'meera', 'priya', 'alex']) await read('assets/img/home/face-' + f + '.webp');
  assert.ok((html.match(/<details>/g) || []).length >= 4, 'home FAQ');
  assert.match(html, /<footer class="foot">/);
  for (const img of ['hero-product-photo.webp', 'hero-avatars.png']) await read('assets/img/home/' + img);
  assert.ok(!html.includes('hero-product-photo.png'));
});

test('designs shows the real card page in preview mode, fed by the shared style lists', async () => {
  const html = await read('designs/index.html');
  assert.match(html, /<iframe src="\/app\/card\.html\?preview=1"/);
  assert.match(html, /<dialog class="viewer"/);
  for (const s of ['/assets/js/catalogue.js', '/app/estate-styles.js', '/app/scene-styles.js', '/assets/js/designs.js']) assert.ok(html.includes(`<script src="${s}"`), s);
  const js = await read('assets/js/designs.js');
  assert.match(js, /type: 'nbr-preview'/);
  assert.ok(!/#[0-9a-f]{6}/i.test(js), 'designs.js has no colours of its own');
});

test('design renders exist for every shared estate and scene style', async () => {
  const { runInNewContext } = await import('node:vm');
  const ctx = { window: {} };
  runInNewContext(await read('app/estate-styles.js'), ctx); runInNewContext(await read('app/scene-styles.js'), ctx);
  const ids = [...Object.values(ctx.window.LC_ESTATE.rows).flat().map(r => r[0]), ...ctx.window.LC_SCENES.styles.map(s => s.id)];
  for (const id of ids) await read('assets/img/designs/' + id + '.webp');
});

test('prices: one currency per visitor, picked from location (no currency toggle, no both-currency copy)', async () => {
  for (const f of ['index.html', 'pricing/index.html']) {
    const html = await read(f);
    assert.ok(!/data-region|USA · \$|India · ₹/.test(html), f + ': no currency toggle');
    assert.ok(!/In India, Digital Card is/.test(html), f + ': no copy that lists both currencies');
    for (const m of html.matchAll(/<b data-us="([^"]+)" data-in="([^"]+)">([^<]+)<\/b>/g)) assert.equal(m[3], m[1], 'US amount is the no-JS default');
  }
  const js = await read('assets/js/site.js');
  assert.match(js, /cdn-cgi\/trace/);
  assert.match(js, /el\.dataset\[k\]/);
});
