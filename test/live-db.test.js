// The live database: supabase/live/ALL-IN-ONE.sql (from NexBizRise) + supabase/live/linkcardly.sql, applied in an
// in-process Postgres (PGlite) with stand-ins for what Supabase provides (test/support/live-db.mjs).
// Covers card link names and the partner programme end to end: apply → approve → order → paid → approved → payout.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLiveDb, ADMIN_ID as ADMIN } from './support/live-db.mjs';

const live = f => readFile(new URL('../supabase/live/' + f, import.meta.url), 'utf8');
const PRIYA = '00000000-0000-0000-0000-0000000000b1';
const RAVI = '00000000-0000-0000-0000-0000000000b2';
const STRANGER = '00000000-0000-0000-0000-0000000000c1';
let db;

// Run SQL as an API role (anon, or authenticated as a user), the way PostgREST does.
async function as(role, sql, params, user) {
  await db.exec(`set role ${role}`);
  if (user) await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [user.id, JSON.stringify({ sub: user.id, email: user.email })]);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`); }
}
const rpc = async (role, fn, args = [], user) => {
  const rows = await as(role, `select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(', ')}) as r`, args, user);
  return rows[0].r;
};
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const order = (over = {}) => ({ mode: 'builder', plan: 'basic', region: 'IN', customer_name: 'Cust', customer_email: 'cust@example.com', customer_phone: '9811111111',
  card: { slug: 'cust', first_name: 'Cust', phone: '9811111111' }, ...over });
const pay = no => db.query(`update orders set pay_status = 'paid', paid_at = now() where order_no = $1`, [no]);

before(async () => {
  db = await createLiveDb();
  await db.exec(await live('linkcardly.sql')); // safe to run again
});

// ---------- card link names ----------
test('slug_available checks every card, including ones not live yet', async () => {
  assert.equal((await rpc('anon', 'slug_available', ['ryancollins'])).available, true);
  const r = await rpc('anon', 'place_order', [order({ card: { slug: 'ryancollins', first_name: 'Ryan', phone: '9822222222' } })]);
  assert.equal(r.slug, 'ryancollins');
  assert.equal((await rpc('anon', 'slug_available', ['ryancollins'])).available, false, 'an unpaid order holds its name');
  assert.equal((await rpc('anon', 'slug_available', ['ab'])).available, false);
  assert.equal((await rpc('anon', 'slug_available', ['-x-'])).reason, 'invalid');
});

test('a claimed name that is taken is refused ("link taken"), not given random digits', async () => {
  await assert.rejects(rpc('anon', 'place_order', [order({ strict_slug: 'true', card: { slug: 'ryancollins', first_name: 'R', phone: '9833333333' } })]), /link taken/);
  // Without strict_slug (e.g. a name made from first name + phone) the old behaviour stays: digits are added.
  const r = await rpc('anon', 'place_order', [order({ card: { slug: 'ryancollins', first_name: 'R', phone: '9833333333' } })]);
  assert.match(r.slug, /^ryancollins\d{2}$/);
});

test('retrying the same order (same idem) with a strict name returns the first order', async () => {
  const idem = '11111111-2222-3333-4444-555555555555';
  const a = await rpc('anon', 'place_order', [order({ idem, strict_slug: 'true', card: { slug: 'retryname', first_name: 'R', phone: '9844444444' } })]);
  const b = await rpc('anon', 'place_order', [order({ idem, strict_slug: 'true', card: { slug: 'retryname', first_name: 'R', phone: '9844444444' } })]);
  assert.equal(b.order_no, a.order_no);
  assert.equal(b.repeat, true);
});

test('a name held by an unpaid order older than 24 hours is released', async () => {
  await rpc('anon', 'place_order', [order({ card: { slug: 'stalename', first_name: 'S', phone: '9855555555' } })]);
  await db.query(`update orders set created_at = now() - interval '25 hours' where card_id = (select id from cards where slug = 'stalename')`);
  assert.equal((await rpc('anon', 'slug_available', ['stalename'])).available, true);
  const r = await rpc('anon', 'place_order', [order({ strict_slug: 'true', card: { slug: 'stalename', first_name: 'New', phone: '9866666666' } })]);
  assert.equal(r.slug, 'stalename');
  assert.equal((await one(`select count(*)::int as n from cards where slug like 'x%' and active is false`)).n, 1, 'the old card is kept, renamed');
  // A paid card never loses its name.
  await pay(r.order_no);
  await db.query(`update orders set created_at = now() - interval '30 days' where order_no = $1`, [r.order_no]);
  assert.equal((await rpc('anon', 'slug_available', ['stalename'])).available, false);
});

// ---------- partner programme ----------
test('partner tables are not reachable from the website API', async () => {
  await assert.rejects(as('anon', `select * from partner.partners`), /permission denied/);
  await assert.rejects(as('authenticated', `select * from partner.commissions`, [], { id: PRIYA, email: 'priya@example.com' }), /permission denied/);
  await assert.rejects(rpc('anon', 'partner_apply', [{}]), /permission denied/);
  await assert.rejects(rpc('authenticated', 'admin_partners', [], { id: STRANGER, email: 'x@example.com' }), /not allowed/);
});

test('apply: signed-in, latest terms, valid phone, unique code; one application per person', async () => {
  const u = { id: PRIYA, email: 'Priya@Example.com' };
  assert.equal((await rpc('anon', 'partner_code_available', ['priya'])).available, true);
  await assert.rejects(rpc('authenticated', 'partner_apply', [{ full_name: 'Priya', phone: '9876543210', code: 'PRIYA', terms_version: 'old' }], u), /latest terms/);
  await assert.rejects(rpc('authenticated', 'partner_apply', [{ full_name: 'Priya', phone: '12345', code: 'PRIYA', terms_version: '2026-10' }], u), /invalid phone/);
  const r = await rpc('authenticated', 'partner_apply', [{ full_name: 'Priya Sharma', phone: '+91 98765 43210', instagram: '@Priya.Styles', code: 'priya', terms_version: '2026-10' }], u);
  assert.deepEqual(r, { ok: true, status: 'applied', code: 'PRIYA' });
  await assert.rejects(rpc('authenticated', 'partner_apply', [{ full_name: 'Again', phone: '9876543210', code: 'PRIYA2', terms_version: '2026-10' }], u), /already applied/);
  await assert.rejects(rpc('authenticated', 'partner_apply', [{ full_name: 'Ravi', phone: '9876500000', code: 'PRIYA', terms_version: '2026-10' }], { id: RAVI, email: 'ravi@example.com' }), /code taken/);
  assert.equal((await rpc('anon', 'partner_code_available', ['PRIYA'])).available, false);
  const me = await rpc('authenticated', 'partner_me', [], u);
  assert.equal(me.partner.status, 'applied');
  assert.equal(me.partner.link, 'https://linkcardly.com/r/priya');
  assert.equal((await rpc('authenticated', 'partner_me', [], { id: STRANGER, email: 's@example.com' })).partner, null);
});

test('approval turns the code into an active ₹100 coupon; clicks only count for approved partners', async () => {
  assert.equal((await rpc('anon', 'partner_click', ['priya'])).ok, false, 'not approved yet');
  const p = await one(`select id from partner.partners where code = 'PRIYA'`);
  await rpc('authenticated', 'admin_partner_set', [p.id, 'approved', null, null], { id: ADMIN, email: 'admin@example.com' });
  const c = await one(`select * from coupons where code = 'PRIYA'`);
  assert.equal(c.kind, 'amount'); assert.equal(Number(c.value), 100); assert.equal(c.region, 'IN'); assert.equal(c.active, true); assert.equal(c.per_email, 1);
  assert.deepEqual(await rpc('anon', 'partner_click', ['priya']), { ok: true, code: 'PRIYA' });
  await rpc('anon', 'partner_click', ['PRIYA']);
  const chk = await rpc('anon', 'check_coupon', ['PRIYA', 'basic', 'IN', 'buyer1@example.com']);
  assert.deepEqual([chk.base, chk.discount, chk.tax, chk.total].map(Number), [799, 100, 126, 825]);
});

test('a paid order with the code earns ₹100 pending, then approved after 14 days; unpaid, waived and own orders do not', async () => {
  const u = { id: PRIYA, email: 'priya@example.com' };
  const a = await rpc('anon', 'place_order', [order({ coupon: 'PRIYA', customer_email: 'buyer1@example.com', customer_phone: '9800000001', card: { slug: 'buyer1', first_name: 'B', phone: '9800000001' } })]);
  assert.equal(Number(a.total), 825);
  let me = await rpc('authenticated', 'partner_me', [], u);
  assert.equal(me.totals.orders, 0, 'unpaid order: nothing yet');
  await pay(a.order_no);
  me = await rpc('authenticated', 'partner_me', [], u);
  assert.equal(me.totals.orders, 1); assert.equal(Number(me.totals.pending), 100); assert.equal(Number(me.totals.ready), 0);
  assert.equal(me.totals.clicks, 2);
  assert.equal(me.commissions[0].status, 'pending');
  // Paying again (webhook retry) doesn't double-count.
  await db.query(`update orders set pay_status = 'unpaid' where order_no = $1`, [a.order_no]); await pay(a.order_no);
  assert.equal((await one(`select count(*)::int as n from partner.commissions where order_no = $1`, [a.order_no])).n, 1);
  // Own order (partner's phone) is recorded as rejected.
  const own = await rpc('anon', 'place_order', [order({ coupon: 'PRIYA', customer_email: 'other@example.com', customer_phone: '+91 98765 43210', card: { slug: 'priyaown', first_name: 'P', phone: '9876543210' } })]);
  await pay(own.order_no);
  assert.equal((await one(`select status, reason from partner.commissions where order_no = $1`, [own.order_no])).status, 'rejected');
  // 14 days later it becomes payable.
  await db.query(`update partner.commissions set payable_after = now() - interval '1 minute' where order_no = $1`, [a.order_no]);
  me = await rpc('authenticated', 'partner_me', [], u);
  assert.equal(Number(me.totals.ready), 100); assert.equal(Number(me.totals.pending), 0); assert.equal(Number(me.totals.earned), 100);
  assert.equal(me.payout_details.upi, '');
});

test('a customer can use a partner code only once', async () => {
  await assert.rejects(rpc('anon', 'place_order', [order({ coupon: 'PRIYA', customer_email: 'buyer1@example.com', card: { slug: 'buyer1b', first_name: 'B', phone: '9800000011' } })]), /invalid coupon/);
});

test('refunds: before payout the commission is reversed; after payout it is clawed back', async () => {
  const b = await rpc('anon', 'place_order', [order({ coupon: 'PRIYA', customer_email: 'buyer2@example.com', card: { slug: 'buyer2', first_name: 'B', phone: '9800000002' } })]);
  await pay(b.order_no);
  await db.query(`update orders set pay_status = 'refunded' where order_no = $1`, [b.order_no]);
  assert.equal((await one(`select status from partner.commissions where order_no = $1`, [b.order_no])).status, 'reversed');
});

test('payouts: minimum ₹500, PAN hold over ₹20,000 a year, TDS once a PAN is given, mark paid, claw-back', async () => {
  const admin = { id: ADMIN, email: 'admin@example.com' }, u = { id: PRIYA, email: 'priya@example.com' };
  // Only ₹100 approved: below the minimum, carried over.
  assert.deepEqual(await rpc('authenticated', 'admin_payouts_prepare', ['2026-11'], admin), []);
  // 5 more paid, approved orders → ₹600.
  for (let i = 3; i <= 7; i++) {
    const o = await rpc('anon', 'place_order', [order({ coupon: 'PRIYA', customer_email: `buyer${i}@example.com`, card: { slug: `buyer${i}`, first_name: 'B', phone: '980000000' + i } })]);
    await pay(o.order_no);
  }
  await db.query(`update partner.commissions set payable_after = now() - interval '1 minute' where status = 'pending'`);
  await rpc('authenticated', 'partner_set_payout_details', [{ upi_id: 'priya@okaxis' }], u);
  let prep = await rpc('authenticated', 'admin_payouts_prepare', ['2026-11'], admin);
  assert.equal(prep.length, 1); assert.equal(Number(prep[0].gross), 600); assert.equal(Number(prep[0].tds), 0); assert.equal(prep[0].status, 'scheduled');
  // Running it again rebuilds instead of duplicating.
  prep = await rpc('authenticated', 'admin_payouts_prepare', ['2026-11'], admin);
  assert.equal((await one(`select count(*)::int as n from partner.payouts`)).n, 1);
  const sheet = await rpc('authenticated', 'admin_payout_sheet', [], admin);
  assert.equal(sheet[0].upi_id, 'priya@okaxis');
  assert.equal((await rpc('authenticated', 'partner_me', [], u)).payout_details.upi, 'pr•••@okaxis', 'partners only see it masked');
  await assert.rejects(rpc('authenticated', 'admin_payout_mark_paid', [prep[0].payout_id, 'UPI', ''], admin), /reference required/);
  await rpc('authenticated', 'admin_payout_mark_paid', [prep[0].payout_id, 'UPI', 'UTR123456'], admin);
  let me = await rpc('authenticated', 'partner_me', [], u);
  assert.equal(Number(me.totals.paid), 600); assert.equal(me.payouts[0].status, 'paid'); assert.equal(me.payouts[0].reference, 'UTR123456');

  // A paid order is refunded: −₹100 claw-back waits in the next payout.
  const paidOrder = (await one(`select order_no from partner.commissions where status = 'paid' order by id limit 1`)).order_no;
  await db.query(`update orders set pay_status = 'refunded' where order_no = $1`, [paidOrder]);
  assert.equal(Number((await one(`select amount from partner.commissions where order_no = $1 and kind = 'clawback'`, [paidOrder])).amount), -100);

  // Cross ₹20,000 this year without a PAN → held. (Simulate a big month.)
  await db.query(`insert into partner.commissions (partner_id, order_no, amount, status, paid_at, payable_after)
    select id, 'BULK-' || g, 100, 'approved', now(), now() from partner.partners, generate_series(1, 200) g where code = 'PRIYA'`);
  prep = await rpc('authenticated', 'admin_payouts_prepare', ['2026-12'], admin);
  assert.equal(prep[0].status, 'held'); assert.match(prep[0].hold_reason, /PAN needed/);
  assert.equal(Number(prep[0].gross), 19900, '200 × ₹100 minus the ₹100 claw-back');
  assert.equal((await rpc('authenticated', 'partner_me', [], u)).totals.pan_needed, true);
  await assert.rejects(rpc('authenticated', 'admin_payout_mark_paid', [prep[0].payout_id, 'UPI', 'X'], admin), /payout is held/);
  // PAN added → scheduled, with 2% TDS on the whole year's commission (600 + 19,900).
  await assert.rejects(rpc('authenticated', 'partner_set_payout_details', [{ pan: 'BAD' }], u), /payout_details_pan_check/);
  await rpc('authenticated', 'partner_set_payout_details', [{ pan: 'abcde1234f', pan_name: 'Priya Sharma' }], u);
  prep = await rpc('authenticated', 'admin_payouts_prepare', ['2026-12'], admin);
  assert.equal(prep[0].status, 'scheduled'); assert.equal(Number(prep[0].tds), 410); assert.equal(Number(prep[0].net), 19490);
});

test('pausing a partner switches their coupon off', async () => {
  const p = await one(`select id from partner.partners where code = 'PRIYA'`);
  await rpc('authenticated', 'admin_partner_set', [p.id, 'paused', null, 'test'], { id: ADMIN, email: 'admin@example.com' });
  assert.equal((await one(`select active from coupons where code = 'PRIYA'`)).active, false);
  assert.equal((await rpc('anon', 'partner_click', ['priya'])).ok, false);
});

// ---------- test mode (payments off) ----------
test('test mode: off by default; when on, orders skip the bot check and count as paid (provider test), card live, no commission', async () => {
  // Off: an order stays unpaid and the card is not live.
  const a = await rpc('anon', 'place_order', [order({ card: { slug: 'tm-off', first_name: 'T', phone: '9811100001' } })]);
  assert.equal(a.pay_status, 'unpaid');
  // The bot check is on in production (worker secret set): direct calls are refused...
  await db.exec(`insert into app_secrets values ('worker', repeat('x', 24)) on conflict (key) do update set value = excluded.value`);
  await assert.rejects(rpc('anon', 'place_order', [order({ card: { slug: 'tm-bot', first_name: 'T', phone: '9811100002' } })]), /bot check failed/);
  // ...until test mode is on.
  await db.exec(`insert into public.app_flags (key) values ('test_mode') on conflict (key) do nothing`);
  const p = await one(`select id from partner.partners where code = 'PRIYA'`);
  await rpc('authenticated', 'admin_partner_set', [p.id, 'approved', null, null], { id: ADMIN, email: 'admin@example.com' });
  const b = await rpc('anon', 'place_order', [order({ coupon: 'PRIYA', customer_email: 'tm@example.com', card: { slug: 'tm-on', first_name: 'T', phone: '9811100003' } })]);
  assert.equal(b.pay_status, 'paid'); assert.equal(b.test, true); assert.ok(b.edit_token);
  const o = await one(`select pay_status, pay_provider, amount_paid from orders where order_no = $1`, [b.order_no]);
  assert.deepEqual([o.pay_status, o.pay_provider, Number(o.amount_paid)], ['paid', 'test', 0]);
  assert.equal((await one(`select active from cards where slug = 'tm-on'`)).active, true);
  assert.equal((await one(`select count(*)::int as n from partner.commissions where order_no = $1`, [b.order_no])).n, 0, 'test orders never earn commission');
  assert.equal((await rpc('anon', 'slug_available', ['tm-on'])).available, false);
  // Off again: back to normal.
  await db.exec(`delete from public.app_flags where key = 'test_mode'; delete from app_secrets where key = 'worker'`);
  const c = await rpc('anon', 'place_order', [order({ card: { slug: 'tm-off2', first_name: 'T', phone: '9811100004' } })]);
  assert.equal(c.pay_status, 'unpaid');
});

// ---------- security fixes (production audit) ----------
// Run SQL as anon with request headers, the way PostgREST passes them (request.headers is client-controlled).
async function anonWithHeaders(headers, sql, params) {
  await db.exec('set role anon');
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify(headers)]);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec(`reset role; select set_config('request.headers', '', false)`); }
}

test('public card views are read-only for the API roles', async () => {
  await db.exec('delete from rate_hits'); // each test starts with fresh rate limits
  await rpc('anon', 'place_order', [order({ card: { slug: 'viewvictim', first_name: 'V', phone: '9812300000' } })]);
  await db.query(`update cards set active = true where slug = 'viewvictim'`);
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(as(role, `update public.public_cards set phone = '000' where slug = 'viewvictim'`, [], role === 'authenticated' ? { id: STRANGER, email: 's@example.com' } : null), /permission denied/);
    await assert.rejects(as(role, `insert into public.public_cards (slug, first_name) values ('free', 'F')`, [], role === 'authenticated' ? { id: STRANGER, email: 's@example.com' } : null), /permission denied/);
    await assert.rejects(as(role, `delete from public.public_card_extras where slug = 'viewvictim'`, [], role === 'authenticated' ? { id: STRANGER, email: 's@example.com' } : null), /permission denied/);
  }
  assert.equal((await as('anon', `select first_name from public.public_cards where slug = 'viewvictim'`))[0].first_name, 'V', 'reading still works');
  for (const t of ['admins', 'orders', 'leads', 'site_leads', 'rate_hits'])
    await assert.rejects(as('anon', `insert into public.${t} default values`), /permission denied/);
});

test('rate limits ignore a spoofed x-nbr-ip header unless the request carries the worker secret', async () => {
  await db.exec(`delete from rate_hits where bucket = 'slug'`);
  let blocked = false;
  for (let i = 0; i < 125 && !blocked; i++) {
    try { await anonWithHeaders({ 'x-nbr-ip': '10.0.0.' + i, 'cf-connecting-ip': '203.0.113.9' }, `select public.slug_available('spoof${i}')`); }
    catch (e) { if (/too many requests/.test(e.message)) blocked = true; else throw e; }
  }
  assert.ok(blocked, 'the 121st call from one real IP is refused even with a new x-nbr-ip each time');
  await db.exec(`delete from rate_hits where bucket = 'slug'`);
});

test('payments: only unpaid → paid; a refund takes the card offline and a replayed webhook does not bring it back', async () => {
  await db.exec('delete from rate_hits'); // each test starts with fresh rate limits
  const secret = 'w'.repeat(32);
  await db.query(`insert into app_secrets values ('worker', $1) on conflict (key) do update set value = excluded.value`, [secret]);
  const worker = { 'x-nbr-secret': secret, 'cf-connecting-ip': '198.51.100.1' };
  try {
    const o = await anonWithHeaders(worker, `select public.place_order($1) as r`, [order({ card: { slug: 'refundme', first_name: 'R', phone: '9812311111' } })]).then(r => r[0].r);
    const total = Math.round(Number(o.total) * 100);
    await assert.rejects(anonWithHeaders({ 'cf-connecting-ip': '198.51.100.1' }, `select public.mark_order_paid($1, 'razorpay', 'pay_1', $2, 'INR')`, [o.order_no, total]), /not allowed/);
    const paid = (await anonWithHeaders(worker, `select public.mark_order_paid($1, 'razorpay', 'pay_1', $2, 'INR') as r`, [o.order_no, total]))[0].r;
    assert.equal(paid.first, true);
    assert.equal((await one(`select active from cards where slug = 'refundme'`)).active, true);
    await db.query(`update orders set pay_status = 'refunded' where order_no = $1`, [o.order_no]);
    assert.equal((await one(`select active from cards where slug = 'refundme'`)).active, false, 'refund takes the card offline');
    const replay = (await anonWithHeaders(worker, `select public.mark_order_paid($1, 'razorpay', 'pay_1', $2, 'INR') as r`, [o.order_no, total]))[0].r;
    assert.equal(replay.first, false); assert.equal(replay.edit_token, '');
    assert.equal((await one(`select pay_status from orders where order_no = $1`, [o.order_no])).pay_status, 'refunded');
    assert.equal((await one(`select active from cards where slug = 'refundme'`)).active, false);
  } finally { await db.exec(`delete from app_secrets where key = 'worker'`); }
});

test('new orders: a real email is required and the card follows the edit field rules', async () => {
  await db.exec('delete from rate_hits'); // each test starts with fresh rate limits
  await assert.rejects(rpc('anon', 'place_order', [order({ customer_email: '', card: { slug: 'noemail', first_name: 'N', phone: '9812322222' } })]), /invalid email/);
  await assert.rejects(rpc('anon', 'place_order', [order({ customer_email: 'not-an-email', card: { slug: 'noemail', first_name: 'N', phone: '9812322222' } })]), /invalid email/);
  const r = await rpc('anon', 'place_order', [order({ customer_email: 'clean@example.com', card: {
    slug: 'cleanme', first_name: 'C', phone: '9812333333', show_powered_by: false, signature: '<img src=x onerror=alert(1)>', titles: 'x',
    colour: '"><script>', layout: 'scene', preset: 'bad preset!', photo_zoom: 'abc', is_admin: true,
    extras: { greeting: 'g'.repeat(500), office_address: '<b>x</b>', booking_url: 'javascript:alert(1)', evil: 'x', lead_capture: true } } })]);
  const c = await one(`select show_powered_by, signature, titles, colour, layout, preset, photo_zoom, extras from cards where slug = $1`, [r.slug]);
  assert.equal(c.show_powered_by, true); assert.equal(c.signature, ''); assert.equal(c.titles, '');
  assert.equal(c.colour, 'forest'); assert.equal(c.layout, 'scene'); assert.equal(c.preset, 'entrepreneur'); assert.equal(Number(c.photo_zoom), 1);
  assert.equal(c.extras.greeting.length, 60); assert.equal(c.extras.booking_url, ''); assert.equal(c.extras.evil, undefined); assert.equal(c.extras.lead_capture, true);
});

test('a name with 80 numbered copies gets a 4-digit suffix instead of looping forever', async () => {
  await db.exec('delete from rate_hits'); // each test starts with fresh rate limits
  await db.exec(`insert into cards (slug, first_name, phone) select 'busy' || g, 'B', '9800000000' from generate_series(10, 89) g`);
  await db.exec(`insert into cards (slug, first_name, phone) values ('busy', 'B', '9800000000')`);
  const r = await rpc('anon', 'place_order', [order({ customer_email: 'busy@example.com', card: { slug: 'busy', first_name: 'B', phone: '9812344444' } })]);
  assert.match(r.slug, /^busy\d{4}$/);
});

test('edit links can switch a card to the estate and scene designs', async () => {
  await db.exec('delete from rate_hits'); // each test starts with fresh rate limits
  const r = await rpc('anon', 'place_order', [order({ customer_email: 'edit@example.com', card: { slug: 'editscene', first_name: 'E', phone: '9812355555' } })]);
  await rpc('anon', 'update_card_by_token', [r.edit_token, { first_name: 'E', phone: '9812355555', layout: 'scene', colour: 'summit-pine' }]);
  const c = await one(`select layout, colour from cards where slug = 'editscene'`);
  assert.deepEqual([c.layout, c.colour], ['scene', 'summit-pine']);
});

test('partner code check does not reveal other coupons', async () => {
  await db.exec(`insert into coupons (code, kind, value, region, note) values ('SECRET50', 'percent', 50, null, 'internal') on conflict do nothing`);
  assert.equal((await rpc('anon', 'partner_code_available', ['SECRET50'])).available, true);
  await assert.rejects(rpc('authenticated', 'partner_apply', [{ full_name: 'Sneaky', phone: '9876511111', code: 'SECRET50', terms_version: '2026-10' }], { id: '00000000-0000-0000-0000-0000000000d1', email: 'sneak@example.com' }), /code taken/);
});

test('anonymous visitors cannot read the cards table or the admins list (only the public views)', async () => {
  await assert.rejects(as('anon', 'select * from public.cards limit 1'), /permission denied/);
  await assert.rejects(as('anon', 'select * from public.admins limit 1'), /permission denied/);
  assert.ok(Array.isArray(await as('anon', 'select slug from public.public_cards limit 1')));
});
