// Production E2E suite: the whole customer lifecycle in a real browser at 390 × 844, plus authorization (customers
// A and B), server-side activation, robustness and security checks. Writes a report (Passed / Failed / Blocked /
// Not tested, findings, screenshots of failures) to test/e2e/report/.
//
// LOCAL (default): the Worker from `npm run dev`, and the browser's Supabase traffic served by the real database SQL
// (supabase/live/*.sql in PGlite, test/support/postgrest.mjs). Nothing in the app is mocked; tests that simulate a
// failure (offline, 500, slow network) say so. Test mode is on, so a placed order is marked paid by the database
// (provider 'test'), the same as production with test mode on.
//   BASE=http://127.0.0.1:8787 node test/e2e/production.mjs
// STAGING: a deployed Worker and a real Supabase project (one that is NOT production, with test mode on). Checks that
// need direct database access are reported as Blocked.
//   STAGING=1 BASE=https://staging.example.workers.dev node test/e2e/production.mjs
//
// Payments are not integrated yet (PAYMENTS_ON = false), so every payment and webhook scenario is listed as
// Not tested. Add them here when payments are switched on (docs/ARCHITECTURE.md, "Known debt").
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createLiveDb } from '../support/live-db.mjs';
import { createPostgrest } from '../support/postgrest.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const STAGING = !!process.env.STAGING;
const OUT = new URL('./report/', import.meta.url);
const VIEW = { width: 390, height: 844 };
const orderHtml = await readFile(new URL('../../public/app/order.html', import.meta.url), 'utf8');
const SUPABASE_URL = orderHtml.match(/const SUPABASE_URL = '([^']+)'/)[1];
const SUPABASE_KEY = orderHtml.match(/const SUPABASE_KEY = '([^']+)'/)[1];
const RUN = Date.now().toString(36).slice(-5); // keeps names unique when run against a shared staging database

// ---------- results ----------
const results = [];
const findings = [];
class Blocked extends Error {}
class NotTested extends Error {}
let shotNo = 0, lastPage = null; // lastPage: the newest customer's page, for failure screenshots
async function check(area, name, fn, { page, needs } = {}) {
  const missing = (needs || []).filter(n => !n());
  if (missing.length) { results.push({ area, name, status: 'BLOCKED', note: 'an earlier step it depends on failed' }); return false; }
  try {
    const note = await fn();
    results.push({ area, name, status: 'PASS', note: typeof note === 'string' ? note : '' });
    return true;
  } catch (e) {
    if (e instanceof Blocked) { results.push({ area, name, status: 'BLOCKED', note: e.message }); return false; }
    if (e instanceof NotTested) { results.push({ area, name, status: 'NOT TESTED', note: e.message }); return false; }
    let shot = '';
    const pg = (typeof page === 'function' ? page() : page) || lastPage;
    if (pg) { try { shot = `fail-${++shotNo}.png`; await pg.screenshot({ path: new URL(shot, OUT).pathname, fullPage: true }); } catch (_) { shot = ''; } }
    results.push({ area, name, status: 'FAIL', note: String(e.message || e).replace(/\s+/g, ' ').slice(0, 400), shot });
    return false;
  }
}
const notTested = (area, name, why) => results.push({ area, name, status: 'NOT TESTED', note: why });
const finding = (severity, area, text) => findings.push({ severity, area, text });

// ---------- backend ----------
let db = null, api = null;
if (!STAGING) { db = await createLiveDb(); await db.exec(`insert into public.app_flags (key) values ('test_mode')`); api = createPostgrest(db); }
const needDb = () => { if (!db) throw new Blocked('needs direct database access (local run only)'); return db; };
const sql = async (q, p) => (await needDb().query(q, p)).rows;
const testMode = on => sql(on ? `insert into public.app_flags (key) values ('test_mode') on conflict do nothing` : `delete from public.app_flags where key = 'test_mode'`);
const resetLimits = () => db && db.query('delete from public.rate_hits');

// Calls the Supabase API the way an attacker with the public key would (no browser, no app).
async function rest(method, path, body, ip = '198.51.100.7', extra = {}) {
  const url = SUPABASE_URL + '/rest/v1/' + path, headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...extra };
  if (api) { const r = await api.handle({ method, url, headers: { ...headers, 'x-forwarded-for': ip }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: r.body }; }
  const r = await fetch(url, { method, headers: { ...headers, Authorization: 'Bearer ' + SUPABASE_KEY }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) { j = t; }
  return { status: r.status, body: j };
}
const rpc = (fn, args, ip, extra) => rest('POST', 'rpc/' + fn, args, ip, extra);
const orderPayload = (slug, over = {}) => ({ mode: 'builder', plan: 'basic', region: 'US', customer_name: 'Test Person', customer_email: `${slug}@example.com`, customer_phone: '3125550100', strict_slug: 'true',
  card: { slug, first_name: 'Test', last_name: 'Person', phone: '+13125550100', email: `${slug}@example.com` }, ...over });

// ---------- browser ----------
const browser = await chromium.launch();
const browserVersion = browser.version();
const contexts = [];
async function customer(ip, opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEW, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...opts });
  contexts.push(ctx);
  const errors = [], offsite = [];
  ctx.on('page', p => watch(p));
  const watch = p => {
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && u.origin !== new URL(BASE).origin && !r.url().startsWith(SUPABASE_URL)) offsite.push({ url: r.url(), referer: r.headers().referer || '' }); });
  };
  if (api) await ctx.route(SUPABASE_URL + '/rest/v1/**', async route => {
    const r = route.request();
    const res = await api.handle({ method: r.method(), url: r.url(), headers: { ...r.headers(), 'x-forwarded-for': ip }, body: r.postData() });
    await route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: res.body == null ? '' : JSON.stringify(res.body) });
  });
  // Third-party fonts and the payment/bot-check scripts are not part of these tests (recorded in `offsite`).
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|challenges\.cloudflare\.com|checkout\.razorpay\.com|js\.stripe\.com/, r => r.abort());
  const page = await ctx.newPage();
  lastPage = page;
  return { ctx, page, errors, offsite, ip };
}

let photo = null;
async function photoFile(page) {
  if (!photo) photo = Buffer.from(await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 480; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 480, 480); g.addColorStop(0, '#c8552d'); g.addColorStop(1, '#201e1d'); x.fillStyle = g; x.fillRect(0, 0, 480, 480);
    for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${i * 7},55%,${30 + i % 40}%)`; x.fillRect((i * 37) % 480, (i * 91) % 480, 11, 11); }
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }), 'base64');
  return { name: 'portrait.jpg', mimeType: 'image/jpeg', buffer: photo };
}

// Your card step: profession, photo, details. Fields that this profession doesn't show are skipped.
async function fillCard(page, d) {
  await page.getByRole('option', { name: /Corporate & Consultants/ }).first().click();
  await page.waitForSelector('#o-firstName');
  if (d.photo) await page.setInputFiles('input[type=file]', await photoFile(page));
  for (const k of ['firstName', 'lastName', 'title', 'company', 'phone', 'whatsapp', 'email', 'website', 'linkedin'])
    if (d[k] != null && await page.locator('#o-' + k).count()) await page.fill('#o-' + k, d[k]);
}
const statusText = page => page.locator('#o-handle-status').innerText();
const waitAvailable = (page, h) => page.waitForFunction(h => new RegExp(h + ' is available').test(document.querySelector('#o-handle-status').textContent), h, { timeout: 8000 });
async function toPayment(page) {
  await page.locator('.lc-cta').click();
  await page.locator('.lcs-next').click({ timeout: 15000 });
  await page.waitForSelector('text=Complete your card', { timeout: 10000 });
}
async function orderViaUrl(c, d) {
  await c.page.goto(`${BASE}/create?h=${d.handle}&plan=basic&region=${d.region || 'US'}`);
  await fillCard(c.page, d);
  await waitAvailable(c.page, d.handle);
  await toPayment(c.page);
}
const previewFrame = async page => { for (let i = 0; i < 40; i++) { const f = page.frames().find(f => /\/app\/card(\.html)?\?preview=1/.test(f.url())); if (f) return f; await page.waitForTimeout(250); } throw new Error('preview frame not found'); };
const orderCount = async email => Number((await sql(`select count(*)::int n from orders where customer_email = $1`, [email]))[0].n);
// Save contact: the card shows a short "Save to Contacts" guide first (on every device: iosGuide is "Always"),
// whose "Open contact" button downloads the vCard.
async function saveContact(page, where = page) {
  await where.getByRole('button', { name: /save contact/i }).first().click();
  const open = where.locator('[role=dialog] button', { hasText: /open contact/i });
  try { await open.waitFor({ timeout: 2500 }); } catch (_) { return null; }
  return open;
}
const vcardFrom = async (page, where = page) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), (async () => { const btn = await saveContact(page, where); if (btn) await btn.click(); })()]);
  return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), 'utf8') };
};

// ---------- state shared between steps ----------
const A = { handle: 'ryan' + RUN, firstName: 'Ryan', lastName: 'Collins', title: 'Brand Strategist', company: 'Collins Studio', phone: '(312) 555-0156', whatsapp: '+1 312 555 0156', email: `ryan.${RUN}@example.com`, website: 'https://ryan.example.com', linkedin: 'ryancollins', photo: true };
const B = { handle: 'priya' + RUN, region: 'IN', firstName: 'Priya', lastName: 'Sharma', title: 'Property Consultant', company: 'Skyline Realty', phone: '98765 43210', email: `priya.${RUN}@example.com`, photo: false };
const ok = {};
let a, b;

await rm(OUT, { recursive: true, force: true }); await mkdir(OUT, { recursive: true });
try {
  a = await customer('203.0.113.11');
  const pa = () => a.page;

  // ======================= 1. Customer lifecycle (customer A) =======================
  ok.home = await check('Lifecycle', 'Home: claim a name, see it is available, go to /create with it', async () => {
    await a.page.goto(BASE + '/');
    await a.page.fill('[data-check]', A.handle);
    await a.page.waitForFunction(() => /is available/.test(document.querySelector('#hero-status').textContent), null, { timeout: 8000 });
    await a.page.locator('form[data-claim]').first().locator('button[type=submit]').click();
    await a.page.waitForURL(new RegExp('/create\\?.*h=' + A.handle), { timeout: 10000 });
  }, { page: pa });

  ok.plan = await check('Lifecycle', 'Plan: choose Digital Card and continue', async () => {
    await a.page.waitForSelector('text=Choose a plan', { timeout: 15000 });
    const reg = await a.page.getByRole('radio', { name: /US|United States/i }).first();
    if (await reg.count()) await reg.click();
    await a.page.locator('.lc-cta').click();
  }, { page: pa, needs: [() => ok.home] });

  ok.card = await check('Lifecycle', 'Your card: upload photo, enter name, job, contact and social details; claimed link is kept', async () => {
    await fillCard(a.page, A);
    await a.page.waitForFunction(() => !!document.querySelector('img[src^="blob:"], [style*="blob:"]'), null, { timeout: 8000 }).catch(() => { throw new Error('uploaded photo is not shown'); });
    assert.equal(await a.page.inputValue('#o-handle'), A.handle);
    await waitAvailable(a.page, A.handle);
  }, { page: pa, needs: [() => ok.plan] });

  let frame;
  ok.preview = await check('Lifecycle', 'Continue to Preview: the live card shows the details entered', async () => {
    await a.page.locator('.lc-cta').click();
    frame = await previewFrame(a.page);
    await frame.waitForFunction(n => document.body.innerText.includes(n), 'Ryan Collins', { timeout: 10000 });
    const t = (await frame.evaluate(() => document.body.innerText)).toLowerCase();
    for (const s of [A.title, A.company]) assert.ok(t.includes(s.toLowerCase()), 'preview is missing ' + s);
  }, { page: pa, needs: [() => ok.card] });

  const pv = () => ok.preview;
  await check('Preview', 'Save contact downloads a vCard with name, job, phone, email, link', async () => {
    const v = await vcardFrom(a.page, frame);
    assert.match(v.name, /\.vcf$/);
    for (const re of [/FN:Ryan Collins/, /TITLE:Brand Strategist/, /ORG:Collins Studio/, /TEL;[^:]*:\+13125550156/, /EMAIL;[^:]*:ryan\./, new RegExp('URL:' + BASE.replace(/[.]/g, '\\.') + '/' + A.handle + '\\r?\\n')])
      assert.match(v.text, re);
    if (!/PHOTO;/.test(v.text)) finding('Low', 'Preview', 'The vCard saved from the preview has no photo (the photo is attached on the live card once it is stored).');
  }, { page: pa, needs: [pv] });
  await check('Preview', 'Call, WhatsApp, Email and social links point to the right places', async () => {
    const hrefs = await frame.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => ({ h: a.getAttribute('href'), t: a.getAttribute('target'), r: a.getAttribute('rel') || '' })));
    const has = re => assert.ok(hrefs.some(x => re.test(x.h)), 'no link matching ' + re);
    has(/^tel:\+13125550156$/); has(/^https:\/\/wa\.me\/13125550156/); has(/^mailto:ryan\./); has(/linkedin\.com\/in\/ryancollins/); has(/^https:\/\/ryan\.example\.com/);
    const unsafe = hrefs.filter(x => x.t === '_blank' && !/noopener|noreferrer/.test(x.r));
    assert.deepEqual(unsafe, [], 'new-tab links without rel=noopener');
  }, { page: pa, needs: [pv] });
  await check('Preview', 'Share copies the card link (no system share sheet on desktop)', async () => {
    await frame.getByRole('button', { name: /share/i }).first().click();
    await a.page.waitForTimeout(400);
    assert.equal(await a.page.evaluate(() => navigator.clipboard.readText()), BASE + '/' + A.handle, 'the preview shares the link the card will have');
  }, { page: pa, needs: [pv] });
  await check('Preview', 'QR opens with the card QR code and closes with Escape', async () => {
    await frame.getByRole('button', { name: /qr/i }).first().click();
    await frame.waitForSelector('[role=dialog] svg path, [aria-modal=true] svg path', { timeout: 5000 });
    await a.page.keyboard.press('Escape');
    await frame.waitForFunction(() => !document.querySelector('[role=dialog] svg path, [aria-modal=true] svg path'), null, { timeout: 3000 });
  }, { page: pa, needs: [pv] });

  ok.pay = await check('Lifecycle', 'Continue to checkout: payments-off placeholder, no payment or bot-check scripts', async () => {
    await a.page.locator('.lcs-next').click({ timeout: 15000 });
    await a.page.waitForSelector('text=Complete your card');
    await a.page.waitForSelector('text=Payments are off while we test');
    assert.match(await a.page.locator('.lc-cta').innerText(), /Place order · no payment/);
    assert.deepEqual(a.offsite.filter(x => /razorpay|stripe|challenges\.cloudflare/.test(x.url)), []);
  }, { page: pa, needs: [pv] });

  ok.done = await check('Lifecycle', 'Place order: confirmation shows the link, QR, edit link and order number', async () => {
    await a.page.locator('.lc-cta').click();
    await a.page.waitForSelector('.lcd', { timeout: 15000 });
    assert.equal(await a.page.locator('.lcd__url').innerText(), 'linkcardly.com/' + A.handle);
    assert.equal(await a.page.locator('.lcd__qr svg').count(), 1);
    A.edit = await a.page.locator('.lcd__dark').getAttribute('href');
    A.token = (A.edit.match(/\/e\/([a-f0-9]{40})$/) || [])[1];
    assert.ok(A.token, 'edit link: ' + A.edit);
    A.orderNo = await a.page.locator('.lcd__no').innerText();
    if (/^NBR-/.test(A.orderNo)) finding('Low', 'Lifecycle', `Order numbers still use the old NexBizRise prefix (${A.orderNo}). Customers see "NBR-" on the confirmation and in support.`);
  }, { page: pa, needs: [() => ok.pay] });

  ok.paid = await check('Server-side state', 'Order is PAID (test mode) and the card is ACTIVE, decided by the database', async () => {
    const r = await sql(`select o.pay_status, o.pay_provider, o.total::float total, o.currency, c.active, c.public_id, c.photo_url from orders o join cards c on c.id = o.card_id where o.order_no = $1`, [A.orderNo]);
    assert.equal(r.length, 1);
    assert.equal(r[0].pay_status, 'paid'); assert.equal(r[0].pay_provider, 'test'); assert.equal(r[0].active, true);
    assert.equal(r[0].currency, 'USD'); assert.equal(r[0].total, 49, 'price comes from the server');
    A.pid = r[0].public_id;
    if (!r[0].photo_url) finding('High', 'Lifecycle', 'The photo the customer uploaded is not on the card. Locally this is expected: photos are stored through /api/upload on the deployed Worker, and the database only accepts photo links from its own storage. In production the same upload goes through the proxy to the old NexBizRise worker, whose origin check was parked in the audit, so an order with a photo may fail there ("Your photo could not be uploaded"). Must be checked on staging before launch.');
    return `order ${A.orderNo}, ${r[0].currency} ${r[0].total}, provider ${r[0].pay_provider}`;
  }, { needs: [() => ok.done] });
  await check('Server-side state', 'Exactly one order was created for the customer', async () => { assert.equal(await orderCount(A.email), 1); }, { needs: [() => ok.done] });

  // ======================= 2. Public card =======================
  ok.pub = await check('Public card', 'Public URL works: name, job and company on linkcardly.com/<name>', async () => {
    const res = await a.page.goto(`${BASE}/${A.handle}`);
    assert.equal(res.status(), 200);
    await a.page.waitForFunction(() => document.body.innerText.includes('Ryan Collins'), null, { timeout: 10000 });
    const t = (await a.page.evaluate(() => document.body.innerText)).toLowerCase();
    assert.ok(t.includes(A.title.toLowerCase()) && t.includes(A.company.toLowerCase()));
  }, { page: pa, needs: [() => ok.done] });
  await check('Public card', 'Save contact, Call, WhatsApp, Email, social links', async () => {
    const v = await vcardFrom(a.page);
    assert.match(v.text, /FN:Ryan Collins/); assert.match(v.text, /TEL;[^:]*:\+13125550156/);
    assert.match(v.text, new RegExp('URL:' + BASE.replace(/[.]/g, '\\.') + '/' + A.handle + '\\r?\\n'), 'the saved contact links to the claimed name');
    const hrefs = await a.page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
    for (const re of [/^tel:\+13125550156$/, /^https:\/\/wa\.me\/13125550156/, /^mailto:ryan\./, /linkedin\.com\/in\/ryancollins/]) assert.ok(hrefs.some(h => re.test(h)), 'missing ' + re);
  }, { page: pa, needs: [() => ok.pub] });
  await check('Public card', 'Share on a phone opens the share sheet with the card link', async () => {
    const { defaultBrowserType, ...pixel } = devices['Pixel 7'];
    const m = await customer('203.0.113.12', pixel);
    await m.page.addInitScript(() => { window.__shared = null; navigator.share = d => { window.__shared = d; return Promise.resolve(); }; });
    await m.page.goto(`${BASE}/${A.handle}`);
    await m.page.getByRole('button', { name: /share/i }).first().click();
    await m.page.waitForFunction(() => !!window.__shared, null, { timeout: 5000 });
    assert.equal((await m.page.evaluate(() => window.__shared)).url, BASE + '/' + A.handle, 'the shared link is the claimed name');
    await m.page.getByRole('button', { name: /save contact/i }).first().click();
    const guide = await m.page.locator('[role=dialog]').innerText({ timeout: 2500 }).catch(() => '');
    if (/iphone/i.test(guide)) finding('Medium', 'Public card', 'On Android, Save contact opens the "Save to Contacts · Two taps on iPhone" guide (steps for iPhone). card.html sets iosGuide to "Always"; "iPhone only" would let Android save in one tap.');
    await m.ctx.close();
  }, { needs: [() => ok.pub] });
  await check('Public card', 'iPhone: Save contact explains the steps, then saves the vCard', async () => {
    const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
    const m = await customer('203.0.113.13', iphone);
    await m.page.goto(`${BASE}/${A.handle}`);
    const v = await vcardFrom(m.page);
    assert.match(v.text, /FN:Ryan Collins/);
    await m.ctx.close();
  }, { needs: [() => ok.pub] });
  await check('Public card', 'QR code opens on the live card', async () => {
    await a.page.getByRole('button', { name: /qr/i }).first().click();
    await a.page.waitForSelector('[role=dialog] svg path, [aria-modal=true] svg path', { timeout: 5000 });
    await a.page.keyboard.press('Escape');
  }, { page: pa, needs: [() => ok.pub] });
  await check('Public card', 'Refresh, back/forward and the short link /c/<id> all show the card', async () => {
    await a.page.reload(); await a.page.waitForFunction(() => document.body.innerText.includes('Ryan Collins'), null, { timeout: 10000 });
    await a.page.goto(BASE + '/'); await a.page.goBack(); await a.page.waitForFunction(() => document.body.innerText.includes('Ryan Collins'), null, { timeout: 10000 });
    await a.page.goForward(); await a.page.waitForURL(BASE + '/');
    if (!A.pid) throw new Blocked('public id unknown');
    const res = await a.page.goto(`${BASE}/c/${A.pid}`);
    assert.equal(res.status(), 200);
    await a.page.waitForFunction(() => document.body.innerText.includes('Ryan Collins'), null, { timeout: 10000 });
  }, { page: pa, needs: [() => ok.pub] });
  await check('Public card', 'A name nobody owns shows "not found", not a blank page', async () => {
    await a.page.goto(`${BASE}/nobody${RUN}x`);
    await a.page.waitForFunction(() => /not found|doesn.t exist|no card|isn.t live/i.test(document.body.innerText), null, { timeout: 10000 });
  }, { page: pa });

  // ======================= 3. Edit link =======================
  ok.edit = await check('Edit link', 'Private edit link opens the card with its details filled in', async () => {
    if (!A.token) throw new Blocked('no edit token');
    await a.page.goto(`${BASE}/e/${A.token}`);
    await a.page.waitForFunction(() => { const i = document.querySelector('#o-firstName'); return i && i.value === 'Ryan'; }, null, { timeout: 15000 }).catch(async () => {
      // The edit page may open on an earlier step; go to the details step.
      const opt = a.page.getByRole('option', { name: /Corporate & Consultants/ }).first();
      if (await opt.count()) await opt.click();
      await a.page.waitForFunction(() => { const i = document.querySelector('#o-firstName'); return i && i.value === 'Ryan'; }, null, { timeout: 8000 });
    });
    assert.equal(await a.page.inputValue('#o-email'), A.email);
  }, { page: pa, needs: [() => ok.done] });
  ok.saved = await check('Edit link', 'Change the job title, save: "Changes saved" and the public card shows it', async () => {
    await a.page.fill('#o-title', 'Head of Brand');
    await a.page.locator('.lc-cta').click();           // to the preview
    await a.page.locator('.lcs-next').click({ timeout: 15000 }); // the tick saves
    await a.page.waitForSelector('text=Changes saved', { timeout: 10000 });
    await a.page.goto(`${BASE}/${A.handle}`);
    await a.page.waitForFunction(() => document.body.innerText.includes('Head of Brand'), null, { timeout: 10000 });
  }, { page: pa, needs: [() => ok.edit] });
  await check('Edit link', 'Changing the photo from the edit link', async () => {
    if (!STAGING) throw new Blocked('photo storage needs /api/upload on the deployed Worker (staging run)');
  });
  await check('Edit link', 'The edit token is not sent to other websites (Referer)', async () => {
    const leaks = a.offsite.filter(x => A.token && (x.referer.includes(A.token) || x.url.includes(A.token)));
    assert.deepEqual(leaks.map(x => x.url), []);
    return `${a.offsite.length} third-party requests checked`;
  }, { needs: [() => ok.edit] });

  // ======================= 4. Authorization (customer B vs customer A) =======================
  b = await customer('203.0.113.21');
  const pb = () => b.page;
  ok.b = await check('Authorization', 'Customer B (India, ₹) orders a card through the same flow', async () => {
    await orderViaUrl(b, B);
    await b.page.locator('.lc-cta').click();
    await b.page.waitForSelector('.lcd', { timeout: 15000 });
    B.token = ((await b.page.locator('.lcd__dark').getAttribute('href')).match(/\/e\/([a-f0-9]{40})$/) || [])[1];
    B.orderNo = await b.page.locator('.lcd__no').innerText();
    assert.ok(B.token);
    if (db) { const r = await sql(`select total::float total, currency from orders where order_no = $1`, [B.orderNo]); assert.equal(r[0].currency, 'INR'); return `₹${r[0].total} charged by the server`; }
  }, { page: pb });

  await check('Authorization', 'B cannot open A\'s card for editing with a guessed or altered edit link', async () => {
    if (!A.token) throw new Blocked('no edit token for A');
    const bad = A.token.slice(0, -1) + (A.token.endsWith('0') ? '1' : '0');
    await b.page.goto(`${BASE}/e/${bad}`);
    await b.page.waitForFunction(() => /no longer valid|isn.t valid|invalid|not valid|can.t find/i.test(document.body.innerText), null, { timeout: 10000 });
    const html = await b.page.content();
    assert.ok(!html.includes(A.email) && !html.includes('Collins Studio'), 'A\'s details appear on the page');
    const r = await rpc('get_card_for_edit', { p_token: bad }, b.ip);
    assert.ok(r.status >= 400, 'API answered ' + r.status);
  }, { page: pb, needs: [() => ok.b] });
  await check('Authorization', 'Public id, card name or order number are not accepted in place of the edit token', async () => {
    for (const t of [A.pid, A.handle, A.orderNo, ''].filter(x => x != null)) {
      const r = await rpc('get_card_for_edit', { p_token: t }, b.ip);
      assert.ok(r.status >= 400 && !JSON.stringify(r.body).includes(A.email), `token "${t}" → ${r.status}`);
    }
  }, { needs: [() => ok.done] });
  await check('Authorization', 'B\'s edit token cannot change A\'s card (even naming A\'s link in the request)', async () => {
    if (!B.token) throw new Blocked('no edit token for B');
    const r = await rpc('update_card_by_token', { p_token: B.token, p_card: { slug: A.handle, public_id: A.pid, first_name: 'Hacked', phone: '+919876543210', title: 'Hacked' } }, b.ip);
    const card = await rest('GET', `public_cards?select=*&slug=eq.${A.handle}`, undefined, b.ip);
    assert.ok(Array.isArray(card.body) && card.body[0], 'A\'s card disappeared');
    assert.notEqual(card.body[0].first_name, 'Hacked', 'A\'s card was changed');
    const mine = await rest('GET', `public_cards?select=slug,first_name&slug=eq.${B.handle}`, undefined, b.ip);
    if (r.status < 400) assert.equal(mine.body[0] && mine.body[0].slug, B.handle, 'B\'s card moved to another link');
  }, { needs: [() => ok.b, () => ok.done] });
  await check('Authorization', 'With the public key, private tables return nothing (orders, cards, leads, coupons, secrets, admins, limits)', async () => {
    const open = [];
    for (const t of ['orders', 'cards', 'leads', 'site_leads', 'coupons', 'coupon_redemptions', 'app_secrets', 'admins', 'app_flags', 'rate_hits', 'admin_log']) {
      const r = await rest('GET', `${t}?select=*&limit=5`, undefined, b.ip);
      if (r.status === 200 && Array.isArray(r.body) && r.body.length) open.push(`${t} (${r.body.length} rows)`);
    }
    assert.deepEqual(open, []);
  }, { needs: [() => ok.done] });
  await check('Authorization', 'With the public key, nobody can mark an order paid or change, create or delete cards', async () => {
    const tries = [
      ['PATCH', `orders?order_no=eq.${B.orderNo}`, { pay_status: 'paid' }],
      ['PATCH', `cards?slug=eq.${A.handle}`, { first_name: 'Hacked', active: true }],
      ['POST', 'cards', { slug: 'evil' + RUN, first_name: 'Evil', active: true }],
      ['DELETE', `cards?slug=eq.${A.handle}`],
      ['PATCH', `public_cards?slug=eq.${A.handle}`, { first_name: 'Hacked' }],
      ['DELETE', `public_cards?slug=eq.${A.handle}`],
      ['POST', 'public_cards', { slug: 'evil2' + RUN, first_name: 'Evil' }],
      ['POST', 'orders', { order_no: 'X' + RUN, pay_status: 'paid' }],
    ];
    const allowed = [];
    for (const [m, p, body] of tries) { const r = await rest(m, p, body, b.ip); if (r.status < 300) allowed.push(`${m} ${p} → ${r.status}`); }
    const still = await rest('GET', `public_cards?select=first_name&slug=eq.${A.handle}`, undefined, b.ip);
    assert.ok(still.body[0] && still.body[0].first_name === 'Ryan', 'A\'s card was changed or deleted');
    if (db) assert.equal((await sql(`select pay_status from orders where order_no = $1`, [B.orderNo]))[0].pay_status, 'paid');
    assert.deepEqual(allowed, []);
  }, { needs: [() => ok.b, () => ok.done] });
  await check('Authorization', 'Public card data has no private fields (edit hash, customer email, payment, notes)', async () => {
    const r = await rest('GET', `public_cards?select=*&slug=eq.${A.handle}`, undefined, b.ip);
    const keys = Object.keys(r.body[0] || {});
    const bad = keys.filter(k => /edit|hash|token|customer|pay|order|notes|secret|ip/i.test(k));
    assert.deepEqual(bad, []);
    return keys.length + ' public columns';
  }, { needs: [() => ok.done] });
  await check('Authorization', 'The edit token is stored only as a hash', async () => {
    const r = await sql(`select edit_hash from cards where slug = $1`, [A.handle]);
    assert.ok(r[0].edit_hash && r[0].edit_hash !== A.token && !JSON.stringify(r[0]).includes(A.token));
  }, { needs: [() => ok.done] });

  // ======================= 5. Payment status is decided by the server =======================
  ok.off = await check('Server-side state', 'With test mode off, an order stays UNPAID and the card stays offline, whatever the browser sends', async () => {
    await testMode(false); await resetLimits();
    const slug = 'free' + RUN;
    const r = await rpc('place_order', { payload: orderPayload(slug, { pay_status: 'paid', paid: true, total: 0, price: 0, tax: 0, discount: 999, status: 'paid', pay_provider: 'test', card: { ...orderPayload(slug).card, active: true, plan: 'motion', renewal: '2099-01-01' } }) }, '198.51.100.30');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.pay_status, 'unpaid');
    assert.equal(Number(r.body.total), 49, 'server price, not the browser\'s');
    const pub = await rest('GET', `public_cards?select=slug&slug=eq.${slug}`);
    assert.deepEqual(pub.body, [], 'unpaid card is public');
    const row = (await sql(`select c.active, c.plan, c.renewal::date::text renewal from cards c where slug = $1`, [slug]))[0];
    assert.equal(row.active, false); assert.equal(row.plan, 'basic'); assert.notEqual(row.renewal, '2099-01-01');
    const avail = await rpc('slug_available', { p_slug: slug });
    assert.equal(avail.body.available, false, 'the unpaid order holds its name');
    A.unpaid = r.body.order_no;
  });
  await check('Server-side state', 'Nobody can mark an order paid with the public key (mark_order_paid needs the worker secret)', async () => {
    if (!A.unpaid) throw new Blocked('no unpaid order');
    const r = await rpc('mark_order_paid', { p_order_no: A.unpaid, p_provider: 'razorpay', p_ref: 'pay_fake', p_amount_minor: 4900, p_currency: 'USD' }, '198.51.100.31');
    assert.ok(r.status >= 400, 'answered ' + r.status);
    const r2 = await rpc('mark_order_paid', { p_order_no: A.unpaid, p_provider: 'razorpay', p_ref: 'pay_fake', p_amount_minor: 4900, p_currency: 'USD' }, '198.51.100.31', { 'x-nbr-secret': 'guess-guess-guess-guess-guess' });
    assert.ok(r2.status >= 400, 'with a guessed secret answered ' + r2.status);
    assert.equal((await sql(`select pay_status from orders where order_no = $1`, [A.unpaid]))[0].pay_status, 'unpaid');
  }, { needs: [() => ok.off] });
  await check('Server-side state', 'With test mode off, the order page does not celebrate an unpaid order', async () => {
    const c = await customer('203.0.113.31');
    await orderViaUrl(c, { ...B, handle: 'unpaid' + RUN, email: `unpaid.${RUN}@example.com` });
    await c.page.locator('.lc-cta').click();
    await c.page.waitForFunction(() => /couldn.t finish your order|couldn.t place your order/i.test(document.body.innerText), null, { timeout: 15000 });
    assert.equal(await c.page.locator('.lcd').count(), 0);
    await c.ctx.close();
  }, { needs: [() => ok.off] });
  await check('Server-side state', 'A made-up coupon is refused by the server', async () => {
    const r = await rpc('place_order', { payload: orderPayload('coupon' + RUN, { coupon: 'FREE100' }) }, '198.51.100.32');
    assert.ok(r.status >= 400 && /coupon/i.test(r.body.message || ''), JSON.stringify(r.body));
  });
  if (db) { await testMode(true); await resetLimits(); }

  // ======================= 6. Failures and recovery =======================
  await check('Robustness', 'Double- and triple-clicking Place order creates one order', async () => {
    const d = { ...B, handle: 'dbl' + RUN, email: `dbl.${RUN}@example.com` }, c = await customer('203.0.113.41');
    await orderViaUrl(c, d);
    const btn = c.page.locator('.lc-cta');
    await btn.dblclick(); await btn.click({ timeout: 1000 }).catch(() => {});
    await c.page.waitForSelector('.lcd', { timeout: 15000 });
    await c.page.waitForTimeout(800);
    assert.equal(await orderCount(d.email), 1);
    await c.ctx.close();
  });
  await check('Robustness', 'Response lost after the order was saved: trying again does not create a second order', async () => {
    const d = { ...B, handle: 'lost' + RUN, email: `lost.${RUN}@example.com` }, c = await customer('203.0.113.42');
    await orderViaUrl(c, d);
    let first = true;
    await c.page.route('**/rest/v1/rpc/place_order', async route => { if (!first) return route.fallback(); first = false; const r = route.request(); await api.handle({ method: 'POST', url: r.url(), headers: { ...r.headers(), 'x-forwarded-for': c.ip }, body: r.postData() }); await route.abort('connectionreset'); });
    await c.page.locator('.lc-cta').click();
    await c.page.waitForFunction(() => /couldn.t place your order/i.test(document.body.innerText), null, { timeout: 10000 });
    await c.page.locator('.lc-cta').click();
    await c.page.waitForSelector('.lcd', { timeout: 15000 });
    assert.equal(await orderCount(d.email), 1);
    await c.ctx.close();
  });
  await check('Robustness', 'Internet drops at Place order: friendly message; works once back online', async () => {
    const d = { ...B, handle: 'off' + RUN, email: `off.${RUN}@example.com` }, c = await customer('203.0.113.43');
    await orderViaUrl(c, d);
    await c.ctx.setOffline(true);
    // Requests answered by the test's own database route don't see "offline", so fail them the way the network would.
    await c.page.route('**/rest/v1/**', r => r.abort('internetdisconnected'));
    await c.page.locator('.lc-cta').click();
    await c.page.waitForFunction(() => /couldn.t place your order|connection|offline/i.test(document.body.innerText), null, { timeout: 10000 });
    await c.ctx.setOffline(false); await c.page.unroute('**/rest/v1/**');
    await c.page.locator('.lc-cta').click();
    await c.page.waitForSelector('.lcd', { timeout: 15000 });
    const styled = await c.page.locator('.lcd__qr').evaluate(e => e.getBoundingClientRect().width < 200);
    assert.ok(styled, 'the confirmation screen is unstyled');
    await c.page.waitForSelector('.lcd', { timeout: 15000 });
    assert.deepEqual(c.errors, []);
    await c.ctx.close();
  });
  await check('Robustness', 'Server error (500) at Place order: friendly message, no crash (simulated)', async () => {
    const d = { ...B, handle: 'err' + RUN, email: `err.${RUN}@example.com` }, c = await customer('203.0.113.44');
    await orderViaUrl(c, d);
    await c.page.route('**/rest/v1/rpc/place_order', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
    await c.page.locator('.lc-cta').click();
    await c.page.waitForFunction(() => /couldn.t place your order/i.test(document.body.innerText), null, { timeout: 10000 });
    assert.ok(!(await c.page.content()).includes('boom'), 'raw server message shown');
    assert.deepEqual(c.errors, []);
    await c.ctx.close();
  });
  await check('Robustness', 'Slow network (4 s): button shows it is working and extra taps do nothing', async () => {
    const d = { ...B, handle: 'slow' + RUN, email: `slow.${RUN}@example.com` }, c = await customer('203.0.113.45');
    await orderViaUrl(c, d);
    await c.page.route('**/rest/v1/rpc/place_order', async r => { await new Promise(res => setTimeout(res, 4000)); await r.fallback(); });
    await c.page.locator('.lc-cta').click();
    await c.page.waitForTimeout(600);
    const busy = await c.page.locator('.lc-cta').evaluate(b => b.disabled || b.getAttribute('aria-busy') === 'true' || /placing|working|wait|…/i.test(b.innerText));
    await c.page.locator('.lc-cta').click({ force: true, timeout: 1000 }).catch(() => {});
    await c.page.waitForSelector('.lcd', { timeout: 15000 });
    assert.equal(await orderCount(d.email), 1);
    assert.ok(busy, 'no busy state on the button while the order is being placed');
    await c.ctx.close();
  });
  await check('Robustness', 'Refreshing during checkout keeps the customer in the flow and creates no order', async () => {
    const d = { ...B, handle: 'rf' + RUN, email: `rf.${RUN}@example.com` }, c = await customer('203.0.113.46');
    await orderViaUrl(c, d);
    await c.page.reload();
    await c.page.waitForSelector('.lc-cta', { timeout: 15000 });
    const where = await c.page.evaluate(() => /Complete your card/.test(document.body.innerText) ? 'checkout' : /Choose a plan/.test(document.body.innerText) ? 'plan' : 'details');
    const kept = await c.page.locator('#o-firstName').count() ? await c.page.inputValue('#o-firstName') : '';
    assert.equal(await orderCount(d.email), 0);
    assert.deepEqual(c.errors, []);
    if (where !== 'checkout' && kept !== d.firstName) finding('Medium', 'Robustness', `Refreshing on the checkout step sends the customer back to "${where}" and the details they typed are gone. Save a draft so a refresh (or a phone killing the tab) doesn't lose their work.`);
    await c.ctx.close();
    return 'after refresh: ' + where + (kept ? ', details kept' : ', details lost');
  });
  await check('Robustness', 'A file that is not an image is refused with a message', async () => {
    const c = await customer('203.0.113.47');
    await c.page.goto(`${BASE}/create?h=img${RUN}&plan=basic&region=US`);
    await c.page.getByRole('option', { name: /Corporate & Consultants/ }).first().click();
    await c.page.setInputFiles('input[type=file]', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not a picture') });
    await c.page.waitForTimeout(1500);
    const shown = await c.page.evaluate(() => !!document.querySelector('img[src^="blob:"], [style*="blob:"]'));
    const msg = await c.page.evaluate(() => /couldn.t read|not a photo|try another|isn.t an image|unsupported/i.test(document.body.innerText));
    assert.deepEqual(c.errors, []);
    if (!msg) finding('Low', 'Robustness', 'Choosing a broken or non-image file gives no message' + (shown ? ' and an empty photo is shown.' : '; nothing happens.'));
    await c.ctx.close();
    return msg ? 'message shown' : 'no message (reported as a finding)';
  });
  await check('Robustness', 'Card page: database down shows a message, slow network still loads', async () => {
    if (!ok.pub) throw new Blocked('no live card');
    const c = await customer('203.0.113.48');
    await c.page.route('**/rest/v1/public_cards**', r => r.fulfill({ status: 500, body: '{}' }));
    await c.page.goto(`${BASE}/${A.handle}`);
    await c.page.waitForTimeout(2500);
    const t = await c.page.evaluate(() => document.body.innerText.trim());
    assert.ok(t.length > 20 && !t.includes('Ryan Collins'), 'blank page');
    await c.page.unroute('**/rest/v1/public_cards**');
    await c.page.route('**/rest/v1/public_cards**', async r => { await new Promise(res => setTimeout(res, 3000)); await r.fallback(); });
    await c.page.goto(`${BASE}/${A.handle}`);
    await c.page.waitForFunction(() => document.body.innerText.includes('Ryan Collins'), null, { timeout: 12000 });
    await c.ctx.close();
  });

  // ======================= 7. Security =======================
  await check('Security', 'Security headers on home, order, card and edit pages', async () => {
    const miss = [], reportOnly = [];
    const pages = ['/', '/create', A.handle ? '/' + A.handle : null, A.token ? '/e/' + A.token : null].filter(Boolean);
    for (const p of pages) {
      const r = await fetch(BASE + p, { redirect: 'manual' }), h = r.headers;
      const need = { 'x-content-type-options': /nosniff/, 'referrer-policy': /./, 'strict-transport-security': /max-age/ };
      for (const [k, re] of Object.entries(need)) if (!re.test(h.get(k) || '')) miss.push(`${p}: ${k}`);
      const csp = h.get('content-security-policy') || '';
      if (!/frame-ancestors/.test(csp) && !/DENY|SAMEORIGIN/i.test(h.get('x-frame-options') || '')) miss.push(`${p}: no clickjacking protection`);
      if (!csp) reportOnly.push(p.startsWith('/e/') ? '/e/:token' : p === '/' + A.handle ? '/<name>' : p);
      if (p.startsWith('/e/') && !/no-store|private/.test(h.get('cache-control') || '')) finding('Low', 'Security', `The edit page is served with "Cache-Control: ${h.get('cache-control')}". The HTML has no personal data (it loads by token), but "private, no-store" is safer for a secret URL.`);
    }
    if (reportOnly.length) finding('Medium', 'Security', `The order, card and edit pages (${reportOnly.join(', ')}) have only a report-only CSP with 'unsafe-eval', so it doesn't block anything yet. The marketing pages have an enforced one.`);
    assert.deepEqual(miss, []);
  });
  await check('Security', 'Stored XSS: script in name, job, bio, website and social links does not run on the card', async () => {
    const slug = 'xss' + RUN, x = n => `<img src=x onerror="window.__xss=${n}">`;
    const r = await rpc('place_order', { payload: orderPayload(slug, { region: 'IN', customer_phone: '9876500000', card: {
      slug, first_name: x(1), last_name: '<script>window.__xss=2</script>', title: '"><svg onload=window.__xss=3>', company: x(4), bio: '</div><script>window.__xss=5</script>' + x(6),
      phone: '+919876500000', email: 'x@example.com', website: 'javascript:window.__xss=7', linkedin: 'javascript:window.__xss=8', instagram: 'javascript:window.__xss=9',
      photo_url: 'javascript:window.__xss=10', extras: { booking_url: 'javascript:window.__xss=11', listings_url: 'javascript:window.__xss=12', meeting_url: 'javascript:window.__xss=13', facebook: 'javascript:window.__xss=14', x_url: 'javascript:window.__xss=15' } } }) }, '198.51.100.40');
    if (r.status >= 400) return 'server refused the payload: ' + (r.body.message || r.status);
    const c = await customer('203.0.113.50');
    await c.page.goto(`${BASE}/${r.body.slug}`);
    await c.page.waitForTimeout(3000);
    for (const btn of await c.page.locator('a[href^="javascript:" i]').all()) await btn.click({ timeout: 500 }).catch(() => {});
    const res = await c.page.evaluate(() => ({ xss: window.__xss || null, js: [...document.querySelectorAll('[href^="javascript:" i],[src^="javascript:" i]')].length }));
    await c.ctx.close();
    assert.equal(res.xss, null, 'script ran: payload ' + res.xss);
    assert.equal(res.js, 0, res.js + ' javascript: links on the card');
  });
  await check('Security', 'Reflected XSS: script in the URL of the order and card pages does not run', async () => {
    const c = await customer('203.0.113.51');
    for (const p of [`/create?h=%3Cimg%20src=x%20onerror=window.__xss=1%3E&ref=%22%3E%3Csvg%20onload=window.__xss=2%3E`, `/app/card.html?c=%3Cimg%20src=x%20onerror=window.__xss=3%3E`, `/e/${'a'.repeat(40)}?x=%3Cscript%3Ewindow.__xss=4%3C/script%3E`]) {
      await c.page.goto(BASE + p); await c.page.waitForTimeout(1200);
      assert.equal(await c.page.evaluate(() => window.__xss || null), null, p);
    }
    await c.ctx.close();
  });
  await check('Security', 'No secret keys in anything the browser downloads', async () => {
    const urls = new Set(['/', '/create', '/app/order.html', '/app/card.html', '/app/support.js', '/assets/js/site.js', '/assets/js/rules.js', '/app/vendor/resources.js', '/app/estate-styles.js', '/app/scene-styles.js']);
    for (const m of orderHtml.matchAll(/src="(\/app\/components\/[^"]+\.js)"/g)) urls.add(m[1]);
    const bad = [];
    const pats = [/sk_(live|test)_[A-Za-z0-9]{10,}/, /rk_(live|test)_[A-Za-z0-9]{10,}/, /whsec_[A-Za-z0-9]{10,}/, /sb_secret_[A-Za-z0-9_-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /service_role/, /SUPABASE_SERVICE_KEY\s*[:=]\s*['"][^'"]+/, /NBR_WORKER_SECRET\s*[:=]\s*['"][^'"]+/, /RAZORPAY_KEY_SECRET\s*[:=]\s*['"][^'"]+/];
    for (const u of urls) {
      const r = await fetch(BASE + u); if (!r.ok) continue; const t = await r.text();
      for (const re of pats) if (re.test(t)) bad.push(`${u}: ${re}`);
      for (const jwt of t.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || []) { try { const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); if (p.role && p.role !== 'anon') bad.push(`${u}: JWT with role ${p.role}`); } catch (_) {} }
    }
    assert.deepEqual(bad, []);
    return urls.size + ' files scanned; only the publishable Supabase key is present (by design)';
  });
  await check('Security', 'CORS: other websites are not allowed to read the API', async () => {
    const bad = [];
    for (const p of ['/api/card/' + (A.handle || 'x'), '/api/order', '/api/edit']) {
      for (const m of ['GET', 'OPTIONS']) {
        const r = await fetch(BASE + p, { method: m, headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
        const ao = r.headers.get('access-control-allow-origin');
        if (ao === '*' || ao === 'https://evil.example') bad.push(`${m} ${p}: Access-Control-Allow-Origin ${ao}`);
      }
    }
    assert.deepEqual(bad, []);
  });
  await check('Security', 'Rate limit: one address can place at most 20 orders an hour, and a forged x-nbr-ip header does not get around it', async () => {
    needDb(); await resetLimits();
    let limited = 0;
    for (let i = 0; i < 24; i++) {
      const r = await rpc('place_order', { payload: orderPayload(`rl${i}x${RUN}`) }, '198.51.100.60', { 'x-nbr-ip': '10.0.0.' + i });
      if (r.status >= 400 && /too many/i.test(r.body.message || '')) limited++;
    }
    await resetLimits();
    assert.ok(limited >= 4, `only ${limited} of 24 were limited`);
    return `${24 - limited} accepted, ${limited} refused`;
  });
  await check('Security', 'Database errors don\'t reveal internals to the browser', async () => {
    const r = await rpc('place_order', { payload: { card: 'nope' } }, '198.51.100.61');
    const body = JSON.stringify(r.body);
    if (/relation|column|function public\.|syntax|line \d+|PL\/pgSQL/i.test(body)) finding('Low', 'Security', 'With payments off the order page calls Supabase directly, so database error text (function and column names) reaches the browser. The Worker\'s cleanError() only applies to /api/*. Fine for testing; route orders through the Worker when payments go live.');
    assert.ok(r.status >= 400);
    return 'status ' + r.status + ': ' + (r.body.message || '').slice(0, 60);
  });
  notTested('Security', 'OWASP ZAP baseline scan of the deployed test environment', 'ZAP is not available in this environment and the deployed site is not reachable from here. Run: docker run -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://<staging-url>');
  notTested('Security', 'Production proxy: /api/* from linkcardly.com accepted by the old NexBizRise worker (origin check, worker secret)', 'Parked in the audit. Blocks photo upload, edit saves and payments in production. Needs a staging run.');

  // ======================= 8. Payments (deferred) =======================
  for (const s of ['Successful payment → order PAID → card active', 'Failed payment → order stays unpaid', 'Cancelled checkout → order stays unpaid', 'Customer closes checkout → no activation', 'Refresh after payment → no duplicate order',
    'Double-click Pay → one payment, one order', 'Duplicate webhook → no duplicate activation', 'Delayed webhook → card activates when it arrives', 'Forged success response → rejected', 'Wrong amount → rejected',
    'Wrong plan or price → rejected', 'Refund → card goes offline'])
    notTested('Payments', s, 'Payments are not integrated yet (PAYMENTS_ON = false). Test in Razorpay/Stripe test mode once they are.');

  await check('Lifecycle', 'No JavaScript errors in any customer session', async () => { assert.deepEqual([...a.errors, ...(b ? b.errors : [])], []); });
} catch (e) {
  results.push({ area: 'Suite', name: 'Suite crashed', status: 'FAIL', note: String(e && e.stack || e).slice(0, 600) });
} finally {
  for (const c of contexts) await c.close().catch(() => {});
  await browser.close();
}

// ---------- report ----------
const count = s => results.filter(r => r.status === s).length;
const env = STAGING ? `staging: ${BASE} with the real Supabase project` : `local: ${BASE} (wrangler dev) with the live SQL in PGlite`;
const md = [`# Linkcardly E2E report`, '', `Run ${new Date().toISOString()} · ${env} · Chromium ${browserVersion} at 390 × 844`, '',
  `**${count('PASS')} passed · ${count('FAIL')} failed · ${count('BLOCKED')} blocked · ${count('NOT TESTED')} not tested**`, '',
  '| Area | Check | Result | Notes |', '|---|---|---|---|',
  ...results.map(r => `| ${r.area} | ${r.name} | ${r.status} | ${(r.note || '').replace(/\|/g, '\\|')}${r.shot ? ` ([screenshot](${r.shot}))` : ''} |`), '',
  '## Findings', '', ...(findings.length ? findings.map(f => `- **${f.severity}** (${f.area}) ${f.text}`) : ['None.']), '',
  '## Still to test by hand', '', 'iPhone Safari, Android Chrome, desktop Chrome and desktop Safari: order, preview actions (Save contact opens the Contacts app, Call, WhatsApp, Email, Share sheet, QR scans from another phone), the live card on a slow connection, and the confirmation screen.', '',
  'Not production ready until the payment, webhook and production-proxy checks above have run and passed.', ''].join('\n');
await writeFile(new URL('report.md', OUT), md);
await writeFile(new URL('report.json', OUT), JSON.stringify({ env, results, findings }, null, 2));
for (const r of results) console.log(r.status.padEnd(10), `[${r.area}]`, r.name, r.note ? '— ' + r.note : '');
console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('BLOCKED')} blocked, ${count('NOT TESTED')} not tested · ${findings.length} findings · report: test/e2e/report/report.md`);
process.exit(count('FAIL') ? 1 : 0);
