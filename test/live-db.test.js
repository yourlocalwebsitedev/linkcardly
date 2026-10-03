// The live database: supabase/live/ALL-IN-ONE.sql (from NexBizRise) + supabase/live/partners.sql, applied in an
// in-process Postgres (PGlite) with stand-ins for what Supabase provides (auth.uid/jwt, storage, API roles).
// Covers card link names and the partner programme end to end: apply → approve → order → paid → approved → payout.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const live = f => readFile(new URL('../supabase/live/' + f, import.meta.url), 'utf8');
const ADMIN = '00000000-0000-0000-0000-00000000000a';
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
  db = new PGlite({ extensions: { pgcrypto } });
  // Supabase stand-ins: API roles with default privileges, auth helpers, storage, and the base tables that existed before ALL-IN-ONE.sql.
  await db.exec(`
    create role anon; create role authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant execute on all functions in schema auth to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id bigserial primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.extension(name text) returns text language sql immutable as $$ select split_part(name, '.', -1) $$;
    create table public.admins (user_id uuid primary key);
    create table public.cards (id uuid primary key default gen_random_uuid(), slug text unique not null, prefix text, first_name text, last_name text, title text,
      company text, preset text, colour text, category text, tagline text, phone text, whatsapp text, email text, linkedin text, instagram text,
      website text, quote text, bio text, photo_url text, created_at timestamptz default now());
    insert into public.admins values ('${ADMIN}');`);
  await db.exec(await live('ALL-IN-ONE.sql'));
  await db.exec(await live('partners.sql'));
  await db.exec(await live('partners.sql')); // safe to run again
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
