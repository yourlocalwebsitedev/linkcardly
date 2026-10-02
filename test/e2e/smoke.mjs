// Browser smoke test against a running Worker (default: `npm run dev` on :8787).
// Usage: BASE=http://127.0.0.1:8787 node test/e2e/smoke.mjs   (needs `playwright` installed)
// Prints per-page JSON (final URL, horizontal overflow, JS errors) and exits 1 on any page error.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const browser = await chromium.launch();
const out = {};
let failed = false;

for (const [name, viewport] of [['mobile', { width: 375, height: 800 }], ['desktop', { width: 1366, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport });
  for (const p of ['/', '/designs', '/teams', '/contact', '/privacy', '/terms', '/refunds', '/create']) {
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ path: location.pathname, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
    out[`${name} ${p}`] = { ...r, errors };
    if (errors.length || r.overflowX) failed = true;
    await page.close();
  }
  await ctx.close();
}

// Card and edit links must keep their path (the app reads the handle / token from it).
const ctx = await browser.newContext();
for (const p of ['/alexmorgan', '/c/nbr_ab12cd', '/e/' + 'a'.repeat(40)]) {
  const page = await ctx.newPage();
  await page.goto(BASE + p, { waitUntil: 'load' });
  out[`path kept ${p}`] = new URL(page.url()).pathname === p;
  if (!out[`path kept ${p}`]) failed = true;
  await page.close();
}

// Claim form must carry the typed handle into the order flow.
{
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await page.fill('[data-hero-input]', 'janedoe');
  await page.click('form[data-claim] button');
  await page.waitForLoadState('load');
  out['claim keeps handle'] = page.url().includes('janedoe');
  if (!out['claim keeps handle']) failed = true;
}

// Reduced motion: no running animations.
{
  const c = await browser.newContext({ reducedMotion: 'reduce' }), page = await c.newPage();
  await page.goto(BASE + '/');
  await page.waitForTimeout(1000);
  out['reduced motion animations'] = await page.evaluate(() => document.getAnimations().length);
  if (out['reduced motion animations']) failed = true;
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
process.exit(failed ? 1 : 0);
