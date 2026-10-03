-- ================================================================
-- Linkcardly: partner programme + card link names, for the LIVE Supabase database
-- (the one set up by NexBizRise's supabase/ALL-IN-ONE.sql). Run it AFTER ALL-IN-ONE.sql:
-- Supabase → SQL Editor → paste all → Run. Safe to run again.
--
-- What it adds
--  1. Card link names: slug_available() checks ALL cards (not just live ones), names held by
--     unpaid orders older than 24 hours are released, and place_order() refuses a taken name
--     ("link taken") when the order page asks for that exact name, instead of adding digits.
--  2. Partner programme in its own schema `partner`, which the website API cannot read directly.
--     Partners and admins reach it only through the functions at the end of this file.
--       partner.partners        one row per partner (login, status, code, commission)
--       partner.payout_details  UPI / bank / PAN, kept apart from the rest
--       partner.clicks          visits through linkcardly.com/r/<code>
--       partner.commissions     one row per paid order that used a partner code (+ refund claw-backs)
--       partner.payouts         monthly payouts, with TDS and "held: PAN needed"
--     A partner's code is also a normal ₹100 coupon (public.coupons), so checkout is unchanged.
--     When an order becomes paid (mark_order_paid), a trigger records the commission; refunds reverse it.
--
-- Rules (change the constants in partner.settings below, not the code)
--   commission ₹100 per paid order · customer discount ₹100 · payable 14 days after payment
--   payouts monthly, minimum ₹500 · PAN required once a partner's earnings this financial year
--   pass ₹20,000; until then that partner's payouts are held · TDS 2% (Section 194H) from then on,
--   on the whole year's commission. Check the TDS wording with your CA.
-- ================================================================

-- ----------------------------------------------------------------
-- 1) CARD LINK NAMES
-- ----------------------------------------------------------------
create or replace function public.slug_clean(t text) returns text language sql immutable as $$
  select left(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9-]', '', 'g'), 38) $$;

-- A card that never got paid for (unpaid order older than 24 hours, card not live) no longer holds its name.
create or replace function public.slug_is_stale(p_card uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from cards c where c.id = p_card and c.active is false)
     and exists (select 1 from orders o where o.card_id = p_card and o.pay_status = 'unpaid' and o.created_at < now() - interval '24 hours')
     and not exists (select 1 from orders o where o.card_id = p_card and o.pay_status in ('paid', 'waived')) $$;
revoke all on function public.slug_is_stale(uuid) from public, anon, authenticated;

create or replace function public.release_stale_slug(p_slug text) returns void language plpgsql security definer set search_path = public as $$
begin
  update cards c set slug = 'x' || substr(replace(c.id::text, '-', ''), 1, 15)
  where c.slug = p_slug and slug_is_stale(c.id);
end $$;
revoke all on function public.release_stale_slug(text) from public, anon, authenticated;

-- Public: is this link name free? Same answer the order will get. 120 checks per hour per connection.
create or replace function public.slug_available(p_slug text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v text := slug_clean(p_slug);
begin
  perform rate_check('slug', 120, interval '1 hour');
  if length(v) < 3 or v !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' or v ~ '--' then return jsonb_build_object('slug', v, 'available', false, 'reason', 'invalid'); end if;
  return jsonb_build_object('slug', v, 'available', not exists (select 1 from cards c where c.slug = v and not slug_is_stale(c.id)));
end $$;
revoke all on function public.slug_available(text) from public;
grant execute on function public.slug_available(text) to anon, authenticated;

-- Public order entry point (replaces the one in ALL-IN-ONE.sql; place_order_core is unchanged).
create or replace function public.place_order(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_slug text := slug_clean(payload->'card'->>'slug');
begin
  perform bot_gate();
  perform rate_check('order', 20, interval '1 hour');
  if v_slug <> '' then
    perform release_stale_slug(v_slug);
    -- The customer picked this exact name: say it's taken instead of adding digits (a retry of the same order is fine).
    if coalesce(payload->>'strict_slug', '') = 'true' and exists (select 1 from cards where slug = v_slug)
       and not exists (select 1 from orders o where o.idem is not null and o.idem = payload->>'idem') then
      raise exception 'link taken';
    end if;
  end if;
  return place_order_core(payload);
end $$;
revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- ----------------------------------------------------------------
-- 2) PARTNER PROGRAMME: tables (schema `partner`, not exposed to the website API)
-- ----------------------------------------------------------------
create schema if not exists partner;
revoke all on schema partner from public, anon, authenticated;

create table if not exists partner.settings (
  id boolean primary key default true check (id),
  commission numeric not null default 100,        -- ₹ per paid order
  discount numeric not null default 100,          -- ₹ off for the customer (the partner's coupon)
  hold_days int not null default 14,              -- refund window before a commission is payable
  min_payout numeric not null default 500,        -- smallest monthly payout
  pan_threshold numeric not null default 20000,   -- yearly earnings after which PAN is required
  tds_rate numeric not null default 0.02,         -- Section 194H
  terms_version text not null default '2026-10'
);
insert into partner.settings (id) values (true) on conflict (id) do nothing;

create table if not exists partner.partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,                              -- auth.users id (sign-in by email link)
  status text not null default 'applied' check (status in ('applied', 'approved', 'paused', 'rejected')),
  full_name text not null check (length(full_name) between 2 and 80),
  email text not null,
  phone text not null default '',
  instagram text not null default '',
  followers text not null default '',
  about text not null default '',
  code text unique check (code ~ '^[A-Z0-9]{4,20}$'),  -- also the coupon code; the link is /r/<lower(code)>
  commission numeric,                               -- null = partner.settings.commission
  terms_version text not null,
  terms_accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  admin_note text not null default ''
);
create unique index if not exists partners_email_key on partner.partners (lower(email));

create table if not exists partner.payout_details (
  partner_id uuid primary key references partner.partners(id) on delete cascade,
  upi_id text not null default '' check (upi_id = '' or upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,64}$'),
  bank_name text not null default '', account_name text not null default '',
  account_no text not null default '' check (account_no = '' or account_no ~ '^[0-9]{9,18}$'),
  ifsc text not null default '' check (ifsc = '' or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  pan text not null default '' check (pan = '' or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  pan_name text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists partner.clicks (
  id bigserial primary key,
  partner_id uuid not null references partner.partners(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists clicks_partner_at on partner.clicks (partner_id, at desc);

create table if not exists partner.payouts (
  id bigserial primary key,
  partner_id uuid not null references partner.partners(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),   -- month the payout is for
  gross numeric not null, tds numeric not null default 0, net numeric not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'held', 'paid')),
  hold_reason text not null default '',
  method text not null default '', reference text not null default '',
  created_at timestamptz not null default now(), paid_at timestamptz
);
create index if not exists payouts_partner on partner.payouts (partner_id, created_at desc);

create table if not exists partner.commissions (
  id bigserial primary key,
  partner_id uuid not null references partner.partners(id) on delete cascade,
  order_no text not null,
  kind text not null default 'sale' check (kind in ('sale', 'clawback')),
  amount numeric not null,                         -- negative for a claw-back
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'reversed', 'rejected')),
  reason text not null default '',
  plan text not null default '', order_total numeric,
  paid_at timestamptz, payable_after timestamptz,
  payout_id bigint references partner.payouts(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (order_no, kind)
);
create index if not exists commissions_partner on partner.commissions (partner_id, created_at desc);

revoke all on all tables in schema partner from public, anon, authenticated;
revoke all on all sequences in schema partner from public, anon, authenticated;

-- ----------------------------------------------------------------
-- 3) Commission bookkeeping (automatic)
-- ----------------------------------------------------------------
-- Digits of a phone number, last 10 (so +91 98765 43210 and 9876543210 match).
create or replace function partner.phone10(t text) returns text language sql immutable as $$
  select right(regexp_replace(coalesce(t, ''), '\D', '', 'g'), 10) $$;

-- On every order insert/update: a paid order with a partner code earns commission; a refund reverses it.
create or replace function partner.sync_commission() returns trigger language plpgsql security definer set search_path = partner, public as $$
declare p partner.partners; s partner.settings; c partner.commissions; v_self boolean;
begin
  if new.coupon is null then return new; end if;
  select * into p from partner.partners where code = new.coupon;
  if not found then return new; end if;
  select * into s from partner.settings;
  if new.pay_status = 'paid' and (tg_op = 'INSERT' or old.pay_status is distinct from 'paid') then
    v_self := lower(coalesce(new.customer_email, '')) = lower(p.email)
           or (partner.phone10(new.customer_phone) <> '' and partner.phone10(new.customer_phone) = partner.phone10(p.phone));
    insert into partner.commissions (partner_id, order_no, kind, amount, status, reason, plan, order_total, paid_at, payable_after)
    values (p.id, new.order_no, 'sale', coalesce(p.commission, s.commission),
      case when v_self then 'rejected' else 'pending' end, case when v_self then 'Own order' else '' end,
      new.plan, new.total, coalesce(new.paid_at, now()), coalesce(new.paid_at, now()) + make_interval(days => s.hold_days))
    on conflict (order_no, kind) do update set status = case when partner.commissions.status = 'reversed' then 'pending' else partner.commissions.status end, updated_at = now();
  elsif new.pay_status = 'refunded' and tg_op = 'UPDATE' and old.pay_status is distinct from 'refunded' then
    select * into c from partner.commissions where order_no = new.order_no and kind = 'sale';
    if found then
      if c.status in ('pending', 'approved') then
        update partner.commissions set status = 'reversed', reason = 'Order refunded', updated_at = now() where id = c.id;
      elsif c.status = 'paid' then  -- already paid out: take it back from the next payout
        insert into partner.commissions (partner_id, order_no, kind, amount, status, reason, plan, order_total, paid_at, payable_after)
        values (c.partner_id, c.order_no, 'clawback', -c.amount, 'approved', 'Order refunded after payout', c.plan, c.order_total, now(), now())
        on conflict (order_no, kind) do nothing;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_partner_commission on public.orders;
create trigger orders_partner_commission after insert or update of pay_status on public.orders
  for each row execute function partner.sync_commission();

-- Pending commissions become approved once the refund window has passed and the order is still paid.
create or replace function partner.approve_due() returns void language sql security definer set search_path = partner, public as $$
  update partner.commissions c set status = 'approved', updated_at = now()
  where c.status = 'pending' and c.payable_after <= now()
    and exists (select 1 from public.orders o where o.order_no = c.order_no and o.pay_status = 'paid') $$;

-- Indian financial year (April–March) that a date falls in.
create or replace function partner.fy_start(d timestamptz) returns date language sql immutable as $$
  select make_date(extract(year from d)::int - case when extract(month from d) < 4 then 1 else 0 end, 4, 1) $$;

-- Keep the partner's coupon in step with their status (approved = active).
create or replace function partner.sync_coupon(p partner.partners) returns void language plpgsql security definer set search_path = partner, public as $$
declare s partner.settings;
begin
  if p.code is null then return; end if;
  select * into s from partner.settings;
  insert into public.coupons (code, kind, value, region, plan, max_uses, per_email, active, note)
  values (p.code, 'amount', s.discount, 'IN', null, null, 1, p.status = 'approved', 'partner:' || p.id)
  on conflict (code) do update set active = (p.status = 'approved'), value = s.discount, note = 'partner:' || p.id;
end $$;

-- ----------------------------------------------------------------
-- 4) PUBLIC + PARTNER functions (the website calls these)
-- ----------------------------------------------------------------
-- Is a partner code free? (signup form) 60 checks per hour per connection.
create or replace function public.partner_code_available(p_code text) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare v text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  perform public.rate_check('pcode', 60, interval '1 hour');
  if v !~ '^[A-Z0-9]{4,20}$' then return jsonb_build_object('code', v, 'available', false, 'reason', 'Use 4 to 20 letters or numbers.'); end if;
  return jsonb_build_object('code', v, 'available', not exists (select 1 from partner.partners where code = v) and not exists (select 1 from public.coupons where code = v));
end $$;
revoke all on function public.partner_code_available(text) from public;
grant execute on function public.partner_code_available(text) to anon, authenticated;

-- A visit through linkcardly.com/r/<code>: counts the click and returns the code to apply at checkout.
create or replace function public.partner_click(p_code text) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare p partner.partners;
begin
  perform public.rate_check('pclick', 300, interval '1 hour');
  select * into p from partner.partners where code = upper(coalesce(p_code, '')) and status = 'approved';
  if not found then return jsonb_build_object('ok', false); end if;
  insert into partner.clicks (partner_id) values (p.id);
  return jsonb_build_object('ok', true, 'code', p.code);
end $$;
revoke all on function public.partner_click(text) from public;
grant execute on function public.partner_click(text) to anon, authenticated;

-- Signed-in user applies to the programme (one application per account / email).
create or replace function public.partner_apply(p jsonb) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare v_uid uuid := auth.uid(); v_email text := lower(coalesce(auth.jwt()->>'email', '')); v_code text; s partner.settings; v_id uuid;
begin
  if v_uid is null or v_email = '' then raise exception 'sign in first'; end if;
  perform public.rate_check('papply', 5, interval '1 hour');
  select * into s from partner.settings;
  if coalesce(p->>'terms_version', '') <> s.terms_version then raise exception 'accept the latest terms'; end if;
  if exists (select 1 from partner.partners where user_id = v_uid or lower(email) = v_email) then raise exception 'already applied'; end if;
  v_code := upper(regexp_replace(coalesce(p->>'code', ''), '[^A-Za-z0-9]', '', 'g'));
  if v_code !~ '^[A-Z0-9]{4,20}$' or exists (select 1 from partner.partners where code = v_code) or exists (select 1 from public.coupons where code = v_code) then raise exception 'code taken'; end if;
  if length(trim(coalesce(p->>'full_name', ''))) < 2 then raise exception 'name required'; end if;
  if partner.phone10(p->>'phone') !~ '^[6-9][0-9]{9}$' then raise exception 'invalid phone'; end if;
  insert into partner.partners (user_id, full_name, email, phone, instagram, followers, about, code, terms_version)
  values (v_uid, left(trim(p->>'full_name'), 80), v_email, partner.phone10(p->>'phone'),
    left(regexp_replace(lower(coalesce(p->>'instagram', '')), '[^a-z0-9._]', '', 'g'), 30), left(coalesce(p->>'followers', ''), 20),
    left(coalesce(p->>'about', ''), 500), v_code, s.terms_version)
  returning id into v_id;
  insert into partner.payout_details (partner_id) values (v_id);
  return jsonb_build_object('ok', true, 'status', 'applied', 'code', v_code);
end $$;
revoke all on function public.partner_apply(jsonb) from public, anon;
grant execute on function public.partner_apply(jsonb) to authenticated;

-- Everything the partner dashboard shows, for the signed-in partner only. Payout details come back masked.
create or replace function public.partner_me() returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare p partner.partners; d partner.payout_details; s partner.settings; v_fy date := partner.fy_start(now()); v_year numeric;
begin
  select * into p from partner.partners where user_id = auth.uid();
  if not found then return jsonb_build_object('partner', null); end if;
  perform partner.approve_due();
  select * into d from partner.payout_details where partner_id = p.id;
  select * into s from partner.settings;
  select coalesce(sum(amount), 0) into v_year from partner.commissions
    where partner_id = p.id and status in ('pending', 'approved', 'paid') and paid_at >= v_fy;
  return jsonb_build_object(
    'partner', jsonb_build_object('name', p.full_name, 'email', p.email, 'status', p.status, 'code', p.code,
      'link', 'https://linkcardly.com/r/' || lower(coalesce(p.code, '')), 'commission', coalesce(p.commission, s.commission), 'discount', s.discount, 'joined', p.created_at),
    'payout_details', jsonb_build_object(
      'upi', case when d.upi_id = '' then '' else left(d.upi_id, 2) || '•••@' || split_part(d.upi_id, '@', 2) end,
      'bank', case when d.account_no = '' then '' else d.bank_name || ' ••••' || right(d.account_no, 4) end,
      'pan', case when d.pan = '' then '' else left(d.pan, 2) || '•••••' || right(d.pan, 3) end),
    'rules', jsonb_build_object('hold_days', s.hold_days, 'min_payout', s.min_payout, 'pan_threshold', s.pan_threshold, 'tds_rate', s.tds_rate),
    'totals', (select jsonb_build_object(
        'clicks', (select count(*) from partner.clicks where partner_id = p.id),
        'clicks_30d', (select count(*) from partner.clicks where partner_id = p.id and at > now() - interval '30 days'),
        'orders', count(*) filter (where kind = 'sale' and status <> 'rejected'),
        'sales_value', coalesce(sum(order_total) filter (where kind = 'sale' and status in ('pending', 'approved', 'paid')), 0),
        'earned', coalesce(sum(amount) filter (where status in ('pending', 'approved', 'paid')), 0),
        'pending', coalesce(sum(amount) filter (where status = 'pending'), 0),
        'ready', coalesce(sum(amount) filter (where status = 'approved'), 0),
        'paid', coalesce(sum(amount) filter (where status = 'paid'), 0),
        'this_year', v_year,
        'pan_needed', v_year > s.pan_threshold and d.pan = '')
      from partner.commissions where partner_id = p.id),
    'commissions', coalesce((select jsonb_agg(jsonb_build_object('order', c.order_no, 'kind', c.kind, 'plan', c.plan, 'amount', c.amount, 'status', c.status,
        'reason', c.reason, 'paid_at', c.paid_at, 'payable_after', c.payable_after) order by c.created_at desc)
      from (select * from partner.commissions where partner_id = p.id order by created_at desc limit 100) c), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('period', o.period, 'gross', o.gross, 'tds', o.tds, 'net', o.net, 'status', o.status,
        'hold_reason', o.hold_reason, 'paid_at', o.paid_at, 'reference', o.reference) order by o.created_at desc)
      from partner.payouts o where o.partner_id = p.id), '[]'::jsonb));
end $$;
revoke all on function public.partner_me() from public, anon;
grant execute on function public.partner_me() to authenticated;

-- Partner updates where to be paid. Empty fields are left as they are.
create or replace function public.partner_set_payout_details(p jsonb) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare v_id uuid;
begin
  select id into v_id from partner.partners where user_id = auth.uid();
  if v_id is null then raise exception 'not a partner'; end if;
  perform public.rate_check('ppay', 10, interval '1 hour');
  update partner.payout_details set
    upi_id = coalesce(nullif(trim(p->>'upi_id'), ''), upi_id),
    bank_name = coalesce(nullif(left(trim(p->>'bank_name'), 60), ''), bank_name),
    account_name = coalesce(nullif(left(trim(p->>'account_name'), 80), ''), account_name),
    account_no = coalesce(nullif(regexp_replace(coalesce(p->>'account_no', ''), '\s', '', 'g'), ''), account_no),
    ifsc = coalesce(nullif(upper(trim(p->>'ifsc')), ''), ifsc),
    pan = coalesce(nullif(upper(trim(p->>'pan')), ''), pan),
    pan_name = coalesce(nullif(left(trim(p->>'pan_name'), 80), ''), pan_name),
    updated_at = now()
  where partner_id = v_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.partner_set_payout_details(jsonb) from public, anon;
grant execute on function public.partner_set_payout_details(jsonb) to authenticated;

-- ----------------------------------------------------------------
-- 5) ADMIN functions (signed-in admins only: public.admins)
-- ----------------------------------------------------------------
create or replace function partner.require_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin if not exists (select 1 from public.admins where user_id = auth.uid()) then raise exception 'not allowed'; end if; end $$;

create or replace function public.admin_partners() returns jsonb language plpgsql security definer set search_path = partner, public as $$
begin
  perform partner.require_admin();
  perform partner.approve_due();
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone, 'instagram', p.instagram, 'followers', p.followers,
      'about', p.about, 'status', p.status, 'code', p.code, 'commission', p.commission, 'created_at', p.created_at, 'note', p.admin_note,
      'has_upi', d.upi_id <> '', 'has_bank', d.account_no <> '', 'has_pan', d.pan <> '',
      'clicks', (select count(*) from partner.clicks k where k.partner_id = p.id),
      'orders', (select count(*) from partner.commissions c where c.partner_id = p.id and c.kind = 'sale' and c.status <> 'rejected'),
      'earned', (select coalesce(sum(amount), 0) from partner.commissions c where c.partner_id = p.id and c.status in ('pending', 'approved', 'paid')),
      'unpaid', (select coalesce(sum(amount), 0) from partner.commissions c where c.partner_id = p.id and c.status in ('pending', 'approved'))) as x
    from partner.partners p left join partner.payout_details d on d.partner_id = p.id) t), '[]'::jsonb);
end $$;
revoke all on function public.admin_partners() from public, anon;
grant execute on function public.admin_partners() to authenticated;

-- Approve, pause or reject a partner (and optionally give them a custom commission). Keeps their coupon in step.
create or replace function public.admin_partner_set(p_id uuid, p_status text, p_commission numeric default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare p partner.partners;
begin
  perform partner.require_admin();
  if p_status not in ('applied', 'approved', 'paused', 'rejected') then raise exception 'invalid status'; end if;
  update partner.partners set status = p_status, commission = coalesce(p_commission, commission), admin_note = coalesce(p_note, admin_note),
    approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) else approved_at end
  where id = p_id returning * into p;
  if not found then raise exception 'partner not found'; end if;
  perform partner.sync_coupon(p);
  return jsonb_build_object('ok', true, 'status', p.status, 'code', p.code);
end $$;
revoke all on function public.admin_partner_set(uuid, text, numeric, text) from public, anon;
grant execute on function public.admin_partner_set(uuid, text, numeric, text) to authenticated;

-- Build this month's payouts from every approved, not-yet-paid commission (safe to run again until you pay).
-- Below the minimum: carried to next month. Over the PAN threshold without a PAN: held.
create or replace function public.admin_payouts_prepare(p_period text default to_char(now(), 'YYYY-MM'))
returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare s partner.settings; r record; v_out jsonb := '[]'::jsonb; v_id bigint; v_fy date := partner.fy_start(now());
        v_year_gross numeric; v_year_tds numeric; v_tds numeric; v_pan text; v_status text; v_reason text;
begin
  perform partner.require_admin();
  if p_period !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'invalid period'; end if;
  select * into s from partner.settings;
  perform partner.approve_due();
  -- Rebuild: drop unpaid payouts and release their commissions.
  update partner.commissions set payout_id = null where payout_id in (select id from partner.payouts where status <> 'paid');
  delete from partner.payouts where status <> 'paid';
  for r in select c.partner_id, sum(c.amount) as gross from partner.commissions c join partner.partners p on p.id = c.partner_id
           where c.status = 'approved' and c.payout_id is null group by c.partner_id having sum(c.amount) >= s.min_payout loop
    select coalesce(sum(gross), 0), coalesce(sum(tds), 0) into v_year_gross, v_year_tds from partner.payouts
      where partner_id = r.partner_id and status = 'paid' and paid_at >= v_fy;
    select pan into v_pan from partner.payout_details where partner_id = r.partner_id;
    v_tds := 0; v_status := 'scheduled'; v_reason := '';
    if v_year_gross + r.gross > s.pan_threshold then
      if coalesce(v_pan, '') = '' then v_status := 'held'; v_reason := 'PAN needed: earnings this year pass ₹' || s.pan_threshold;
      else v_tds := greatest(0, round((v_year_gross + r.gross) * s.tds_rate) - v_year_tds); end if;
    end if;
    insert into partner.payouts (partner_id, period, gross, tds, net, status, hold_reason)
    values (r.partner_id, p_period, r.gross, v_tds, r.gross - v_tds, v_status, v_reason) returning id into v_id;
    update partner.commissions set payout_id = v_id where partner_id = r.partner_id and status = 'approved' and payout_id is null;
    v_out := v_out || jsonb_build_object('payout_id', v_id, 'partner_id', r.partner_id, 'gross', r.gross, 'tds', v_tds, 'net', r.gross - v_tds, 'status', v_status, 'hold_reason', v_reason);
  end loop;
  return v_out;
end $$;
revoke all on function public.admin_payouts_prepare(text) from public, anon;
grant execute on function public.admin_payouts_prepare(text) to authenticated;

-- Where to send a scheduled payout (full details, admins only).
create or replace function public.admin_payout_sheet() returns jsonb language plpgsql security definer set search_path = partner, public as $$
begin
  perform partner.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('payout_id', o.id, 'period', o.period, 'name', p.full_name, 'email', p.email, 'phone', p.phone,
      'gross', o.gross, 'tds', o.tds, 'net', o.net, 'status', o.status, 'hold_reason', o.hold_reason,
      'upi_id', d.upi_id, 'bank_name', d.bank_name, 'account_name', d.account_name, 'account_no', d.account_no, 'ifsc', d.ifsc, 'pan', d.pan, 'pan_name', d.pan_name) order by o.id)
    from partner.payouts o join partner.partners p on p.id = o.partner_id left join partner.payout_details d on d.partner_id = p.id
    where o.status <> 'paid'), '[]'::jsonb);
end $$;
revoke all on function public.admin_payout_sheet() from public, anon;
grant execute on function public.admin_payout_sheet() to authenticated;

-- After you've sent the money: mark the payout paid (with the UPI/bank reference).
create or replace function public.admin_payout_mark_paid(p_id bigint, p_method text, p_reference text)
returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare o partner.payouts;
begin
  perform partner.require_admin();
  select * into o from partner.payouts where id = p_id for update;
  if not found then raise exception 'payout not found'; end if;
  if o.status <> 'scheduled' then raise exception 'payout is %', o.status; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'reference required'; end if;
  update partner.payouts set status = 'paid', paid_at = now(), method = left(coalesce(p_method, ''), 20), reference = left(p_reference, 120) where id = p_id;
  update partner.commissions set status = 'paid', updated_at = now() where payout_id = p_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_payout_mark_paid(bigint, text, text) from public, anon;
grant execute on function public.admin_payout_mark_paid(bigint, text, text) to authenticated;

notify pgrst, 'reload schema';
