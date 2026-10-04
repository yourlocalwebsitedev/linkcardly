// Admin page (/admin) end to end in a real browser, against the Worker in native mode and the real database SQL
// (PGlite behind the PostgREST + login stand-in, test/support/). Test mode is off, as in production, so a new order is
// unpaid. Checks: wrong password refused; a signed-in non-admin sees no data and can't mark anything paid; the admin
// sees the order as Unpaid, clicks "Mark paid", and the order is paid, the card live, the edit link copied.
//
// Start the Worker as for the production suite in native mode (README, "Testing"), then:
//   BASE=http://127.0.0.1:8787 node test/e2e/admin.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { createLiveDb, ADMIN_ID } from '../support/live-db.mjs';
import { createPostgrest } from '../support/postgrest.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const ADMIN = { id: ADMIN_ID, email: 'admin@example.com', password: 'admin-pass-123' };
const OTHER = { id: '00000000-0000-0000-0000-0000000000e1', email: 'someone@example.com', password: 'other-pass-123' };

const cfg = await fetch(BASE + '/app/config.js').then(r => r.text()).then(t => { const w = {}; new Function('window', t)(w); return w.LC_CONFIG; });
if (!cfg.native || !/^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(cfg.supabaseUrl)) throw new Error('start wrangler dev in native mode with SUPABASE_URL=http://127.0.0.1:54329 (README, "Testing")');

const db = await createLiveDb();
await db.query(`insert into auth.users values ($1)`, [OTHER.id]);
await db.query(`insert into public.app_secrets values ('worker', $1) on conflict (key) do update set value = excluded.value`, [process.env.E2E_WORKER_SECRET || 'e2e-worker-secret-0123456789abcdef']);
const api = createPostgrest(db, { users: [ADMIN, OTHER] });

// The Worker reaches the database over HTTP; the browser through Playwright routes (same database).
const u = new URL(cfg.supabaseUrl);
const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await api.handle({ method: req.method, url: cfg.supabaseUrl.replace(/\/$/, '') + req.url, headers: { ...req.headers, 'x-forwarded-for': '127.0.0.1' }, body: chunks.length ? Buffer.concat(chunks).toString() : undefined });
  res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(r.body == null ? '' : JSON.stringify(r.body));
});
await new Promise(ok => server.listen(Number(u.port), u.hostname, ok));

await mkdir(new URL('./report/', import.meta.url), { recursive: true });
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, '—', String(e.message || e).split('\n')[0].slice(0, 300)); }
}

// An unpaid order, placed through the Worker like the order page does.
const slug = 'adm' + Date.now().toString(36).slice(-5);
const placed = await fetch(BASE + '/api/order', { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ ts: '', body: { payload: {
  mode: 'builder', plan: 'basic', region: 'IN', customer_name: 'Priya Sharma', customer_email: 'priya@example.com', customer_phone: '9811122233', strict_slug: 'true',
  card: { slug, first_name: 'Priya', last_name: 'Sharma', phone: '+919811122233', email: 'priya@example.com' } } } }) }).then(r => r.json());
assert.equal(placed.pay_status, 'unpaid', 'test mode must be off: ' + JSON.stringify(placed));
const ORDER = placed.order_no;

const browser = await chromium.launch();
async function open(width = 1280, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(cfg.supabaseUrl.replace(/\/$/, '') + '/**', async route => {
    const r = route.request();
    const res = await api.handle({ method: r.method(), url: r.url(), headers: { ...r.headers(), 'x-forwarded-for': '203.0.113.70' }, body: r.postData() });
    await route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: res.body == null ? '' : JSON.stringify(res.body) });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { ctx, page, errors };
}
const signIn = async (page, who) => {
  await page.goto(BASE + '/admin');
  await page.waitForSelector('#l-email', { timeout: 20000 });
  await page.fill('#l-email', who.email); await page.fill('#l-pass', who.password);
  await page.getByRole('button', { name: /sign in|log in/i }).first().click();
};

try {
  await step('/admin loads the Linkcardly admin login with no JavaScript errors', async () => {
    const { ctx, page, errors } = await open();
    await page.goto(BASE + '/admin');
    await page.waitForSelector('#l-email', { timeout: 20000 });
    assert.match(await page.title(), /Linkcardly Admin/);
    assert.doesNotMatch(await page.content(), /NexBiz/i);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await step('a wrong password is refused', async () => {
    const { ctx, page } = await open();
    await signIn(page, { ...ADMIN, password: 'wrong-password' });
    await page.waitForFunction(() => /invalid|incorrect|wrong/i.test(document.body.innerText), null, { timeout: 10000 });
    assert.equal(await page.locator('#l-email').count(), 1);
    await ctx.close();
  });

  await step('a signed-in user who is not an admin sees no orders and cannot mark one paid', async () => {
    const { ctx, page } = await open();
    await signIn(page, OTHER);
    await page.waitForFunction(() => /not an admin|no access|not allowed|admin access/i.test(document.body.innerText), null, { timeout: 10000 });
    assert.doesNotMatch(await page.content(), new RegExp(ORDER));
    const token = (await api.handle({ method: 'POST', url: cfg.supabaseUrl + '/auth/v1/token?grant_type=password', headers: { apikey: 'x' }, body: JSON.stringify({ email: OTHER.email, password: OTHER.password }) })).body.access_token;
    const r = await fetch(BASE + '/api/admin/paid', { method: 'POST', headers: { Origin: BASE, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ order_no: ORDER, ref: 'x' }) });
    assert.equal(r.status, 401);
    assert.equal((await db.query(`select pay_status from orders where order_no = $1`, [ORDER])).rows[0].pay_status, 'unpaid');
    await ctx.close();
  });

  await step('admin: the new order shows as Unpaid; "Mark paid" makes it paid, the card live, and copies the edit link', async () => {
    const { ctx, page, errors } = await open();
    await signIn(page, ADMIN);
    await page.getByRole('tab', { name: /^Orders/ }).first().click({ timeout: 20000 });
    const row = page.locator('div', { hasText: ORDER }).filter({ has: page.getByRole('button', { name: 'Mark paid' }) }).last();
    await row.waitFor({ timeout: 15000 });
    assert.match(await row.innerText(), /Unpaid/);
    await page.getByRole('tab', { name: /^Clients/ }).first().click();
    await page.waitForFunction(x => document.body.innerText.includes('/' + x), slug, { timeout: 10000 });
    await page.getByRole('tab', { name: /^Orders/ }).first().click();
    page.once('dialog', d => d.accept('UPI 778899'));
    await row.getByRole('button', { name: 'Mark paid' }).click();
    await page.waitForFunction(o => document.body.innerText.includes(o + ' paid · card live'), ORDER, { timeout: 15000 });
    const o = (await db.query(`select o.pay_status, o.pay_provider, o.pay_ref, c.active from orders o join cards c on c.id = o.card_id where o.order_no = $1`, [ORDER])).rows[0];
    assert.deepEqual([o.pay_status, o.pay_provider, o.pay_ref, o.active], ['paid', 'manual', 'UPI 778899', true]);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    assert.match(clip, /\/e\/[a-f0-9]{40}$/, 'edit link copied');
    assert.equal(await page.locator('div', { hasText: ORDER }).getByRole('button', { name: 'Mark paid' }).count(), 0, 'button gone once paid');
    await page.waitForTimeout(2600); await page.screenshot({ path: new URL('./report/admin-orders.png', import.meta.url).pathname });
    const card = await fetch(BASE + '/api/card/' + slug).then(r => r.json());
    assert.equal(card.row && card.row.slug, slug, 'the card is public now');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await step('admin page works on a phone (390 × 844): sign in and see the Orders tab', async () => {
    const { ctx, page, errors } = await open(390, 844);
    await signIn(page, ADMIN);
    await page.getByRole('tab', { name: /^Orders/ }).first().click({ timeout: 20000 });
    await page.waitForFunction(o => document.body.innerText.includes(o), ORDER, { timeout: 15000 });
    await page.screenshot({ path: new URL('./report/admin-orders-phone.png', import.meta.url).pathname });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) console.log('  note: page is', overflow, 'px wider than the phone screen');
    assert.deepEqual(errors, []);
    await ctx.close();
  });
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
