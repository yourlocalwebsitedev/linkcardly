// End-to-end test of the order flow at 390 × 844 against a running Worker (default `npm run dev` on :8787):
// home page claim → Plan → Your card ("Your link" states) → Preview → Payment → order → done screen,
// plus the "name taken while paying" case and the saved-edit done screen.
// The backend is mocked in the browser (Supabase availability lookups and place_order), so no real
// order is created. Usage: BASE=http://127.0.0.1:8787 node test/e2e/order-flow.mjs   (needs `playwright`)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const TOKEN = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message.replace(/\s+/g, ' ').slice(0, 300)]); try { await (globalThis.__p && globalThis.__p.screenshot({ path: '/tmp/e2e-fail.png', fullPage: true })); } catch (_) {} throw e; } };

const browser = await chromium.launch();

async function newPage(taken) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const state = { taken, serverTaken: new Set(), orders: [], errors: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  page.on('request', r => { if (/challenges\.cloudflare\.com|checkout\.razorpay|js\.stripe|\/api\/pay\//.test(r.url())) state.payCalls = (state.payCalls || 0) + 1; });
  await page.route('**/rest/v1/public_cards**', route => {
    const slug = decodeURIComponent((route.request().url().match(/slug=eq\.([^&]+)/) || [])[1] || '');
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.taken.has(slug) ? [{ slug }] : []) });
  });
  await page.route('**/rest/v1/rpc/slug_available', route => {
    const slug = JSON.parse(route.request().postData() || '{}').p_slug || '';
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug, available: !state.taken.has(slug) }) });
  });
  // The order goes to the database directly (proxy mode) or through the Worker's /api/order (native mode,
  // body { ts, body: { payload } }); both are answered the same way here.
  const placeOrder = route => {
    const sent = JSON.parse(route.request().postData() || '{}'), payload = sent.payload || (sent.body && sent.body.payload) || {};
    // The database refuses a claimed name someone else got first (supabase/live/partners.sql).
    if (payload.strict_slug === 'true' && state.serverTaken.has(payload.card.slug)) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'link taken' }) });
    state.orders.push(payload);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug: payload.card.slug, order_no: 'LC-E2E001', public_id: 'nbr_e2e001', edit_token: TOKEN, pay_status: 'paid', total: payload.total }) });
  };
  await page.route('**/rest/v1/rpc/place_order', placeOrder);
  await page.route('**/api/order', placeOrder);
  await page.route(/fonts\.(googleapis|gstatic)\.com|challenges\.cloudflare\.com/, r => r.abort());
  return { page, state, ctx };
}

// Any visible element painted green (the brand has no green in the order flow).
const greens = page => page.evaluate(() => {
  const out = [];
  const isGreen = c => { const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/); if (!m || (m[4] !== undefined && +m[4] < 0.2)) return false; const [r, g, b] = [+m[1], +m[2], +m[3]]; return g > r + 18 && g > b + 8; };
  for (const el of document.querySelectorAll('[data-screen-label="Order Card"] *, .lcd *, .lcl *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (el.closest('iframe, .lcs, .lcr')) continue; // the card preview's own design colours are not the brand
    const cs = getComputedStyle(el);
    for (const p of ['backgroundColor', 'color', 'borderTopColor']) if (isGreen(cs[p]) && !(p === 'borderTopColor' && cs.borderTopWidth === '0px')) out.push(el.tagName + ' ' + p + ' ' + cs[p] + ' "' + (el.textContent || '').trim().slice(0, 30) + '"');
  }
  return out.slice(0, 5);
});
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const linkStatus = page => page.locator('#o-handle-status').innerText();

let main;
try {
  main = await newPage(new Set(['ryan', 'ryancollins-card']));
  const { page, state } = main; globalThis.__p = page;

  await step('home: claim checks the name and carries it to /create', async () => {
    await page.goto(BASE + '/');
    await page.fill('[data-check]', 'ryancollins');
    await page.waitForFunction(() => /is available/.test(document.querySelector('#hero-status').textContent), null, { timeout: 5000 });
    await page.locator('form[data-claim]').first().locator('button[type=submit]').click();
    await page.waitForURL(/\/create\?.*h=ryancollins/);
    await page.waitForSelector('.lc-cta', { timeout: 15000 });
  });

  await step('plan: no green, terracotta Continue, no horizontal scroll', async () => {
    await page.waitForSelector('text=Choose a plan');
    assert.deepEqual(await greens(page), []);
    const bg = await page.locator('.lc-cta').evaluate(b => getComputedStyle(b).backgroundImage);
    assert.match(bg, /linear-gradient/);
    assert.ok(await noOverflow(page));
    await page.locator('.lc-cta').click();
  });

  await step('your card: link prefilled from the home page and available', async () => {
    await page.getByRole('option', { name: /Corporate & Consultants/ }).first().click();
    await page.waitForSelector('#o-handle');
    assert.equal(await page.inputValue('#o-handle'), 'ryancollins');
    await page.waitForSelector('text=You picked this on our home page');
    await page.waitForFunction(() => /ryancollins is available/.test(document.querySelector('#o-handle-status').textContent), null, { timeout: 5000 });
    await page.fill('#o-firstName', 'Ryan'); await page.fill('#o-lastName', 'Collins');
    await page.fill('#o-title', 'Brand Strategist'); await page.fill('#o-phone', '(312) 555-0156'); await page.fill('#o-email', 'ryan@example.com');
    assert.equal(await page.inputValue('#o-handle'), 'ryancollins', 'typing the name does not overwrite the claimed link');
  });

  await step('your card: a taken name shows free alternatives and blocks Continue', async () => {
    await page.fill('#o-handle', 'ryan');
    await page.waitForFunction(() => /is taken/.test(document.querySelector('#o-handle-status').textContent), null, { timeout: 5000 });
    const alts = await page.locator('.lcl__alt').allInnerTexts();
    assert.ok(alts.length >= 2, 'alternatives: ' + alts);
    assert.ok(!alts.includes('ryancollins-card'), 'a taken alternative is not offered');
    await page.locator('.lc-cta').click();
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'o-handle', 'Continue focuses the link field');
    assert.equal(await page.locator('#o-handle').getAttribute('aria-invalid'), 'true');
    await page.locator('.lcl__alt').first().click();
    await page.waitForFunction(() => /is available/.test(document.querySelector('#o-handle-status').textContent), null, { timeout: 5000 });
  });

  await step('your card: rules for short, reserved and odd names', async () => {
    for (const [v, re] of [['ab', /at least 3/], ['admin', /reserved/], ['-ryan', /letters, numbers and dashes/]]) {
      await page.fill('#o-handle', v);
      await page.waitForFunction(r => new RegExp(r, 'i').test(document.querySelector('#o-handle-status').textContent), re.source, { timeout: 3000 });
    }
    await page.fill('#o-handle', 'Ryan Collins!');
    assert.equal(await page.inputValue('#o-handle'), 'ryan-collins', 'input is cleaned as you type');
    assert.deepEqual(await greens(page), []);
    assert.ok(await noOverflow(page));
    // Tapping Continue while the check is still running carries on once the name is confirmed.
    await page.fill('#o-handle', 'ryancollins');
    await page.locator('.lc-cta').click();
  });

  await step('preview → payment: summary shows the claimed link, no green', async () => {
    await page.locator('.lcs-next').click({ timeout: 15000 });
    await page.waitForSelector('text=Complete your card');
    await page.waitForSelector('text=1 year · linkcardly.com/ryancollins');
    await page.waitForSelector('text=Payments are off while we test');
    assert.match(await page.locator('.lc-cta').innerText(), /Place order · no payment/);
    assert.deepEqual(await greens(page), []);
    assert.ok(await noOverflow(page));
  });

  await step('order: placed with the claimed name, done screen uses it', async () => {
    await page.locator('.lc-cta').click();
    await page.waitForSelector('.lcd', { timeout: 15000 });
    assert.equal(state.orders.length, 1);
    assert.equal(state.orders[0].card.slug, 'ryancollins');
    assert.equal(state.orders[0].strict_slug, 'true', 'the order asks for exactly this name');
    assert.equal(await page.locator('.lcd__title').innerText(), 'Your card is ready!');
    assert.equal(await page.locator('.lcd__url').innerText(), 'linkcardly.com/ryancollins');
    assert.match(await page.locator('.lcd__act').first().getAttribute('href'), /^(\/|\/app\/card\.html\?c=)ryancollins$/);
    assert.equal(await page.locator('.lcd__qr svg').count(), 1);
    assert.equal(await page.locator('.lcd__no').innerText(), 'LC-E2E001');
    assert.equal(state.payCalls || 0, 0, 'test mode: no Turnstile, Stripe, Razorpay or /api/pay calls');
  });

  await step('done: QR, link and three actions are on the first screen', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.locator('.lcd__acts').boundingBox();
    assert.ok(box.y + box.height <= 844, 'actions end at ' + Math.round(box.y + box.height) + 'px');
  });

  await step('done: copy link, edit link and order number', async () => {
    await page.locator('.lcd__act--main').click();
    await page.waitForSelector('.lcd__act--main >> text=Copied ✓');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://linkcardly.com/ryancollins');
    assert.match(await page.locator('.lcd__edit-url').innerText(), /^linkcardly\.com\/e\/ab12cd…ab12$/);
    assert.equal(await page.locator('.lcd__dark').getAttribute('href'), 'https://linkcardly.com/e/' + TOKEN);
    await page.locator('.lcd__edit .lcd__pill').click();
    await page.waitForSelector('.lcd__edit >> text=Copied ✓');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://linkcardly.com/e/' + TOKEN);
    await page.locator('.lcd__order .lcd__pill').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'LC-E2E001');
    assert.match(await page.locator('.lcd__change').getAttribute('href'), /^mailto:|^https:\/\/wa\.me\//);
    assert.deepEqual(await greens(page), []);
    assert.ok(await noOverflow(page));
  });

  await step('done: Download QR saves an SVG named after the link', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.lcd__act', { hasText: 'Download QR' }).click()]);
    assert.equal(dl.suggestedFilename(), 'ryancollins-qr.svg');
  });

  await step('done: Order another card starts fresh', async () => {
    await page.locator('.lcd__glass').click();
    await page.waitForSelector('text=Choose a plan');
  });

  await step('no page errors', async () => { assert.deepEqual(state.errors, []); });
  await main.ctx.close();

  // Someone takes the name between the check and the order.
  const race = await newPage(new Set());
  await step('race: name taken while ordering sends the customer back to pick another', async () => {
    const p = race.page; globalThis.__p = p;
    await p.goto(BASE + '/create?h=janedoe&plan=basic');
    await p.getByRole('option', { name: /Corporate & Consultants/ }).first().click();
    await p.fill('#o-firstName', 'Jane'); await p.fill('#o-title', 'Founder'); await p.fill('#o-phone', '(312) 555-0199'); await p.fill('#o-email', 'jane@example.com');
    await p.waitForFunction(() => /janedoe is available/.test(document.querySelector('#o-handle-status').textContent), null, { timeout: 5000 });
    await p.locator('.lc-cta').click();
    await p.locator('.lcs-next').click({ timeout: 15000 });
    await p.waitForSelector('text=Complete your card');
    race.state.taken.add('janedoe');
    await p.locator('.lc-cta').click();
    await p.waitForFunction(() => /janedoe is taken/.test((document.querySelector('#o-handle-status') || {}).textContent || ''), null, { timeout: 8000 });
    assert.equal(race.state.orders.length, 0, 'no order was sent');
    assert.ok((await p.locator('.lcl__alt').count()) >= 1);
    await p.locator('.lcl__alt').first().click();
    const pick = await p.inputValue('#o-handle');
    await p.locator('.lc-cta').click();
    await p.locator('.lcs-next').click({ timeout: 15000 });
    await p.locator('.lc-cta').click();
    await p.waitForSelector('.lcd', { timeout: 15000 });
    assert.equal(race.state.orders[0].card.slug, pick);
    assert.equal(await p.locator('.lcd__url').innerText(), 'linkcardly.com/' + pick);
    assert.deepEqual(race.state.errors, []);
  });
  await race.ctx.close();

  // The browser check said free, but the database had it (e.g. an order seconds earlier): "link taken".
  const race2 = await newPage(new Set());
  await step('race: database says the link was taken → back to pick another, then the order goes through', async () => {
    const p = race2.page; globalThis.__p = p;
    await p.goto(BASE + '/create?h=samlee&plan=basic');
    await p.getByRole('option', { name: /Corporate & Consultants/ }).first().click();
    await p.fill('#o-firstName', 'Sam'); await p.fill('#o-lastName', 'Lee'); await p.fill('#o-title', 'Founder'); await p.fill('#o-phone', '(312) 555-0177'); await p.fill('#o-email', 'sam@example.com');
    await p.waitForFunction(() => /samlee is available/.test(document.querySelector('#o-handle-status').textContent), null, { timeout: 5000 });
    await p.locator('.lc-cta').click();
    await p.locator('.lcs-next').click({ timeout: 15000 });
    await p.waitForSelector('text=Complete your card');
    race2.state.serverTaken.add('samlee');
    await p.locator('.lc-cta').click();
    await p.waitForFunction(() => /samlee is taken/.test((document.querySelector('#o-handle-status') || {}).textContent || ''), null, { timeout: 8000 });
    assert.equal(race2.state.orders.length, 0);
    await p.locator('.lcl__alt').first().click();
    const pick = await p.inputValue('#o-handle');
    await p.locator('.lc-cta').click();
    await p.locator('.lcs-next').click({ timeout: 15000 });
    await p.locator('.lc-cta').click();
    await p.waitForSelector('.lcd', { timeout: 15000 });
    assert.equal(race2.state.orders[0].card.slug, pick);
    assert.deepEqual(race2.state.errors, []);
  });
  await race2.ctx.close();

  // Saved edit and still-unpaid states.
  const misc = await newPage(new Set());
  await step('saved edit: "Changes saved", Keep editing, no edit or order sections', async () => {
    const p = misc.page;
    await p.goto(BASE + '/app/order.html?demoDone=paid&qa=1');
    await p.waitForSelector('.lcd');
    await p.evaluate(() => window.__nbrOrder.setState(s => ({ done: { ...s.done, edit: true } })));
    await p.waitForSelector('text=Changes saved');
    assert.equal(await p.locator('.lcd__edit').count(), 0);
    assert.equal(await p.locator('.lcd__order').count(), 0);
    assert.equal(await p.locator('.lcd__glass').innerText(), 'Keep editing');
  });
  await step('unpaid: keeps the pay screen, not the celebration', async () => {
    const p = misc.page;
    await p.goto(BASE + '/app/order.html?demoDone=unpaid');
    await p.waitForSelector('text=Complete your payment');
    assert.equal(await p.locator('.lcd').count(), 0);
  });
  await misc.ctx.close();
} catch (e) { /* recorded by step() */ }

await browser.close();
for (const r of results) console.log(r[0].padEnd(4), r[1], r[2] ? '— ' + r[2] : '');
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
