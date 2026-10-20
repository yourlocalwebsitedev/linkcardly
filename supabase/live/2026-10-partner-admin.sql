-- Linkcardly, 2026-10: partners added by an admin (free Digital card, private partner-page link + PIN = last 4 digits
-- of their phone). Run once in Supabase → SQL Editor (staging first, then production), after 2026-10-partner-rules.sql
-- and 2026-10-prices.sql. Safe to run again. Already part of linkcardly.sql.
begin;

-- Everything the partner page shows, for one partner. Payout details come back masked. Reached through partner_me()
-- (email sign-in) or partner_me_token() (private link + PIN).
create or replace function partner.me_json(p partner.partners) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare d partner.payout_details; s partner.settings; v_fy date := partner.fy_start(now()); v_year numeric;
begin
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
revoke all on function partner.me_json(partner.partners) from public, anon, authenticated;

create or replace function public.partner_me() returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare p partner.partners;
begin
  select * into p from partner.partners where user_id = auth.uid();
  if not found then return jsonb_build_object('partner', null); end if;
  return partner.me_json(p);
end $$;
revoke all on function public.partner_me() from public, anon;
grant execute on function public.partner_me() to authenticated;

-- Partner updates where to be paid. Empty fields are left as they are.
create or replace function partner.set_payout(v_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = partner, public as $$
begin
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
revoke all on function partner.set_payout(uuid, jsonb) from public, anon, authenticated;

create or replace function public.partner_set_payout_details(p jsonb) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare v_id uuid;
begin
  select id into v_id from partner.partners where user_id = auth.uid();
  if v_id is null then raise exception 'not a partner'; end if;
  return partner.set_payout(v_id, p);
end $$;
revoke all on function public.partner_set_payout_details(jsonb) from public, anon;
grant execute on function public.partner_set_payout_details(jsonb) to authenticated;

-- ----------------------------------------------------------------
-- 6) PARTNERS ADDED BY AN ADMIN (2026-10): free Digital card + private partner-page link with a PIN
-- ----------------------------------------------------------------
-- An admin adds the partner (no self-signup needed). They get, in one step: an approved code (their ₹100 coupon),
-- a free Digital card that never expires (cards.renewal 2099-12-31: the column is NOT NULL, and no renewal reminder ever comes; extras.partner_code makes its
-- "Get a card like this" link /r/<code>), the card's edit link, and a private partner-page link. The page link's key
-- is stored only as a hash (like edit links); the PIN is the last 4 digits of the partner's phone. 5 wrong PINs lock
-- the link for 15 minutes. The Worker calls the page functions (from_worker()), never the browser directly.
alter table partner.partners add column if not exists card_id uuid references public.cards(id) on delete set null;
alter table partner.partners add column if not exists access_hash text;
alter table partner.partners add column if not exists pin_fails int not null default 0;
alter table partner.partners add column if not exists locked_until timestamptz;
create unique index if not exists partners_access_hash_key on partner.partners (access_hash) where access_hash is not null;

-- The partner a private link + PIN belongs to. Raises 'invalid link' or 'locked'; a wrong PIN returns null.
create or replace function partner.by_token(p_token text, p_pin text) returns partner.partners language plpgsql security definer set search_path = partner, public as $$
declare p partner.partners;
begin
  if not public.from_worker() then raise exception 'not allowed'; end if;
  perform public.rate_check('ptoken', 60, interval '1 hour');
  if coalesce(p_token, '') !~ '^[a-f0-9]{40}$' then raise exception 'invalid link'; end if;
  select * into p from partner.partners where access_hash = public.edit_hash_of(p_token) for update;
  if not found or p.status = 'rejected' then raise exception 'invalid link'; end if;
  if p.locked_until is not null and p.locked_until > now() then raise exception 'locked'; end if;
  -- Wrong PIN: count it and return no partner (raising would roll the count back).
  if coalesce(p_pin, '') <> right(partner.phone10(p.phone), 4) then
    update partner.partners set
      locked_until = case when pin_fails + 1 >= 5 then now() + interval '15 minutes' end,
      pin_fails = case when pin_fails + 1 >= 5 then 0 else pin_fails + 1 end
    where id = p.id;
    return null;
  end if;
  if p.pin_fails <> 0 or p.locked_until is not null then update partner.partners set pin_fails = 0, locked_until = null where id = p.id; end if;
  return p;
end $$;
revoke all on function partner.by_token(text, text) from public, anon, authenticated;

create or replace function public.partner_me_token(p_token text, p_pin text) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare p partner.partners; v jsonb;
begin
  p := partner.by_token(p_token, p_pin);
  if p.id is null then return jsonb_build_object('ok', false, 'error', 'wrong pin'); end if;
  v := partner.me_json(p);
  return v || jsonb_build_object('ok', true, 'card', (select jsonb_build_object('slug', c.slug, 'link', 'https://linkcardly.com/' || c.slug) from public.cards c where c.id = p.card_id));
end $$;
revoke all on function public.partner_me_token(text, text) from public;
grant execute on function public.partner_me_token(text, text) to anon, authenticated;

create or replace function public.partner_set_payout_token(p_token text, p_pin text, p jsonb) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare v partner.partners;
begin
  v := partner.by_token(p_token, p_pin);
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'wrong pin'); end if;
  return partner.set_payout(v.id, p);
end $$;
revoke all on function public.partner_set_payout_token(text, text, jsonb) from public;
grant execute on function public.partner_set_payout_token(text, text, jsonb) to anon, authenticated;

-- Admin: add a partner. p = { full_name, phone (India mobile), email, code, handle (their card link), upi_id?,
-- title?, photo_url?, commission? }. Returns the code, the card link and the two private links (shown once).
create or replace function public.admin_partner_create(p jsonb) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare s partner.settings; v_code text := upper(regexp_replace(coalesce(p->>'code', ''), '[^A-Za-z0-9]', '', 'g'));
        v_slug text := public.slug_clean(p->>'handle'); v_phone text := partner.phone10(p->>'phone');
        v_email text := lower(trim(coalesce(p->>'email', ''))); v_name text := left(trim(coalesce(p->>'full_name', '')), 80);
        v_first text; v_last text; v_id uuid; v_card uuid; v_edit text := public.new_edit_token(); v_access text := public.new_edit_token(); r partner.partners;
begin
  perform partner.require_admin();
  select * into s from partner.settings;
  if length(v_name) < 2 then raise exception 'name required'; end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'invalid phone'; end if;
  if v_email !~* '^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$' then raise exception 'invalid email'; end if;
  if exists (select 1 from partner.partners where lower(email) = v_email) then raise exception 'email already a partner'; end if;
  if v_code !~ '^[A-Z0-9]{4,20}$' or exists (select 1 from partner.partners where code = v_code) or exists (select 1 from public.coupons where code = v_code) then raise exception 'code taken'; end if;
  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$' then raise exception 'invalid link'; end if;
  if exists (select 1 from public.cards where slug = v_slug) then raise exception 'link taken'; end if;
  v_first := split_part(v_name, ' ', 1); v_last := trim(substr(v_name, length(v_first) + 1));
  insert into public.cards (region, layout, colour, preset, profession, slug, first_name, last_name, title, phone, whatsapp, email, photo_url,
    plan, renewal, active, show_powered_by, extras)
  values ('IN', 'original', 'forest', 'entrepreneur', 'Entrepreneur / Business owner', v_slug, left(v_first, 60), left(v_last, 60),
    left(coalesce(p->>'title', ''), 120), v_phone, v_phone, v_email,
    case when coalesce(p->>'photo_url', '') ~ '^https://img(-staging)?\.linkcardly\.com/p/[a-f0-9]{24}\.(webp|jpg|png|gif)$' then p->>'photo_url' else '' end,
    'basic', date '2099-12-31', true, true, jsonb_build_object('partner_code', v_code, 'partner_free', true))
  returning id into v_card;
  update public.cards set edit_hash = public.edit_hash_of(v_edit) where id = v_card;
  insert into partner.partners (status, full_name, email, phone, code, commission, terms_version, approved_at, card_id, access_hash, admin_note)
  values ('approved', v_name, v_email, v_phone, v_code, nullif(p->>'commission', '')::numeric, s.terms_version, now(), v_card,
    public.edit_hash_of(v_access), 'added by admin')
  returning * into r;
  insert into partner.payout_details (partner_id, upi_id) values (r.id, coalesce(nullif(trim(p->>'upi_id'), ''), ''));
  perform partner.sync_coupon(r);
  return jsonb_build_object('ok', true, 'partner_id', r.id, 'code', v_code, 'qr_link', 'https://linkcardly.com/r/' || lower(v_code),
    'card_link', 'https://linkcardly.com/' || v_slug, 'edit_link', 'https://linkcardly.com/e/' || v_edit,
    'partner_link', 'https://linkcardly.com/partner#' || v_access, 'pin', right(v_phone, 4));
end $$;
revoke all on function public.admin_partner_create(jsonb) from public, anon;
grant execute on function public.admin_partner_create(jsonb) to authenticated;

-- Admin: a new private partner-page link (the old one stops working), e.g. when a partner lost theirs.
create or replace function public.admin_partner_new_link(p_id uuid) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare v_access text := public.new_edit_token();
begin
  perform partner.require_admin();
  update partner.partners set access_hash = public.edit_hash_of(v_access), pin_fails = 0, locked_until = null where id = p_id;
  if not found then raise exception 'partner not found'; end if;
  return jsonb_build_object('ok', true, 'partner_link', 'https://linkcardly.com/partner#' || v_access);
end $$;
revoke all on function public.admin_partner_new_link(uuid) from public, anon;
grant execute on function public.admin_partner_new_link(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';

-- Check (should list admin_partner_create, admin_partner_new_link, partner_me_token, partner_set_payout_token):
select proname from pg_proc where proname in ('admin_partner_create', 'admin_partner_new_link', 'partner_me_token', 'partner_set_payout_token') order by 1;
