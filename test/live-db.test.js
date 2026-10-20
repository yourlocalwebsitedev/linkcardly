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
const SHIP = { name: 'Asha Verma', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pin: '560001' };
const pay = no => db.query(`update orders set pay_status = 'paid', paid_at = now() where order_no = $1`, [no]);

before(async () => {
  db = await createLiveDb();
  // Both live projects were built before later changes, so updating them means running these two again.
  await db.exec(await live('ALL-IN-ONE.sql')); // safe to run again
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
  assert.equal(c.kind, 'amount'); assert.equal(Number(c.value), 100); assert.equal(c.region, 'IN'); assert.equal(c.active, true); assert.equal(c.per_email, 100000, 'no real per-email limit: repeat customers keep the discount');
  assert.deepEqual(await rpc('anon', 'partner_click', ['priya']), { ok: true, code: 'PRIYA' });
  await rpc('anon', 'partner_click', ['PRIYA']);
  const chk = await rpc('anon', 'check_coupon', ['PRIYA', 'basic', 'IN', 'buyer1@example.com']);
  assert.deepEqual([chk.base, chk.discount, chk.tax, chk.total].map(Number), [799, 100, 0, 699], 'no GST for now');
});

test('a paid order with the code earns ₹200 pending, then approved after 15 days; the partner\'s own order earns too', async () => {
  const u = { id: PRIYA, email: 'priya@example.com' };
  const a = await rpc('anon', 'place_order', [order({ coupon: 'PRIYA', customer_email: 'buyer1@example.com', customer_phone: '9800000001', card: { slug: 'buyer1', first_name: 'B', phone: '9800000001' } })]);
  assert.equal(Number(a.total), 825);
  let me = await rpc('authenticated', 'partner_me', [], u);
  assert.equal(me.totals.orders, 0, 'unpaid order: nothing yet');
  await pay(a.order_no);
  me = await rpc('authenticated', 'partner_me', [], u);
  assert.equal(me.totals.orders, 1); assert.equal(Number(me.totals.pending), 200); assert.equal(Number(me.totals.ready), 0);
  assert.equal(me.totals.clicks, 2);
  assert.equal(me.commissions[0].status, 'pending');
  // Paying again (webhook retry) doesn't double-count.
  await db.query(`update orders set pay_status = 'unpaid' where order_no = $1`, [a.order_no]); await pay(a.order_no);
  assert.equal((await one(`select count(*)::int as n from partner.commissions where order_no = $1`, [a.order_no])).n, 1);
  // Own order (partner's phone) earns like any other.
  const own = await rpc('anon', 'place_order', [order({ coupon: 'PRIYA', customer_email: 'other@example.com', customer_phone: '+91 98765 43210', card: { slug: 'priyaown', first_name: 'P', phone: '9876543210' } })]);
  await pay(own.order_no);
  assert.equal((await one(`select status, reason from partner.commissions where order_no = $1`, [own.order_no])).status, 'pending');
  // 15 days later it becomes payable.
  await db.query(`update partner.commissions set payable_after = now() - interval '1 minute' where order_no = $1`, [a.order_no]);
  me = await rpc('authenticated', 'partner_me', [], u);
  assert.equal(Number(me.totals.ready), 200); assert.equal(Number(me.totals.pending), 200, 'own order still in its 15 days'); assert.equal(Number(me.totals.earned), 400);
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

test('payouts: minimum ₹500, PAN hold over ₹10,000 a year, TDS once a PAN is given, mark paid, claw-back', async () => {
  const admin = { id: ADMIN, email: 'admin@example.com' }, u = { id: PRIYA, email: 'priya@example.com' };
  // Only ₹200 approved: below the minimum, carried over.
  assert.deepEqual(await rpc('authenticated', 'admin_payouts_prepare', ['2026-11'], admin), []);
  // 5 more paid orders, all approved with the two above → 7 × ₹200 = ₹1,400.
  for (let i = 3; i <= 7; i++) {
    const o = await rpc('anon', 'place_order', [order({ coupon: 'PRIYA', customer_email: `buyer${i}@example.com`, card: { slug: `buyer${i}`, first_name: 'B', phone: '980000000' + i } })]);
    await pay(o.order_no);
  }
  await db.query(`update partner.commissions set payable_after = now() - interval '1 minute' where status = 'pending'`);
  await rpc('authenticated', 'partner_set_payout_details', [{ upi_id: 'priya@okaxis' }], u);
  let prep = await rpc('authenticated', 'admin_payouts_prepare', ['2026-11'], admin);
  assert.equal(prep.length, 1); assert.equal(Number(prep[0].gross), 1400); assert.equal(Number(prep[0].tds), 0); assert.equal(prep[0].status, 'scheduled');
  // Running it again rebuilds instead of duplicating.
  prep = await rpc('authenticated', 'admin_payouts_prepare', ['2026-11'], admin);
  assert.equal((await one(`select count(*)::int as n from partner.payouts`)).n, 1);
  const sheet = await rpc('authenticated', 'admin_payout_sheet', [], admin);
  assert.equal(sheet[0].upi_id, 'priya@okaxis');
  assert.equal((await rpc('authenticated', 'partner_me', [], u)).payout_details.upi, 'pr•••@okaxis', 'partners only see it masked');
  await assert.rejects(rpc('authenticated', 'admin_payout_mark_paid', [prep[0].payout_id, 'UPI', ''], admin), /reference required/);
  await rpc('authenticated', 'admin_payout_mark_paid', [prep[0].payout_id, 'UPI', 'UTR123456'], admin);
  let me = await rpc('authenticated', 'partner_me', [], u);
  assert.equal(Number(me.totals.paid), 1400); assert.equal(me.payouts[0].status, 'paid'); assert.equal(me.payouts[0].reference, 'UTR123456');

  // A paid order is refunded: −₹200 claw-back waits in the next payout.
  const paidOrder = (await one(`select order_no from partner.commissions where status = 'paid' order by id limit 1`)).order_no;
  await db.query(`update orders set pay_status = 'refunded' where order_no = $1`, [paidOrder]);
  assert.equal(Number((await one(`select amount from partner.commissions where order_no = $1 and kind = 'clawback'`, [paidOrder])).amount), -200);

  // Cross ₹10,000 this year without a PAN → held. (Simulate a big month.)
  await db.query(`insert into partner.commissions (partner_id, order_no, amount, status, paid_at, payable_after)
    select id, 'BULK-' || g, 100, 'approved', now(), now() from partner.partners, generate_series(1, 200) g where code = 'PRIYA'`);
  prep = await rpc('authenticated', 'admin_payouts_prepare', ['2026-12'], admin);
  assert.equal(prep[0].status, 'held'); assert.match(prep[0].hold_reason, /PAN needed/);
  assert.equal(Number(prep[0].gross), 19800, '200 × ₹100 minus the ₹200 claw-back');
  assert.equal((await rpc('authenticated', 'partner_me', [], u)).totals.pan_needed, true);
  await assert.rejects(rpc('authenticated', 'admin_payout_mark_paid', [prep[0].payout_id, 'UPI', 'X'], admin), /payout is held/);
  // PAN added → scheduled, with 2% TDS on the whole year's commission (1,400 + 19,800 = 21,200).
  await assert.rejects(rpc('authenticated', 'partner_set_payout_details', [{ pan: 'BAD' }], u), /payout_details_pan_check/);
  await rpc('authenticated', 'partner_set_payout_details', [{ pan: 'abcde1234f', pan_name: 'Priya Sharma' }], u);
  prep = await rpc('authenticated', 'admin_payouts_prepare', ['2026-12'], admin);
  assert.equal(prep[0].status, 'scheduled'); assert.equal(Number(prep[0].tds), 424); assert.equal(Number(prep[0].net), 19376);
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
  await db.exec(`insert into cards (slug, first_name, title, phone) select 'busy' || g, 'B', '', '9800000000' from generate_series(10, 89) g`);
  await db.exec(`insert into cards (slug, first_name, title, phone) values ('busy', 'B', '', '9800000000')`);
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

test('photos: only Linkcardly R2 addresses (img / img-staging, p/<24 hex>) are kept; anything else is dropped', async () => {
  await db.exec('delete from rate_hits'); // each test starts with fresh rate limits
  const ok = 'https://img.linkcardly.com/p/0123456789abcdef01234567.webp';
  const okJpg = 'https://img-staging.linkcardly.com/p/0123456789abcdef01234567.jpg';
  for (const [u, jpg, want] of [
    [ok, false, true], [okJpg, true, true], [ok, true, false],
    ['https://img.nexbizrise.com/p/0123456789abcdef01234567.webp', false, false],
    ['https://img.linkcardly.com.evil.com/p/0123456789abcdef01234567.webp', false, false],
    ['https://img.linkcardly.com/p/../x.webp', false, false], ['javascript:alert(1)', false, false], [null, false, false]
  ]) assert.equal((await one(`select public.media_url_ok($1, $2) as ok`, [u, jpg])).ok, want, String(u));
  const r = await rpc('anon', 'place_order', [order({ customer_email: 'photo@example.com', card: { slug: 'photome', first_name: 'P', phone: '9812366666',
    photo_url: 'https://evil.example.com/p.webp', extras: { og_image: 'https://evil.example.com/o.jpg' } } })]);
  let c = await one(`select photo_url, extras->>'og_image' as og from cards where slug = 'photome'`);
  assert.deepEqual([c.photo_url, c.og], ['', ''], 'foreign addresses are dropped on order');
  await rpc('anon', 'update_card_by_token', [r.edit_token, { first_name: 'P', phone: '9812366666', photo_url: ok, extras: { og_image: okJpg } }]);
  c = await one(`select photo_url, extras->>'og_image' as og from cards where slug = 'photome'`);
  assert.deepEqual([c.photo_url, c.og], [ok, okJpg], 'own R2 addresses are kept on edit');
});

test('refunds through the Worker: worker only, paid → refunded once, card goes offline', async () => {
  await db.exec('delete from rate_hits'); // each test starts with fresh rate limits
  const secret = 'r'.repeat(32);
  await db.query(`insert into app_secrets values ('worker', $1) on conflict (key) do update set value = excluded.value`, [secret]);
  const worker = { 'x-nbr-secret': secret, 'cf-connecting-ip': '198.51.100.2' };
  const call = (h, no) => anonWithHeaders(h, `select public.mark_order_refunded($1, 'razorpay', 'rfnd_1') as r`, [no]).then(r => r[0].r);
  try {
    const o = await anonWithHeaders(worker, `select public.place_order($1) as r`, [order({ card: { slug: 'refund2', first_name: 'R', phone: '9812377777' } })]).then(r => r[0].r);
    await assert.rejects(call({ 'cf-connecting-ip': '198.51.100.2' }, o.order_no), /not allowed/);
    assert.equal((await call(worker, o.order_no)).changed, false, 'an unpaid order is not marked refunded');
    await anonWithHeaders(worker, `select public.mark_order_paid($1, 'razorpay', 'pay_2', $2, 'INR')`, [o.order_no, Math.round(Number(o.total) * 100)]);
    assert.equal((await one(`select active from cards where slug = 'refund2'`)).active, true);
    const first = await call(worker, o.order_no);
    assert.equal(first.changed, true); assert.equal(first.customer_email, 'cust@example.com'); assert.equal(first.slug, 'refund2');
    assert.equal((await call(worker, o.order_no)).changed, false, 'a replayed refund webhook changes nothing');
    const row = await one(`select pay_status, notes from orders where order_no = $1`, [o.order_no]);
    assert.equal(row.pay_status, 'refunded'); assert.match(row.notes, /Refunded via razorpay rfnd_1/);
    assert.equal((await one(`select active from cards where slug = 'refund2'`)).active, false);
    await assert.rejects(call(worker, 'NBR-NOPE00'), /order not found/);
  } finally { await db.exec(`delete from app_secrets where key = 'worker'`); }
});

test('contact form: phone optional, but checked when given', async () => {
  await db.exec('delete from rate_hits'); // each test starts with fresh rate limits
  const lead = over => ({ name: 'Asha', business_name: 'Asha Co', email: 'asha@example.com', message: 'We need cards for 20 people.', ...over });
  assert.equal((await rpc('anon', 'submit_site_lead', [lead()])).ok, true);
  await assert.rejects(rpc('anon', 'submit_site_lead', [lead({ email: 'asha2@example.com', phone: '123' })]), /invalid phone/);
  assert.equal((await rpc('anon', 'submit_site_lead', [lead({ email: 'asha3@example.com', phone: '+91 98123 88888' })])).ok, true);
  await assert.rejects(rpc('anon', 'submit_site_lead', [lead({ email: 'bad' })]), /invalid email/);
  await assert.rejects(rpc('anon', 'submit_site_lead', [lead({ email: 'asha4@example.com', message: 'hi' })]), /missing fields/);
});

test('verify.sql runs, and its native API check passes once both files are applied', async () => {
  const rows = (await db.query(await live('verify.sql'))).rows;
  assert.equal(rows.length, 17);
  assert.equal(rows.find(r => r.check_name.startsWith('17')).status, 'PASS');
});

test('manual payment (admin page): worker only; marks paid at the order\'s own total, card live, new edit link; once', async () => {
  await db.exec('delete from rate_hits');
  const secret = 'm'.repeat(32);
  await db.query(`insert into app_secrets values ('worker', $1) on conflict (key) do update set value = excluded.value`, [secret]);
  const worker = { 'x-nbr-secret': secret, 'cf-connecting-ip': '198.51.100.3' };
  const call = (h, no) => anonWithHeaders(h, `select public.mark_order_paid_manual($1, 'UPI 4455') as r`, [no]).then(r => r[0].r);
  try {
    const o = await anonWithHeaders(worker, `select public.place_order($1) as r`, [order({ card: { slug: 'manualpay', first_name: 'M', phone: '9812388888' } })]).then(r => r[0].r);
    await assert.rejects(call({ 'cf-connecting-ip': '198.51.100.3' }, o.order_no), /not allowed/);
    const r = await call(worker, o.order_no);
    assert.equal(r.first, true); assert.match(r.edit_token, /^[a-f0-9]{40}$/); assert.equal(r.slug, 'manualpay');
    const row = await one(`select o.pay_status, o.pay_provider, o.pay_ref, o.amount_paid::float paid, o.total::float total, c.active from orders o join cards c on c.id = o.card_id where o.order_no = $1`, [o.order_no]);
    assert.deepEqual([row.pay_status, row.pay_provider, row.pay_ref, row.active], ['paid', 'manual', 'UPI 4455', true]);
    assert.equal(row.paid, row.total);
    assert.equal((await call(worker, o.order_no)).first, false, 'a second click changes nothing');
    await assert.rejects(call(worker, 'NBR-NOPE00'), /order not found/);
  } finally { await db.exec(`delete from app_secrets where key = 'worker'`); }
});

test('UPI reference: worker only, needs the order key, 12 digits, one order per UTR; the order stays unpaid', async () => {
  await db.exec('delete from rate_hits');
  const secret = 'u'.repeat(32);
  await db.query(`insert into app_secrets values ('worker', $1) on conflict (key) do update set value = excluded.value`, [secret]);
  const worker = { 'x-nbr-secret': secret, 'cf-connecting-ip': '198.51.100.4' };
  const claim = (h, no, idem, utr) => anonWithHeaders(h, `select public.claim_upi_payment($1, $2, $3) as r`, [no, idem, utr]).then(r => r[0].r);
  const idemA = '0a0a0a0a-1111-4111-8111-aaaaaaaaaaaa', idemB = '0b0b0b0b-2222-4222-8222-bbbbbbbbbbbb';
  try {
    const a = await anonWithHeaders(worker, `select public.place_order($1) as r`, [order({ idem: idemA, card: { slug: 'upia', first_name: 'U', phone: '9812377777' } })]).then(r => r[0].r);
    const b = await anonWithHeaders(worker, `select public.place_order($1) as r`, [order({ idem: idemB, card: { slug: 'upib', first_name: 'V', phone: '9812366666' } })]).then(r => r[0].r);
    await assert.rejects(claim({ 'cf-connecting-ip': '198.51.100.4' }, a.order_no, idemA, '412398765432'), /not allowed/);
    await assert.rejects(claim(worker, a.order_no, idemB, '412398765432'), /order not found/, 'wrong order key');
    await assert.rejects(claim(worker, a.order_no, idemA, '41239876543'), /invalid utr/);
    const r = await claim(worker, a.order_no, idemA, '412398765432');
    assert.deepEqual([r.first, r.pay_status, Number(r.total) > 0], [true, 'unpaid', true]);
    assert.equal((await claim(worker, a.order_no, idemA, '412398765432')).first, false, 'same reference again: nothing new');
    await assert.rejects(claim(worker, b.order_no, idemB, '412398765432'), /utr used/);
    const row = await one(`select o.pay_status, o.upi_utr, o.upi_claimed_at is not null claimed, c.active from orders o join cards c on c.id = o.card_id where o.order_no = $1`, [a.order_no]);
    assert.deepEqual([row.pay_status, row.upi_utr, row.claimed, row.active], ['unpaid', '412398765432', true, false]);
    // An admin confirms it with Mark paid; after that a reference changes nothing.
    await anonWithHeaders(worker, `select public.mark_order_paid_manual($1, $2) as r`, [a.order_no, row.upi_utr]);
    assert.deepEqual(await claim(worker, a.order_no, idemA, '412398765433'), { ok: true, first: false, pay_status: 'paid' });
  } finally { await db.exec(`delete from app_secrets where key = 'worker'`); }
});

// ---------- partners added by an admin (2026-10) ----------
test('admin adds a partner: free Digital card that never expires, active code, private link + PIN; 5 wrong PINs lock it', async () => {
  const admin = { id: ADMIN, email: 'admin@example.com' };
  const r = await rpc('authenticated', 'admin_partner_create', [{ full_name: 'Riya Sen', phone: '+91 98111 22233', email: 'riya@example.com', code: 'riya', handle: 'riyasen', upi_id: 'riya@okicici' }], admin);
  assert.equal(r.code, 'RIYA'); assert.equal(r.pin, '2233'); assert.equal(r.qr_link, 'https://linkcardly.com/r/riya');
  assert.match(r.partner_link, /^https:\/\/linkcardly\.com\/partner#[a-f0-9]{40}$/); assert.match(r.edit_link, /\/e\/[a-f0-9]{40}$/);
  const card = await one(`select active, plan, renewal, extras->>'partner_code' as pc, extras->>'partner_free' as free from cards where slug = 'riyasen'`);
  assert.deepEqual([card.active, card.plan, String(card.renewal).slice(0, 4), card.pc, card.free], [true, 'basic', '2099', 'RIYA', 'true']);
  assert.equal((await one(`select active from coupons where code = 'RIYA'`)).active, true);
  assert.equal((await one(`select p.access_hash = edit_hash_of($1) as ok from partner.partners p where code = 'RIYA'`, [r.partner_link.split('#')[1]])).ok, true, 'only a hash is stored');
  await assert.rejects(rpc('authenticated', 'admin_partner_create', [{ full_name: 'X Y', phone: '9811122234', email: 'xy@example.com', code: 'RIYA', handle: 'xy1' }], admin), /code taken/);
  await assert.rejects(rpc('authenticated', 'admin_partner_create', [{ full_name: 'X Y', phone: '9811122234', email: 'xy@example.com', code: 'XYXY', handle: 'riyasen' }], admin), /link taken/);
  await assert.rejects(rpc('authenticated', 'admin_partner_create', [{}], { id: STRANGER, email: 'x@example.com' }), /not allowed/);

  const tok = r.partner_link.split('#')[1], secret = 'p'.repeat(32);
  await db.query(`insert into app_secrets values ('worker', $1) on conflict (key) do update set value = excluded.value`, [secret]);
  const worker = { 'x-nbr-secret': secret, 'cf-connecting-ip': '198.51.100.9' };
  const me = pin => anonWithHeaders(worker, `select public.partner_me_token($1, $2) as r`, [tok, pin]).then(x => x[0].r);
  try {
    await assert.rejects(anonWithHeaders({ 'cf-connecting-ip': '198.51.100.9' }, `select public.partner_me_token($1, $2)`, [tok, '2233']), /not allowed/, 'Worker only');
    const ok = await me('2233');
    assert.equal(ok.ok, true); assert.equal(ok.partner.code, 'RIYA'); assert.equal(ok.card.slug, 'riyasen'); assert.equal(ok.payout_details.upi, 'ri•••@okicici');
    for (let i = 0; i < 5; i++) assert.equal((await me('0000')).error, 'wrong pin');
    await assert.rejects(me('2233'), /locked/, 'locked for 15 minutes after 5 wrong PINs');
    await db.query(`update partner.partners set locked_until = now() - interval '1 second' where code = 'RIYA'`);
    assert.equal((await me('2233')).ok, true);
    const fresh = await rpc('authenticated', 'admin_partner_new_link', [(await one(`select id from partner.partners where code = 'RIYA'`)).id], admin);
    await assert.rejects(me('2233'), /invalid link/, 'the old link stops working');
    assert.equal((await anonWithHeaders(worker, `select public.partner_me_token($1, '2233') as r`, [fresh.partner_link.split('#')[1]]))[0].r.ok, true);
  } finally { await db.query(`delete from app_secrets where key = 'worker'`); }
});

// ---------- partner programme: end-to-end scenarios (leaks, money, mistakes) ----------
{
  const ADM = { id: ADMIN, email: 'admin@example.com' }, BAD = { id: STRANGER, email: 'x@example.com' }, SECRET = 'e'.repeat(32);
  const W = { 'x-nbr-secret': SECRET, 'cf-connecting-ip': '198.51.100.20' };
  const withWorker = async f => { await db.query(`insert into app_secrets values ('worker', $1) on conflict (key) do update set value = excluded.value`, [SECRET]); try { return await f(); } finally { await db.query(`delete from app_secrets where key = 'worker'`); } };
  const me = (tok, pin) => anonWithHeaders(W, `select public.partner_me_token($1, $2) as r`, [tok, pin]).then(x => x[0].r);
  const make = (code, phone, extra = {}) => rpc('authenticated', 'admin_partner_create', [{ full_name: code + ' Partner', phone, email: code.toLowerCase() + '@partners.example', code, handle: code.toLowerCase() + '-card', ...extra }], ADM);
  const tokOf = r => r.partner_link.split('#')[1];
  const sale = async (code, n, plan = 'basic', email, extra = {}) => { const o = await rpc('anon', 'place_order', [order({ plan, ...extra, coupon: code, customer_name: 'Asha Verma', customer_email: email || `${code.toLowerCase()}${n}@buyers.example`, customer_phone: '98222' + String(n).padStart(5, '0'), card: { slug: `${code.toLowerCase()}-b${n}`, first_name: 'Asha', phone: '98222' + String(n).padStart(5, '0') } })]); await pay(o.order_no); return o; };
  const due = () => db.query(`update partner.commissions set payable_after = now() - interval '1 minute' where status = 'pending'`);
  const idOf = async code => (await one(`select id from partner.partners where code = $1`, [code])).id;
  let A, B;

  test('S1 non-admins cannot use any admin partner function', async () => {
    for (const [fn, args] of [['admin_partners', []], ['admin_partner_create', [{}]], ['admin_partner_view', ['00000000-0000-0000-0000-000000000000']], ['admin_partner_new_link', ['00000000-0000-0000-0000-000000000000']], ['admin_payouts_prepare', ['2026-12']], ['admin_payout_sheet', []], ['admin_payout_mark_paid', [1, 'UPI', 'X']]])
      await assert.rejects(rpc('authenticated', fn, args, BAD), /not allowed|permission denied/, fn);
    await assert.rejects(rpc('anon', 'admin_partners', []), /permission denied/);
  });
  test('S2 anon and signed-in users cannot read partner tables or customer orders directly', async () => {
    for (const t of ['partner.partners', 'partner.commissions', 'partner.payouts', 'partner.payout_details', 'partner.clicks']) {
      await assert.rejects(as('anon', `select * from ${t}`), /permission denied/, t);
      await assert.rejects(as('authenticated', `select * from ${t}`, [], BAD), /permission denied/, t);
    }
  });
  test('S3 admin creates two partners; each gets its own code, card and private link', async () => {
    A = await make('ALFA', '9833300001'); B = await make('BRAVO', '9833300002', { commission: 300 });
    assert.notEqual(tokOf(A), tokOf(B)); assert.equal(A.pin, '0001'); assert.equal(B.pin, '0002');
  });
  test('S4 partner page needs the Worker; a direct database call is refused', async () => {
    await withWorker(async () => { await assert.rejects(anonWithHeaders({ 'cf-connecting-ip': '1.2.3.4' }, `select public.partner_me_token($1, '0001')`, [tokOf(A)]), /not allowed/); });
  });
  test('S5 a forged or wrong-format link is refused', async () => {
    await withWorker(async () => { await assert.rejects(me('f'.repeat(40), '0001'), /invalid link/); await assert.rejects(me('zz', '0001'), /invalid link/); });
  });
  test('S6 the PIN of one partner does not open another partner page', async () => {
    await withWorker(async () => { assert.equal((await me(tokOf(A), '0002')).error, 'wrong pin'); assert.equal((await me(tokOf(A), '0001')).partner.code, 'ALFA'); });
  });
  test('S7 a paid order with the code: customer pays ₹699 (Digital) / ₹1,498 (NFC Basic + ₹99 shipping), partner earns exactly once', async () => {
    const d = await sale('ALFA', 1), m = await sale('ALFA', 2, 'basic', undefined, { product: 'nfc', ship: SHIP });
    assert.equal(Number(d.total), 699); assert.equal(Number(m.total), 1498);
    await pay(d.order_no); // paying again changes nothing
    const rows = (await db.query(`select amount from partner.commissions where order_no = any($1)`, [[d.order_no, m.order_no]])).rows;
    assert.deepEqual(rows.map(r => Number(r.amount)), [200, 200]);
  });
  test('S8 unpaid orders earn nothing', async () => {
    const o = await rpc('anon', 'place_order', [order({ coupon: 'ALFA', customer_email: 'unpaid@buyers.example', card: { slug: 'alfa-unpaid', first_name: 'U', phone: '9822299999' } })]);
    assert.equal((await one(`select count(*)::int as n from partner.commissions where order_no = $1`, [o.order_no])).n, 0);
  });
  test('S9 a custom commission (₹300) is used for that partner only', async () => {
    const o = await sale('BRAVO', 1);
    assert.equal(Number((await one(`select amount from partner.commissions where order_no = $1`, [o.order_no])).amount), 300);
  });
  test('S10 the same customer buying again gets the discount again and the partner earns again', async () => {
    const a = await sale('ALFA', 3, 'basic', 'repeat@buyers.example'), b = await sale('ALFA', 4, 'basic', 'repeat@buyers.example');
    assert.equal(Number(b.total), 699);
    assert.equal((await one(`select count(*)::int as n from partner.commissions where order_no = any($1)`, [[a.order_no, b.order_no]])).n, 2);
  });
  test('S11 the partner buying with their own code earns too', async () => {
    const o = await sale('ALFA', 5, 'basic', 'alfa@partners.example');
    assert.equal((await one(`select status from partner.commissions where order_no = $1`, [o.order_no])).status, 'pending');
  });
  test('S12 partner page shows only first names: no surname, email, phone, card link or order details of customers', async () => {
    await withWorker(async () => {
      const d = await me(tokOf(A), '0001'), s = JSON.stringify(d);
      assert.ok(d.commissions.every(c => c.customer === 'Asha'));
      for (const leak of ['Verma', '@buyers.example', '98222', 'alfa-b', 'repeat@']) assert.ok(!s.includes(leak), 'leaked ' + leak);
      assert.deepEqual(Object.keys(d.commissions[0]).sort(), ['amount', 'customer', 'kind', 'order', 'paid_at', 'payable_after', 'plan', 'reason', 'status']);
    });
  });
  test('S13 one partner never sees another partner\'s sales', async () => {
    await withWorker(async () => {
      const a = await me(tokOf(A), '0001'), b = await me(tokOf(B), '0002');
      assert.equal(b.commissions.length, 1); assert.ok(a.commissions.every(c => Number(c.amount) === 200));
    });
  });
  test('S14 the partner UPI ID comes back masked; the full one only on the admin payout sheet', async () => {
    await withWorker(async () => {
      await anonWithHeaders(W, `select public.partner_set_payout_token($1, '0001', $2)`, [tokOf(A), { upi_id: 'alfa.pay@okaxis' }]);
      const d = await me(tokOf(A), '0001'); assert.equal(d.payout_details.upi, 'al•••@okaxis'); assert.ok(!JSON.stringify(d).includes('alfa.pay'));
    });
  });
  test('S15 a partner cannot change another partner\'s payout details', async () => {
    await withWorker(async () => { assert.equal((await anonWithHeaders(W, `select public.partner_set_payout_token($1, '0001', $2) as r`, [tokOf(B), { upi_id: 'thief@okaxis' }]))[0].r.error, 'wrong pin'); });
    assert.notEqual((await one(`select upi_id from partner.payout_details where partner_id = $1`, [await idOf('BRAVO')])).upi_id, 'thief@okaxis');
  });
  test('S16 nothing is payable before 15 days', async () => {
    assert.equal((await one(`select count(*)::int as n from partner.commissions c join partner.partners p on p.id = c.partner_id where p.code = 'ALFA' and c.status = 'approved'`)).n, 0);
    assert.equal(Number((await one(`select hold_days from partner.settings`)).hold_days), 15);
  });
  test('S17 a refund inside the 15 days cancels the commission (never paid)', async () => {
    const o = await sale('ALFA', 6);
    await db.query(`update orders set pay_status = 'refunded' where order_no = $1`, [o.order_no]);
    assert.equal((await one(`select status from partner.commissions where order_no = $1`, [o.order_no])).status, 'reversed');
  });
  test('S18 month-end payout pays each approved sale once; preparing twice does not double it', async () => {
    await due();
    await rpc('authenticated', 'admin_payouts_prepare', ['2026-12'], ADM); const p = await rpc('authenticated', 'admin_payouts_prepare', ['2026-12'], ADM);
    const alfa = p.find(x => x.partner_id === A.partner_id);
    assert.equal(Number(alfa.gross), 5 * 200, '5 paid sales (one refunded sale excluded)');
    assert.equal((await one(`select count(*)::int as n from partner.payouts where partner_id = $1 and status <> 'paid'`, [A.partner_id])).n, 1);
  });
  test('S19 below ₹500 rolls over: BRAVO (₹300) gets no payout yet', async () => {
    assert.equal((await one(`select count(*)::int as n from partner.payouts where partner_id = $1`, [B.partner_id])).n, 0);
  });
  test('S20 mark paid needs a reference and works once; the sales become paid', async () => {
    const id = (await one(`select id from partner.payouts where partner_id = $1 and status = 'scheduled'`, [A.partner_id])).id;
    await assert.rejects(rpc('authenticated', 'admin_payout_mark_paid', [id, 'UPI', ' '], ADM), /reference required/);
    await rpc('authenticated', 'admin_payout_mark_paid', [id, 'UPI', 'UTR9001'], ADM);
    await assert.rejects(rpc('authenticated', 'admin_payout_mark_paid', [id, 'UPI', 'UTR9001'], ADM), /payout is paid/);
    assert.equal((await one(`select count(*)::int as n from partner.commissions where payout_id = $1 and status = 'paid'`, [id])).n, 5);
  });
  test('S21 a refund after payout is taken back from the next payout (−₹200), not paid twice', async () => {
    const no = (await one(`select order_no from partner.commissions where partner_id = $1 and status = 'paid' and kind = 'sale' limit 1`, [A.partner_id])).order_no;
    await db.query(`update orders set pay_status = 'refunded' where order_no = $1`, [no]);
    assert.equal(Number((await one(`select amount from partner.commissions where order_no = $1 and kind = 'clawback'`, [no])).amount), -200);
    await db.query(`update orders set pay_status = 'paid' where order_no = $1`, [no]); await db.query(`update orders set pay_status = 'refunded' where order_no = $1`, [no]);
    assert.equal((await one(`select count(*)::int as n from partner.commissions where order_no = $1 and kind = 'clawback'`, [no])).n, 1, 'one claw-back only');
  });
  test('S22 a paused partner: link stops counting, code gives no discount, page still opens', async () => {
    await rpc('authenticated', 'admin_partner_set', [await idOf('BRAVO'), 'paused', null, null], ADM);
    assert.equal((await rpc('anon', 'partner_click', ['bravo'])).ok, false);
    assert.equal((await rpc('anon', 'check_coupon', ['BRAVO', 'basic', 'IN', 'new@buyers.example'])).ok, false);
    await withWorker(async () => assert.equal((await me(tokOf(B), '0002')).ok, true));
  });
  test('S23 admin view of a partner equals what the partner sees', async () => {
    await withWorker(async () => {
      const mine = await me(tokOf(A), '0001'), adm = await rpc('authenticated', 'admin_partner_view', [A.partner_id], ADM);
      assert.deepEqual(adm.totals, mine.totals); assert.deepEqual(adm.commissions, mine.commissions);
    });
  });
  test('S24 US orders cannot use partner codes (India only), so no commission in dollars', async () => {
    assert.equal((await rpc('anon', 'check_coupon', ['ALFA', 'basic', 'US', 'us@buyers.example'])).ok, false);
  });
  test('S25 the free partner card never expires, has no order and so never earns commission', async () => {
    const c = await one(`select renewal, extras->>'partner_free' as f from cards where slug = 'alfa-card'`);
    assert.equal(String(c.renewal).slice(0, 4), '2099'); assert.equal(c.f, 'true');
    assert.equal((await one(`select count(*)::int as n from orders o join cards k on k.id = o.card_id where k.slug = 'alfa-card'`)).n, 0, 'no order, so no commission for the free card');
  });
}

// ---------- partner programme: data-leak checks (L1–L17) ----------
{
  const ADM = { id: ADMIN, email: 'admin@example.com' }, SECRET = 'l'.repeat(32), W = { 'x-nbr-secret': SECRET, 'cf-connecting-ip': '198.51.100.30' };
  const withWorker = async f => { await db.query(`insert into app_secrets values ('worker', $1) on conflict (key) do update set value = excluded.value`, [SECRET]); try { return await f(); } finally { await db.query(`delete from app_secrets where key = 'worker'`); } };
  const me = (tok, pin) => anonWithHeaders(W, `select public.partner_me_token($1, $2) as r`, [tok, pin]).then(x => x[0].r);
  let C, tok;
  // A test (not a before hook), so it runs here, after the earlier tests, instead of before all of them.
  test('L0 setup: a partner with one paid sale', async () => {
    C = await rpc('authenticated', 'admin_partner_create', [{ full_name: 'Charlie Lima', phone: '9844400001', email: 'charlie@partners.example', code: 'CHARLIE', handle: 'charlie-card', upi_id: 'charlie@okaxis' }], ADM);
    tok = C.partner_link.split('#')[1];
    const o = await rpc('anon', 'place_order', [order({ coupon: 'CHARLIE', customer_name: 'Neha Kapoor', customer_email: 'neha@buyers.example', customer_phone: '9855500001', card: { slug: 'neha-k', first_name: 'Neha', phone: '9855500001' } })]);
    await pay(o.order_no);
  });
  test('L1 partner page never returns the link key, PIN data, phone, admin notes or login id', async () => {
    await withWorker(async () => {
      const d = await me(tok, '0001'), s = JSON.stringify(d);
      for (const k of ['access_hash', 'pin_fails', 'locked_until', 'admin_note', 'user_id', 'card_id']) assert.ok(!s.includes(k), k);
      assert.ok(!s.includes(tok)); assert.ok(!s.includes('9844400001'), 'own phone not echoed');
    });
  });
  test('L2 admin partner list has no link keys or PIN state', async () => {
    const s = JSON.stringify(await rpc('authenticated', 'admin_partners', [], ADM));
    for (const k of ['access_hash', 'pin_fails', 'locked_until', tok]) assert.ok(!s.includes(k), k);
  });
  test('L3 the partner-page key and the card edit key are different secrets', async () => {
    assert.notEqual(C.partner_link.split('#')[1], C.edit_link.split('/e/')[1]);
  });
  test('L4 a rejected partner\'s link stops working', async () => {
    const p = await rpc('authenticated', 'admin_partner_create', [{ full_name: 'Delta Mike', phone: '9844400002', email: 'delta@partners.example', code: 'DELTA', handle: 'delta-card' }], ADM);
    await rpc('authenticated', 'admin_partner_set', [p.partner_id, 'rejected', null, null], ADM);
    await withWorker(async () => assert.rejects(me(p.partner_link.split('#')[1], '0002'), /invalid link/));
  });
  test('L5 unknown or paused codes are not counted as visits', async () => {
    const n = async () => (await one(`select count(*)::int as n from partner.clicks`)).n, before0 = await n();
    assert.equal((await rpc('anon', 'partner_click', ['nobody1'])).ok, false); assert.equal((await rpc('anon', 'partner_click', ['delta'])).ok, false);
    assert.equal(await n(), before0);
  });
  test('L6 "is this code free?" says only yes/no, never who has it', async () => {
    const r = await rpc('anon', 'partner_code_available', ['CHARLIE']);
    assert.deepEqual(Object.keys(r).sort(), ['available', 'code']); assert.equal(r.available, false);
  });
  test('L7 checking a partner code at checkout shows the discount, not the partner', async () => {
    const s = JSON.stringify(await rpc('anon', 'check_coupon', ['CHARLIE', 'basic', 'IN', 'someone@buyers.example']));
    for (const k of ['Charlie', 'Lima', 'charlie@', '9844400001']) assert.ok(!s.includes(k), k);
  });
  test('L8 placing an order with a partner code returns nothing about the partner', async () => {
    const o = await rpc('anon', 'place_order', [order({ coupon: 'CHARLIE', customer_email: 'l8@buyers.example', card: { slug: 'l8-card', first_name: 'L', phone: '9855500008' } })]);
    const s = JSON.stringify(o); for (const k of ['Charlie', 'charlie@', 'commission']) assert.ok(!s.includes(k), k);
  });
  test('L9 a bad UPI ID is refused and the saved one is kept', async () => {
    await withWorker(async () => {
      await assert.rejects(anonWithHeaders(W, `select public.partner_set_payout_token($1, '0001', $2)`, [tok, { upi_id: 'not a upi' }]), /check/);
      await anonWithHeaders(W, `select public.partner_set_payout_token($1, '0001', $2)`, [tok, { upi_id: '' }]);
    });
    assert.equal((await one(`select upi_id from partner.payout_details where partner_id = $1`, [C.partner_id])).upi_id, 'charlie@okaxis', 'empty fields never wipe');
  });
  test('L10 internal partner functions cannot be called from the API', async () => {
    for (const sql of [`select partner.by_token('x', '1')`, `select partner.set_payout(gen_random_uuid(), '{}'::jsonb)`, `select partner.me_json(p) from partner.partners p limit 1`]) {
      await assert.rejects(as('anon', sql), /permission denied/, sql);
      await assert.rejects(as('authenticated', sql, [], { id: STRANGER, email: 'x@example.com' }), /permission denied/, sql);
    }
  });
  test('L11 programme settings are not readable from the API', async () => {
    await assert.rejects(as('anon', `select * from partner.settings`), /permission denied/);
  });
  test('L12 the coupon list (all partner codes) is not readable from the API', async () => {
    await assert.rejects(as('anon', `select code from public.coupons`), /permission denied/);
    await assert.rejects(as('anon', `select * from public.coupon_redemptions`), /permission denied/);
  });
  test('L13 orders (customer names, emails, phones) are not readable from the API', async () => {
    await assert.rejects(as('anon', `select customer_email from public.orders`), /permission denied/);
    await assert.rejects(as('authenticated', `select customer_email from public.orders`, [], { id: STRANGER, email: 'x@example.com' }), /permission denied/);
  });
  test('L14 a public card shows its partner code but not that it is a free partner card', async () => {
    const r = (await as('anon', `select extras from public.public_card_extras where slug = 'charlie-card'`))[0];
    assert.equal(r.extras.partner_code, 'CHARLIE'); assert.equal(r.extras.partner_free, undefined);
  });
  test('L15 admin view of an unknown partner says not found', async () => {
    await assert.rejects(rpc('authenticated', 'admin_partner_view', ['00000000-0000-0000-0000-000000000000'], ADM), /partner not found/);
  });
  test('L16 a partner page lists only that partner\'s payouts', async () => {
    await withWorker(async () => { const d = await me(tok, '0001'); assert.ok((d.payouts || []).every(p => !('partner_id' in p))); assert.equal((d.payouts || []).length, 0); });
  });
  test('L17 a sale commission is never negative; only claw-backs are', async () => {
    assert.equal((await one(`select count(*)::int as n from partner.commissions where (kind = 'sale' and amount < 0) or (kind = 'clawback' and amount > 0)`)).n, 0);
  });
}

test('one-time prices: Digital ₹799 / $29, NFC ₹1,499 + ₹99 / ₹2,499 + ₹99, lifetime cards, Motion off, NFC India only', async () => {
  const d = await rpc('anon', 'place_order', [order({ customer_email: 'ot1@example.com', card: { slug: 'ot-digital', first_name: 'O', phone: '9811100001' } })]);
  assert.equal(Number(d.total), 799); assert.equal(Number(d.shipping), 0);
  const us = await rpc('anon', 'place_order', [order({ region: 'US', customer_email: 'ot2@example.com', customer_phone: '2025550101', card: { slug: 'ot-us', first_name: 'O', phone: '2025550101' } })]);
  assert.equal(Number(us.total), 29);
  const n = await rpc('anon', 'place_order', [order({ product: 'nfc', ship: SHIP, customer_email: 'ot3@example.com', card: { slug: 'ot-nfc', first_name: 'O', phone: '9811100003' } })]);
  assert.equal(Number(n.total), 1598); assert.equal(Number(n.shipping), 99);
  const c = await rpc('anon', 'place_order', [order({ product: 'nfc_custom', ship: SHIP, customer_email: 'ot4@example.com', card: { slug: 'ot-custom', first_name: 'O', phone: '9811100004' } })]);
  assert.equal(Number(c.total), 2598);
  const o = await one(`select product, shipping, ship->>'pin' as pin from orders where order_no = $1`, [c.order_no]);
  assert.deepEqual([o.product, Number(o.shipping), o.pin], ['nfc_custom', 99, '560001']);
  assert.equal(String((await one(`select renewal from cards where slug = 'ot-digital'`)).renewal).slice(0, 4), '2099', 'new cards never expire');
  assert.equal((await one(`select count(*)::int as n from cards where renewal < '2099-12-31'`)).n, 0, 'existing cards are lifetime too');
  const bad = async (over, msg) => { await assert.rejects(rpc('anon', 'place_order', [order({ customer_email: 'bad' + Math.random().toString(36).slice(2, 7) + '@example.com', card: { slug: 'ot-bad', first_name: 'O', phone: '9811100009' }, ...over })]), msg); };
  await bad({ plan: 'motion' }, /invalid order/);
  await bad({ product: 'nfc', ship: SHIP, region: 'US', customer_phone: '2025550109', card: { slug: 'ot-bad', first_name: 'O', phone: '2025550109' } }, /invalid order/);
  await bad({ product: 'nfc', ship: { ...SHIP, pin: '012345' } }, /invalid pin code/);
  await bad({ product: 'nfc', ship: { ...SHIP, line1: '' } }, /missing address/);
  await bad({ product: 'nfc' }, /missing address/);
  const chk = await rpc('anon', 'check_coupon', ['PRIYA', 'nfc', 'IN', 'ot5@example.com']);
  assert.deepEqual([chk.base, chk.discount, chk.shipping, chk.total].map(Number), [1499, 100, 99, 1498], 'partner ₹100 off the product, not the shipping');
  assert.equal((await rpc('anon', 'check_coupon', ['PRIYA', 'motion', 'IN', ''])).ok, false, 'Motion is off');
});
