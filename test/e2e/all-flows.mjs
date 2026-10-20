// Every page, button and order workflow at 390 × 844 (and 1440 × 900 for the header).
// Run against `npm run dev`:  BASE=http://127.0.0.1:8787 node test/e2e/all-flows.mjs
// Needs Playwright:          npm i -D playwright && npx playwright install chromium
// Orders use ?mock=1 (no database write, no payment). Exit code 1 on any failure.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const PAGES = ['/', '/how-it-works', '/nfc-cards', '/pricing', '/teams', '/contact', '/privacy', '/terms', '/refunds', '/claim', '/designs'];
const NAV = ['Digital Card', 'NFC Cards', 'Pricing', 'Teams', 'Contact'];
const fails = [];
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fails.push(msg); };

const browser = await chromium.launch();
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await phone.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|turnstile/i.test(m.text())) errors.push(m.text()); });

async function audit(path) {
  return page.evaluate(() => {
    const vis = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const ctrls = [...document.querySelectorAll('a,button,input,select,textarea')].filter(vis);
    return {
      hscroll: document.documentElement.scrollWidth - innerWidth,
      small: ctrls.filter(e => { const inText = e.tagName === 'A' && e.closest('p,li,small') && !e.matches('.btn,.text-link'); return !inText && !e.matches('.skip,.claim input,[type=checkbox],[type=radio]') && e.getBoundingClientRect().height < 44; })
        .map(e => (e.textContent || e.getAttribute('aria-label') || e.id).trim().slice(0, 30)),
      noName: ctrls.filter(e => !(e.textContent.trim() || e.getAttribute('aria-label') || e.title || (e.labels && e.labels.length) || e.placeholder)).map(e => e.outerHTML.slice(0, 60)),
      noAlt: [...document.images].filter(i => !i.hasAttribute('alt')).map(i => i.src),
      broken: [...document.images].filter(i => i.complete && i.getAttribute('src') && i.naturalWidth === 0).map(i => i.src),
      links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href.split('#')[0]).filter(h => h.startsWith(location.origin)))]
    };
  });
}

console.log('Marketing pages (390 × 844)');
const seen = new Map();
for (const p of PAGES) {
  errors.length = 0;
  const r = await page.goto(BASE + p, { waitUntil: 'networkidle' });
  check(r && r.status() === 200, `${p} loads (${r && r.status()})`);
  const a = await audit(p);
  check(a.hscroll <= 0, `${p} no horizontal scroll`);
  check(!a.small.length, `${p} tap targets ≥ 44px ${a.small.join(', ')}`);
  check(!a.noName.length, `${p} every control has a name ${a.noName.join(' ')}`);
  check(!a.noAlt.length && !a.broken.length, `${p} images have alt and load ${[...a.noAlt, ...a.broken].join(' ')}`);
  const menu = page.locator('.menu-btn');
  if (await menu.count()) {
    await menu.click();
    check(await menu.getAttribute('aria-expanded') === 'true', `${p} phone menu opens`);
    const items = (await page.locator('#menu a').allTextContents()).map(t => t.trim());
    check(NAV.every(n => items.includes(n)), `${p} menu has ${NAV.join(' · ')}`);
    await menu.click();
  }
  check(!errors.length, `${p} no console errors ${errors.join(' | ')}`);
  for (const l of a.links) if (!seen.has(l)) seen.set(l, p);
}
for (const [l, from] of seen) {
  const r = await page.request.get(l);
  check(r.status() < 400, `link ${l.replace(BASE, '')} (from ${from}) → ${r.status()}`);
}

console.log('Region prices');
await page.goto(BASE + '/nfc-cards?region=IN');
check((await page.locator('.price b').allTextContents()).some(t => t.includes('₹')), 'India shows ₹');
await page.goto(BASE + '/nfc-cards?region=US');
check((await page.locator('.price b').allTextContents()).some(t => t.includes('$69')), 'US stands show $69');

const btn = name => page.getByRole('button', { name, exact: false }).first();
async function details({ cat, extra = {} }) {
  await btn(cat).click();
  await page.fill('#o-firstName', 'Asha'); await page.fill('#o-lastName', 'Rao');
  if (await page.locator('#o-title').isVisible()) await page.fill('#o-title', 'Architect');
  await page.fill('#o-phone', extra.phone || '9876543210'); await page.fill('#o-email', 'asha@example.com');
  for (const [id, v] of Object.entries(extra.fields || {})) await page.fill('#' + id, v);
  await page.fill('#o-handle', 'qa' + Date.now().toString(36));
  await page.waitForTimeout(1500);
}

async function order({ region, product, label, cat, extra, ship, total }) {
  console.log(`Order: ${label} (${region})`);
  errors.length = 0;
  await page.goto(`${BASE}/create?fresh=1&mock=1&region=${region}`, { waitUntil: 'networkidle' });
  await btn(label).click();
  await btn('Continue').click();
  await btn('Continue').click();
  check(await page.getByRole('alert').count() > 0, 'empty details show errors');
  await details({ cat, extra });
  await btn('Continue').click();
  check(await btn('Continue to payment').isVisible(), 'reaches preview');
  // design picker: walk to the last design and back; arrows hide at the ends
  let n = 0; while (await page.getByRole('button', { name: 'Next design' }).isVisible() && n < 40) { await page.getByRole('button', { name: 'Next design' }).click(); n++; }
  check(!(await page.getByRole('button', { name: 'Next design' }).isVisible()), `next arrow hides on last design (${n} steps)`);
  while (await page.getByRole('button', { name: 'Previous design' }).isVisible() && n > -40) { await page.getByRole('button', { name: 'Previous design' }).click(); n--; }
  check(!(await page.getByRole('button', { name: 'Previous design' }).isVisible()), 'previous arrow hides on first design');
  const sw = page.locator('button[aria-pressed]').filter({ hasNotText: /design/i });
  check(await sw.count() >= 3, `at least three colours (${await sw.count()})`);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  check(await page.inputValue('#o-firstName') === 'Asha', 'Back keeps the details');
  await btn('Continue').click();
  await btn('Continue to payment').click();
  const cta = page.locator('.lc-cta:visible');
  check(await page.locator('.lcs-ship').count() === (ship ? 1 : 0), ship ? 'address form shown' : 'no address form');
  if (ship) {
    check(await cta.isDisabled(), 'pay disabled before address');
    await page.fill('#o-ship-name', 'Asha Rao'); await page.fill('#o-ship-line1', '12 MG Road');
    await page.fill('#o-ship-city', 'Bengaluru'); await page.selectOption('#o-ship-state', 'Karnataka');
    await page.fill('#o-ship-pin', '5600');
    check(await cta.isDisabled(), 'pay disabled with a 5-digit PIN');
    await page.fill('#o-ship-pin', '560001');
    check(await cta.isEnabled(), 'pay enabled with a full address');
  }
  check((await page.locator('[data-pay-summary]').textContent()).includes(total), `total ${total}`);
  await page.fill('#o-coupon', 'NOTACODE'); await btn('Apply').click();
  await page.waitForTimeout(1500);
  check(await page.getByText(/not valid|could not check/i).count() > 0, 'bad coupon shows a message');
  await cta.click();
  await page.waitForTimeout(1500);
  check(await page.getByRole('heading', { name: /ready|live|received/i }).count() > 0, 'done screen');
  await btn('Copy link').click();
  check(await page.getByText('Copied').count() > 0, 'Copy link confirms');
  const dl = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
  await btn('Download QR').click();
  check(!!(await dl), 'Download QR downloads');
  check(!!(await page.getByRole('link', { name: /Open card/ }).getAttribute('href')), 'Open card has a link');
  await btn('Order another card').click();
  check(await page.getByText('What do you need?').count() > 0, 'Order another card resets');
  check(!errors.length, 'no console errors ' + errors.join(' | '));
  const a = await audit();
  check(a.hscroll <= 0, 'order flow has no horizontal scroll');
}

await order({ region: 'IN', label: 'Digital Card', cat: 'Personal', ship: false, total: '₹799' });
await order({ region: 'IN', label: 'NFC Card · Basic', cat: 'Personal', ship: true, total: '₹1,598' });
await order({ region: 'IN', label: 'NFC Card · Custom', cat: 'Personal', ship: true, total: '₹2,598' });
await order({ region: 'US', label: 'Digital Card', cat: 'Real Estate', ship: false, total: '$29', extra: { phone: '8165550123', fields: { 'o-brokerage': 'Keller Homes', 'o-licenseNo': 'DRE 0123456', 'o-licenseState': 'TX' } } });

console.log('Desktop header (1440 × 900)');
const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const p of ['/', '/create']) {
  await desk.goto(BASE + p, { waitUntil: 'networkidle' });
  const t = (await desk.locator('header a').allTextContents()).map(s => s.trim());
  check(NAV.every(n => t.includes(n)), `${p} header nav is ${NAV.join(' · ')}`);
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nAll passed');
process.exit(fails.length ? 1 : 0);
