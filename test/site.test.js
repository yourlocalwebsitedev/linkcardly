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

test('production config: no placeholder Turnstile site key is shipped', async () => {
  const html = await read('contact/index.html');
  assert.ok(!/YOUR_TURNSTILE_SITE_KEY|\{\{/.test(html));
  assert.match(html, /data-sitekey="0x[0-9A-Za-z_-]+"/);
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.ok(!toml.includes('YOUR_TURNSTILE_SITE_KEY'));
});

test('production content: legal pages have real policy text', async () => {
  for (const p of ['privacy', 'terms', 'refunds']) assert.ok(!(await read(p + '/index.html')).includes('Policy text goes here'), p);
});

test('claim form passes the typed handle to /create', async () => {
  const js = await read('assets/js/site.js');
  const block = js.slice(js.indexOf("form[data-claim]"), js.indexOf('// live availability'));
  assert.match(block, /'h=' \+ encodeURIComponent\(h\)/);
});

test('site.js: marquee state is declared before the chip strip uses it (no TDZ crash on home)', async () => {
  const js = await read('assets/js/site.js');
  assert.ok(js.indexOf('let x = 0') < js.indexOf('if (loop) x = 0'));
});

test('skip link becomes visible on focus', async () => {
  assert.match(await read('index.html'), /<a class="skip" href="#main">/);
  assert.match(await read('assets/css/site.css'), /\.skip:focus\{left:/);
});

test('vendored app README and legacy images are not published', async () => {
  assert.match(await read('.assetsignore'), /^app\/README\.md$/m);
  await assert.rejects(read('assets/img/legacy/nexbizrise-logo.png'));
});
