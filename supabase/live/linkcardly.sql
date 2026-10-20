-- ================================================================
-- Linkcardly: partner programme + card link names, for the LIVE Supabase database
-- (the one set up by NexBizRise's supabase/ALL-IN-ONE.sql). Run it AFTER ALL-IN-ONE.sql:
-- Supabase → SQL Editor → paste all → Run. Safe to run again.
--
-- What it adds
--  S. Security fixes from the production audit: read-only public card views, no direct table writes for the
--     API roles, rate limits that can't be skipped with a header, payment only unpaid → paid, refunded cards
--     go offline, new orders follow the same field rules as edits, a real email on every order.
--  0. Test mode (off unless you switch it on; never on the production project).
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
--     A partner's code is also a normal ₹100 coupon (public.coupons), so checkout is unchanged. Any customer can use it
--     on every order (no per-email limit), and every paid order with it earns commission, the partner's own included.
--     When an order becomes paid (mark_order_paid), a trigger records the commission; refunds reverse it.
--  3. UPI (India): the customer's UPI reference (orders.upi_utr) through claim_upi_payment(); an admin then
--     confirms the credit with Mark paid. One UTR per order. (End of this file.)
--
-- Rules (change the constants in partner.settings below, not the code)
--   commission ₹200 per paid order · customer discount ₹100 · payable 15 days after payment (refund window is 14)
--   payouts monthly, minimum ₹500 · PAN required once a partner's earnings this financial year
--   pass ₹10,000 (no PAN or bank details needed before that, UPI is enough); from then on that partner's payouts are held until they add a PAN · TDS 2% (Section 194H) from then on,
--   on the whole year's commission. Check the TDS wording with your CA.
-- ================================================================

-- ----------------------------------------------------------------
-- S) SECURITY FIXES (production audit, 2026-10)
-- ----------------------------------------------------------------
-- Public card views are read-only. Supabase gives new relations INSERT/UPDATE/DELETE for the API roles by
-- default, and these simple views are updatable and run as their owner (bypassing RLS on cards), so without
-- this anyone with the public key could edit, create or delete cards. ALL-IN-ONE.sql now does the same.
revoke all on public.public_cards, public.public_card_extras from anon, authenticated;
grant select on public.public_cards, public.public_card_extras to anon, authenticated;

-- Tables are written only by SECURITY DEFINER functions (or by admins under RLS). Take away direct writes
-- the API roles never need, as a second lock behind RLS. Nobody edits the admins list through the API.
revoke insert, update, delete, truncate on public.admins, public.orders, public.leads, public.site_leads, public.rate_hits from anon;
revoke insert, update, delete, truncate on public.admins from authenticated;
-- Anonymous visitors never read or write the cards table itself: public cards come through the read-only views
-- above and every write goes through a SECURITY DEFINER function. RLS already hides the rows; this is the second
-- lock, so a policy mistake can't expose edit hashes, emails or unpaid cards. Admins (authenticated) keep RLS access.
revoke all on public.cards from anon;
-- Nor the admins list (who the admins are is not public).
revoke all on public.admins from anon;
-- Supabase's "Enable automatic RLS" option (new projects) adds public.rls_auto_enable(), which the API roles can
-- call. Nobody needs to call it; take that away when it exists.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- Rate limits: the x-nbr-ip header is trusted only when the request carries the worker secret. Before,
-- it was also trusted when no worker secret was set, which let any caller pick its own "IP" and skip limits.
create or replace function public.rate_check(p_bucket text, p_max int, p_window interval)
returns void language plpgsql security definer set search_path = public as $$
declare h json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
        v_ip text := case when coalesce(h->>'x-nbr-ip', '') <> '' and public.from_worker() then h->>'x-nbr-ip' else coalesce(h->>'cf-connecting-ip', split_part(h->>'x-forwarded-for', ',', 1), 'unknown') end;
begin
  delete from rate_hits where created_at < now() - interval '2 days';
  if (select count(*) from rate_hits where bucket = p_bucket and ip = v_ip and created_at > now() - p_window) >= p_max then
    raise exception 'too many requests';
  end if;
  insert into rate_hits (bucket, ip) values (p_bucket, v_ip);
end $$;
revoke all on function public.rate_check(text, int, interval) from public, anon, authenticated;

-- Payments: an order moves to paid only from unpaid. Same as ALL-IN-ONE.sql otherwise.
create or replace function public.mark_order_paid(p_order_no text, p_provider text, p_ref text, p_amount_minor bigint, p_currency text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; c record; v_first boolean := false; v_tok text := '';
begin
  if not from_worker() then raise exception 'not allowed'; end if;
  select * into o from orders where order_no = p_order_no for update;
  if not found then raise exception 'order not found'; end if;
  if upper(coalesce(p_currency, '')) <> o.currency then raise exception 'currency mismatch'; end if;
  if coalesce(p_amount_minor, 0) < round(coalesce(o.total, o.price) * 100) then raise exception 'amount mismatch'; end if;
  if o.pay_status = 'unpaid' then  -- only unpaid → paid: a refunded or waived order is never reactivated by a late or replayed webhook
    update orders set pay_status = 'paid', paid_at = now(), pay_provider = left(coalesce(p_provider, ''), 20), pay_ref = left(coalesce(p_ref, ''), 120), amount_paid = p_amount_minor / 100.0 where id = o.id;
    if o.mode = 'builder' and o.card_id is not null then update cards set active = true where id = o.card_id; end if;
    -- Fresh private edit link for the "paid" email (the one made at checkout is never stored in plain text)
    if o.card_id is not null then v_tok := new_edit_token(); update cards set edit_hash = edit_hash_of(v_tok) where id = o.card_id; end if;
    v_first := true;
  end if;
  select slug, public_id into c from cards where id = o.card_id;
  return jsonb_build_object('ok', true, 'first', v_first, 'order_no', o.order_no, 'mode', o.mode, 'plan', o.plan, 'region', o.region, 'total', o.total, 'currency', o.currency,
    'customer_email', o.customer_email, 'customer_name', o.customer_name, 'customer_phone', o.customer_phone, 'notes', o.notes, 'slug', c.slug, 'public_id', c.public_id, 'edit_token', v_tok);
end $$;
revoke all on function public.mark_order_paid(text, text, text, bigint, text) from public;
grant execute on function public.mark_order_paid(text, text, text, bigint, text) to anon, authenticated;

-- Refunds: when an order is marked refunded (by an admin today, by refund webhooks later), its card goes offline.
create or replace function public.on_order_refunded() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pay_status = 'refunded' and old.pay_status is distinct from 'refunded' and new.card_id is not null then
    update cards set active = false where id = new.card_id;
  end if;
  return new;
end $$;
revoke all on function public.on_order_refunded() from public, anon, authenticated;
drop trigger if exists orders_refund_card_off on public.orders;
create trigger orders_refund_card_off after update of pay_status on public.orders for each row execute function public.on_order_refunded();

-- Website contact form (linkcardly.com contact and teams pages, through the Worker's /api/contact). Same as
-- ALL-IN-ONE.sql except the phone is optional (the form doesn't require one); if given, it must be 10-15 digits.
create or replace function public.submit_site_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_phone text := left(regexp_replace(coalesce(p->>'phone',''), '[^0-9+]', '', 'g'), 20); v_email text := lower(trim(coalesce(p->>'email','')));
begin
  perform bot_gate(); perform rate_check('site_lead', 5, interval '1 hour');
  if length(trim(coalesce(p->>'name',''))) < 2 or length(trim(coalesce(p->>'business_name',''))) < 2 then raise exception 'missing fields'; end if;
  if v_email !~* '^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$' then raise exception 'invalid email'; end if;
  if v_phone <> '' and length(regexp_replace(v_phone, '\D', '', 'g')) not between 10 and 15 then raise exception 'invalid phone'; end if;
  if length(trim(coalesce(p->>'message',''))) < 10 then raise exception 'missing fields'; end if;
  if (select count(*) from site_leads where email = v_email and created_at > now() - interval '1 day') >= 3 then raise exception 'too many'; end if;
  insert into site_leads (name, business_name, email, phone, business_type, website_url, message, preferred_contact, page)
  values (left(trim(p->>'name'), 120), left(trim(p->>'business_name'), 160), left(v_email, 200), v_phone, left(coalesce(p->>'business_type',''), 60),
    left(coalesce(p->>'website_url',''), 300), left(trim(p->>'message'), 2000), left(coalesce(p->>'preferred_contact_method',''), 20), left(coalesce(p->>'page',''), 80));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.submit_site_lead(jsonb) from public;
grant execute on function public.submit_site_lead(jsonb) to anon, authenticated;

-- Refund webhooks (Razorpay refund.processed, Stripe charge.refunded) mark a paid order refunded. Worker only;
-- only paid → refunded, so a replayed webhook changes nothing. The trigger above then takes the card offline and
-- the partner trigger reverses any commission.
create or replace function public.mark_order_refunded(p_order_no text, p_provider text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; c record;
begin
  if not from_worker() then raise exception 'not allowed'; end if;
  select * into o from orders where order_no = p_order_no for update;
  if not found then raise exception 'order not found'; end if;
  if o.pay_status <> 'paid' then return jsonb_build_object('ok', true, 'changed', false, 'pay_status', o.pay_status); end if;
  update orders set pay_status = 'refunded', notes = left(coalesce(notes, '') || case when coalesce(notes, '') = '' then '' else E'\n' end
    || 'Refunded via ' || left(coalesce(p_provider, ''), 20) || ' ' || left(coalesce(p_ref, ''), 120), 2000) where id = o.id;
  select slug, public_id into c from cards where id = o.card_id;   -- so the Worker can drop the card from its cache
  return jsonb_build_object('ok', true, 'changed', true, 'order_no', o.order_no, 'customer_email', o.customer_email, 'customer_name', o.customer_name,
    'slug', c.slug, 'public_id', c.public_id);
end $$;
revoke all on function public.mark_order_refunded(text, text, text) from public;
grant execute on function public.mark_order_refunded(text, text, text) to anon, authenticated;

-- Payment received outside the website (UPI, bank transfer) and marked by an admin on /admin. Worker only: the Worker
-- checks the admin's login first. Same effect as an online payment (mark_order_paid): unpaid → paid for the order's
-- own total, card live, fresh edit link for the "card is live" email.
create or replace function public.mark_order_paid_manual(p_order_no text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if not from_worker() then raise exception 'not allowed'; end if;
  select order_no, total, price, currency into o from orders where order_no = p_order_no;
  if not found then raise exception 'order not found'; end if;
  return mark_order_paid(o.order_no, 'manual', left(coalesce(nullif(trim(p_ref), ''), 'manual'), 120), round(coalesce(o.total, o.price) * 100)::bigint, o.currency);
end $$;
revoke all on function public.mark_order_paid_manual(text, text) from public;
grant execute on function public.mark_order_paid_manual(text, text) to anon, authenticated;

-- ----------------------------------------------------------------
-- 0) TEST MODE: payments and the bot check off, so the product can be tested end to end
-- ----------------------------------------------------------------
-- ON:   insert into public.app_flags (key) values ('test_mode') on conflict (key) do nothing;
-- OFF:  delete from public.app_flags where key = 'test_mode';
-- While ON: place_order skips the Turnstile/worker check (bot_gate) and marks every new order paid with
-- pay_provider = 'test' (amount 0), so the card goes live and partner commissions behave as on a real sale.
-- The order page must have PAYMENTS_ON = false (public/app/order.html). Before launch: turn it OFF, set
-- PAYMENTS_ON = true, and remove test orders (see supabase/live/README.md).
create table if not exists public.app_flags (key text primary key, at timestamptz not null default now());
alter table public.app_flags enable row level security;
revoke all on public.app_flags from anon, authenticated;
create or replace function public.test_mode() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_flags where key = 'test_mode') $$;
revoke all on function public.test_mode() from public, anon, authenticated;

-- Same as ALL-IN-ONE.sql, plus the test-mode exception.
create or replace function public.bot_gate() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if test_mode() then return; end if;
  if exists (select 1 from app_secrets where key = 'worker') and not from_worker() then raise exception 'bot check failed'; end if;
end $$;
revoke all on function public.bot_gate() from public, anon, authenticated;

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

-- New orders get the same field rules as edits (update_card_by_token): an explicit list of fields with
-- length limits and formats. Branding can't be switched off, and unknown fields are dropped.
create or replace function public.order_card_clean(c jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare x jsonb; n text := '^-?[0-9]+(\.[0-9]+)?$';
begin
  if jsonb_typeof(c) is distinct from 'object' then raise exception 'invalid card'; end if;
  x := case when jsonb_typeof(c->'extras') = 'object' then c->'extras' else '{}'::jsonb end;
  return jsonb_build_object(
    'slug', coalesce(c->>'slug', ''), 'region', coalesce(c->>'region', ''),
    'first_name', left(trim(coalesce(c->>'first_name', '')), 60), 'last_name', left(coalesce(c->>'last_name', ''), 60),
    'prefix', left(coalesce(c->>'prefix', ''), 10), 'title', left(coalesce(c->>'title', ''), 120), 'company', left(coalesce(c->>'company', ''), 120),
    'profession', left(coalesce(c->>'profession', ''), 60), 'profession_other', left(coalesce(c->>'profession_other', ''), 80),
    'city', left(coalesce(c->>'city', ''), 80), 'bio', left(coalesce(c->>'bio', ''), 1200), 'quote', left(coalesce(c->>'quote', ''), 300),
    'notes', left(coalesce(c->>'notes', ''), 2000), 'category', left(coalesce(c->>'category', ''), 60), 'tagline', left(coalesce(c->>'tagline', ''), 120),
    'phone', coalesce(c->>'phone', ''), 'whatsapp', coalesce(c->>'whatsapp', ''), 'email', coalesce(c->>'email', ''),
    'website', coalesce(c->>'website', ''), 'instagram', coalesce(c->>'instagram', ''), 'linkedin', coalesce(c->>'linkedin', ''),
    'photo_url', coalesce(c->>'photo_url', ''),
    'phone_display', left(regexp_replace(coalesce(c->>'phone_display', ''), '[^0-9+ ()-]', '', 'g'), 40),
    'colour', case when c->>'colour' ~ '^[a-z0-9-]{2,40}$' then c->>'colour' else 'forest' end,
    'layout', case when c->>'layout' in ('original', 'professional', 'luxuryEstate', 'estate', 'scene') then c->>'layout' else 'original' end,
    'preset', case when c->>'preset' ~ '^[A-Za-z]{2,30}$' then c->>'preset' else 'entrepreneur' end,
    'photo_x', case when c->>'photo_x' ~ n then least(100, greatest(0, (c->>'photo_x')::numeric)) else 50 end,
    'photo_y', case when c->>'photo_y' ~ n then least(100, greatest(0, (c->>'photo_y')::numeric)) else 50 end,
    'photo_zoom', case when c->>'photo_zoom' ~ n then least(3, greatest(0.6, (c->>'photo_zoom')::numeric)) else 1 end,
    'signature', '', 'titles', '', 'contact_photo_url', '', 'show_powered_by', true,
    'extras', jsonb_build_object(
      'brokerage', left(coalesce(x->>'brokerage', ''), 120), 'license_no', left(coalesce(x->>'license_no', ''), 40),
      'license_state', upper(left(coalesce(x->>'license_state', ''), 2)), 'office_address', left(coalesce(x->>'office_address', ''), 200),
      'facebook', safe_https(x->>'facebook', 500), 'x_url', safe_https(x->>'x_url', 200), 'listings_url', safe_https(x->>'listings_url', 500),
      'booking_url', safe_https(x->>'booking_url', 500), 'iabs_url', safe_https(x->>'iabs_url', 500), 'meeting_url', safe_https(x->>'meeting_url', 500),
      'greeting', left(coalesce(x->>'greeting', ''), 60), 'seasonal', coalesce(x->>'seasonal', 'true') <> 'false',
      'seasonal_addon', coalesce(x->>'seasonal_addon', 'false') = 'true', 'lead_capture', coalesce(x->>'lead_capture', 'false') = 'true',
      'reg_no', left(coalesce(x->>'reg_no', ''), 60), 'quals', left(coalesce(x->>'quals', ''), 120), 'hours', left(coalesce(x->>'hours', ''), 80),
      'services', left(coalesce(x->>'services', ''), 300), 'practice', left(coalesce(x->>'practice', ''), 200),
      'service_area', left(coalesce(x->>'service_area', ''), 120), 'insured', left(coalesce(x->>'insured', ''), 20),
      'emergency', left(coalesce(x->>'emergency', ''), 20), 'og_image', coalesce(x->>'og_image', '')));
end $$;

-- Edits (same as ALL-IN-ONE.sql) now also accept the estate and scene layouts and style ids with digits, so a
-- customer can switch their own card to a Real Estate, Home Services or Summit/Tide design.
create or replace function public.update_card_by_token(p_token text, p_card jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r cards; v jsonb := p_card; v_in jsonb; v_ex jsonb; v_photo text;
begin
  perform rate_check('edit_save', 30, interval '1 hour');
  if coalesce(p_token, '') !~ '^[a-f0-9]{40}$' then raise exception 'invalid link'; end if;
  select * into r from cards where edit_hash = edit_hash_of(p_token);
  if not found then raise exception 'invalid link'; end if;
  if r.renewal is not null and r.renewal::date < current_date - 15 then raise exception 'card expired'; end if;
  if jsonb_typeof(v) <> 'object' or length(v::text) > 3000000 then raise exception 'invalid card'; end if;
  if coalesce(trim(v->>'first_name'), '') = '' or length(regexp_replace(coalesce(v->>'phone', ''), '\D', '', 'g')) < 7 then raise exception 'missing fields'; end if;
  v_in := case when jsonb_typeof(v->'extras') = 'object' then v->'extras' else '{}'::jsonb end;
  v_ex := coalesce(r.extras, '{}'::jsonb) || jsonb_build_object(
    'brokerage', left(coalesce(v_in->>'brokerage', ''), 120), 'license_no', left(coalesce(v_in->>'license_no', ''), 40),
    'license_state', upper(left(coalesce(v_in->>'license_state', ''), 2)), 'office_address', left(coalesce(v_in->>'office_address', ''), 200),
    'facebook', safe_https(v_in->>'facebook', 500), 'x_url', safe_https(v_in->>'x_url', 200), 'listings_url', safe_https(v_in->>'listings_url', 500),
    'booking_url', safe_https(v_in->>'booking_url', 500), 'iabs_url', safe_https(v_in->>'iabs_url', 500),
    'greeting', left(coalesce(v_in->>'greeting', ''), 60), 'seasonal', coalesce(v_in->>'seasonal', 'true') <> 'false',
    'meeting_url', safe_https(v_in->>'meeting_url', 500), 'reg_no', left(coalesce(v_in->>'reg_no', ''), 60), 'quals', left(coalesce(v_in->>'quals', ''), 120), 'hours', left(coalesce(v_in->>'hours', ''), 80), 'services', left(coalesce(v_in->>'services', ''), 300), 'practice', left(coalesce(v_in->>'practice', ''), 200), 'service_area', left(coalesce(v_in->>'service_area', ''), 120), 'insured', left(coalesce(v_in->>'insured', ''), 20), 'emergency', left(coalesce(v_in->>'emergency', ''), 20));
  v_photo := case when coalesce(v->>'photo_url', '') = '' then ''
    when v->>'photo_url' = r.photo_url then r.photo_url
    when public.media_url_ok(v->>'photo_url') then v->>'photo_url'
    else r.photo_url end;
  v_ex := v_ex || jsonb_build_object('og_image', case when v_photo = '' then ''
    when public.media_url_ok(v_in->>'og_image', true) then v_in->>'og_image'
    when v_photo = r.photo_url then coalesce(r.extras->>'og_image', '') else '' end);
  update cards set
    first_name = left(trim(v->>'first_name'), 60), last_name = left(coalesce(v->>'last_name', ''), 60),
    title = left(coalesce(v->>'title', ''), 120), company = left(coalesce(v->>'company', ''), 120),
    profession = left(coalesce(v->>'profession', r.profession, ''), 60), city = left(coalesce(v->>'city', ''), 80),
    bio = left(coalesce(v->>'bio', ''), 1200),
    phone = left(regexp_replace(coalesce(v->>'phone', ''), '[^0-9+ ()-]', '', 'g'), 30),
    phone_display = left(regexp_replace(coalesce(v->>'phone_display', ''), '[^0-9+ ()-]', '', 'g'), 40),
    whatsapp = left(regexp_replace(coalesce(v->>'whatsapp', ''), '[^0-9+ ()-]', '', 'g'), 30),
    email = case when v->>'email' ~* '^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$' then left(v->>'email', 200) else '' end,
    website = case when v->>'website' ~* '^https?://[^\s<>"'']+$' then left(v->>'website', 500) else '' end,
    instagram = safe_https(v->>'instagram', 500), linkedin = safe_https(v->>'linkedin', 500),
    colour = case when v->>'colour' ~ '^[a-z0-9-]{2,40}$' then v->>'colour' else r.colour end,
    layout = case when v->>'layout' in ('original', 'professional', 'luxuryEstate', 'estate', 'scene') then v->>'layout' else r.layout end,
    preset = case when v->>'preset' ~ '^[A-Za-z]{2,30}$' then v->>'preset' else r.preset end,
    category = left(coalesce(v->>'category', r.category, ''), 60), tagline = left(coalesce(v->>'tagline', r.tagline, ''), 120),
    photo_url = v_photo,
    photo_x = least(100, greatest(0, coalesce((v->>'photo_x')::numeric, 50))),
    photo_y = least(100, greatest(0, coalesce((v->>'photo_y')::numeric, 50))),
    photo_zoom = least(3, greatest(0.6, coalesce((v->>'photo_zoom')::numeric, 1))),
    extras = v_ex, edited_at = now(), edit_seen = false
  where id = r.id;
  return jsonb_build_object('ok', true, 'slug', r.slug, 'public_id', r.public_id);
end $$;

-- Public order entry point (replaces the one in ALL-IN-ONE.sql; place_order_core is unchanged).
create or replace function public.place_order(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_slug text := slug_clean(payload->'card'->>'slug'); v_res jsonb; v_card uuid; v_mode text;
begin
  perform bot_gate();
  perform rate_check('order', 20, interval '1 hour');
  -- A real email is required: it's where the edit link and receipt go, and coupons are limited per email.
  if coalesce(payload->>'customer_email', '') !~* '^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$' then raise exception 'invalid email'; end if;
  payload := payload || jsonb_build_object('card', order_card_clean(payload->'card'));
  -- place_order_core adds two random digits to a taken name; once a name has 80 of those, use four.
  if coalesce(payload->>'strict_slug', '') <> 'true' and v_slug <> ''
     and (select count(*) from cards where slug ~ ('^' || v_slug || '[0-9]{2}$')) >= 80 then
    v_slug := left(v_slug, 34) || lpad(floor(random() * 10000)::int::text, 4, '0');
    payload := jsonb_set(payload, '{card,slug}', to_jsonb(v_slug));
  end if;
  if v_slug <> '' then
    perform release_stale_slug(v_slug);
    -- The customer picked this exact name: say it's taken instead of adding digits (a retry of the same order is fine).
    if coalesce(payload->>'strict_slug', '') = 'true' and exists (select 1 from cards where slug = v_slug)
       and not exists (select 1 from orders o where o.idem is not null and o.idem = payload->>'idem') then
      raise exception 'link taken';
    end if;
  end if;
  v_res := place_order_core(payload);
  -- Test mode: no payment step, so the order counts as paid now (provider 'test').
  if test_mode() and v_res->>'pay_status' = 'unpaid' then
    update orders set pay_status = 'paid', paid_at = now(), pay_provider = 'test', pay_ref = 'test', amount_paid = 0
      where order_no = v_res->>'order_no' returning card_id, mode into v_card, v_mode;
    if v_mode = 'builder' and v_card is not null then update cards set active = true where id = v_card; end if;
    v_res := v_res || jsonb_build_object('pay_status', 'paid', 'test', true);
  end if;
  return v_res;
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
  commission numeric not null default 200,        -- ₹ per paid order
  discount numeric not null default 100,          -- ₹ off for the customer (the partner's coupon)
  hold_days int not null default 15,              -- days after payment before a commission is payable
  min_payout numeric not null default 500,        -- smallest monthly payout
  pan_threshold numeric not null default 10000,   -- yearly earnings after which PAN is required
  tds_rate numeric not null default 0.02,         -- Section 194H
  terms_version text not null default '2026-10'
);
insert into partner.settings (id) values (true) on conflict (id) do nothing;
-- 2026-10: ₹200 and 15 days. Moves a database still on the first defaults; a value an admin changed is left alone.
update partner.settings set commission = 200 where commission = 100;
update partner.settings set hold_days = 15 where hold_days = 14;
update partner.settings set pan_threshold = 10000 where pan_threshold = 20000;

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
  partner_id uuid not null references partner.partners(id) on delete restrict,
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
  partner_id uuid not null references partner.partners(id) on delete restrict,
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
declare p partner.partners; s partner.settings; c partner.commissions;
begin
  if new.coupon is null or new.pay_provider = 'test' then return new; end if;
  select * into p from partner.partners where code = new.coupon;
  if not found then return new; end if;
  select * into s from partner.settings;
  if new.pay_status = 'paid' and (tg_op = 'INSERT' or old.pay_status is distinct from 'paid') then
    insert into partner.commissions (partner_id, order_no, kind, amount, status, reason, plan, order_total, paid_at, payable_after)
    values (p.id, new.order_no, 'sale', coalesce(p.commission, s.commission),
      'pending', '',
      coalesce(new.product, new.plan), new.total, coalesce(new.paid_at, now()), coalesce(new.paid_at, now()) + make_interval(days => s.hold_days))
    on conflict (order_no, kind) do nothing;
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
  values (p.code, 'amount', s.discount, 'IN', null, null, 100000, p.status = 'approved', 'partner:' || p.id)
  on conflict (code) do update set active = (p.status = 'approved'), value = s.discount, per_email = 100000, note = 'partner:' || p.id;
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
  return jsonb_build_object('code', v, 'available', not exists (select 1 from partner.partners where code = v));
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
    -- The customer's first name only. Nothing else about customers (surname, phone, email, card link) goes to partners.
    'commissions', coalesce((select jsonb_agg(jsonb_build_object('order', c.order_no, 'kind', c.kind, 'plan', c.plan, 'amount', c.amount, 'status', c.status,
        'reason', c.reason, 'paid_at', c.paid_at, 'payable_after', c.payable_after,
        'customer', (select left(split_part(trim(o.customer_name), ' ', 1), 30) from public.orders o where o.order_no = c.order_no)) order by c.created_at desc)
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
-- 5) ADMIN functions (signed-in admins only: public.admins)
-- ----------------------------------------------------------------
-- Signed-in admins (public.admins), or you in the Supabase SQL Editor. session_user is the login that opened the
-- connection: the website API always connects as "authenticator", the SQL Editor as "postgres". (current_user would be
-- wrong here: inside these SECURITY DEFINER functions it is always the owner.)
create or replace function partner.require_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin
  -- SQL Editor only: a postgres login with no API request on it. Every website call carries JWT claims (anon too).
  if session_user in ('postgres', 'supabase_admin') and coalesce(current_setting('request.jwt.claims', true), '') = ''
     and coalesce(current_setting('request.jwt.claim.sub', true), '') = '' and coalesce(current_setting('request.headers', true), '') = '' then return; end if;
  if not exists (select 1 from public.admins where user_id = auth.uid()) then raise exception 'not allowed'; end if;
end $$;

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

-- Admin: exactly what a partner sees on their page (partner.me_json), for one partner.
create or replace function public.admin_partner_view(p_id uuid) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare p partner.partners;
begin
  perform partner.require_admin();
  select * into p from partner.partners where id = p_id;
  if not found then raise exception 'partner not found'; end if;
  return partner.me_json(p) || jsonb_build_object('ok', true, 'card', (select jsonb_build_object('slug', c.slug, 'link', 'https://linkcardly.com/' || c.slug) from public.cards c where c.id = p.card_id));
end $$;
revoke all on function public.admin_partner_view(uuid) from public, anon;
grant execute on function public.admin_partner_view(uuid) to authenticated;

-- ----------------------------------------------------------------
-- UPI (India). The customer pays Linkcardly's UPI ID from any UPI app, then enters the 12-digit UPI reference
-- (UTR) on the order page (/api/pay/upi). The order stays unpaid: an admin finds that credit and presses
-- Mark paid (mark_order_paid_manual, the UTR is filled in). A UTR can belong to one order only.
-- ----------------------------------------------------------------
alter table public.orders add column if not exists upi_utr text;
alter table public.orders add column if not exists upi_claimed_at timestamptz;
create unique index if not exists orders_upi_utr_key on public.orders (upi_utr) where upi_utr is not null;

create or replace function public.claim_upi_payment(p_order_no text, p_idem text, p_utr text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; v_first boolean;
begin
  if not from_worker() then raise exception 'not allowed'; end if;
  if coalesce(p_utr, '') !~ '^[0-9]{12}$' then raise exception 'invalid utr'; end if;
  select * into o from orders where order_no = p_order_no and idem is not null and idem = p_idem for update;
  if not found then raise exception 'order not found'; end if;
  if o.pay_status <> 'unpaid' then return jsonb_build_object('ok', true, 'first', false, 'pay_status', o.pay_status); end if;
  if exists (select 1 from orders where upi_utr = p_utr and id <> o.id) then raise exception 'utr used'; end if;
  v_first := o.upi_utr is distinct from p_utr;
  update orders set upi_utr = p_utr, upi_claimed_at = now() where id = o.id;
  return jsonb_build_object('ok', true, 'first', v_first, 'pay_status', o.pay_status, 'order_no', o.order_no, 'total', o.total, 'currency', o.currency,
    'customer_name', o.customer_name, 'customer_email', o.customer_email, 'customer_phone', o.customer_phone);
end $$;
revoke all on function public.claim_upi_payment(text, text, text) from public;
grant execute on function public.claim_upi_payment(text, text, text) to anon, authenticated;

-- 2026-10: partner coupons have no real per-email limit (coupons.per_email is NOT NULL, so 100000 stands for unlimited; repeat customers keep the discount and the partner earns again).
update public.coupons set per_email = 100000 where note like 'partner:%' and per_email < 100000;


-- ----------------------------------------------------------------
-- 2026-10-17: one-time prices (docs/PRODUCT.md). Replaces the yearly plans priced in ALL-IN-ONE.sql.
-- Products: Digital Card (₹799 / $29), NFC Card Basic (₹1,499 / $59), NFC Card Custom (₹2,499 / $89); NFC ships in India only, ₹99.
-- plan_price() and shipping_fee() are the database's one source for prices; coupon_discount, check_coupon and
-- place_order_core read them. Motion Card is switched off for new orders (existing Motion cards keep working).
-- Every card is lifetime: renewal 2099-12-31 (the column is NOT NULL), so no renewal reminder goes out.
-- ----------------------------------------------------------------
create or replace function public.plan_price(p_product text, p_region text) returns numeric language sql immutable as $$
  select (case when p_region = 'IN' then (case p_product when 'nfc' then 1499 when 'nfc_custom' then 2499 else 799 end)
               else (case p_product when 'nfc' then 59 when 'nfc_custom' then 89 else 29 end) end)::numeric $$;
create or replace function public.shipping_fee(p_product text, p_region text) returns numeric language sql immutable as $$
  select (case when p_product in ('nfc', 'nfc_custom') and p_region = 'IN' then 99 else 0 end)::numeric $$;
revoke all on function public.plan_price(text, text) from public;
revoke all on function public.shipping_fee(text, text) from public;

alter table public.orders add column if not exists product text not null default 'digital';
alter table public.orders drop constraint if exists orders_product_check;
alter table public.orders add constraint orders_product_check check (product in ('digital', 'nfc', 'nfc_custom'));
alter table public.orders add column if not exists shipping numeric not null default 0;
alter table public.orders add column if not exists ship jsonb not null default '{}'::jsonb;  -- NFC delivery address: name, line1, line2, city, state, pin, phone
alter table public.coupons drop constraint if exists coupons_plan_check;
alter table public.coupons add constraint coupons_plan_check check (plan in ('basic', 'motion', 'digital', 'nfc', 'nfc_custom'));

alter table public.cards alter column renewal set default '2099-12-31';
update public.cards set renewal = '2099-12-31' where renewal < '2099-12-31';

-- p_plan is the product ('digital', 'nfc', 'nfc_custom'); 'basic' still means Digital for older callers. Coupons with
-- plan 'basic' apply to Digital. The discount is on the product price only, never on shipping.
create or replace function public.coupon_discount(p_code text, p_plan text, p_region text, p_email text, p_lock boolean default false)
returns numeric language plpgsql security definer set search_path = public as $$
declare c coupons; v_prod text := case when p_plan in ('nfc', 'nfc_custom') then p_plan else 'digital' end; v_base numeric;
begin
  v_base := plan_price(v_prod, p_region);
  if p_lock then select * into c from coupons where code = upper(trim(p_code)) for update;
  else select * into c from coupons where code = upper(trim(p_code)); end if;
  if c.code is null or not c.active
     or (c.starts_at is not null and now() < c.starts_at)
     or (c.expires_at is not null and now() > c.expires_at)
     or (c.region is not null and c.region <> p_region)
     or (c.plan is not null and c.plan <> v_prod and not (c.plan = 'basic' and v_prod = 'digital'))
     or (c.max_uses is not null and c.uses >= c.max_uses)
     or (coalesce(p_email,'') <> '' and (select count(*) from coupon_redemptions r where r.code = c.code and lower(r.email) = lower(trim(p_email))) >= c.per_email)
  then raise exception 'invalid coupon'; end if;
  return least(v_base, case when c.kind = 'percent' then round(v_base * c.value / 100) else c.value end);
end $$;
revoke all on function public.coupon_discount(text, text, text, text, boolean) from public, anon, authenticated;

create or replace function public.check_coupon(p_code text, p_plan text, p_region text, p_email text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_region text := case when p_region = 'IN' then 'IN' else 'US' end;
        v_prod text := case when p_plan in ('nfc', 'nfc_custom') then p_plan when p_plan in ('basic', 'digital') then 'digital' end;
        v_base numeric; v_disc numeric; v_ship numeric; v_tax numeric := 0;  -- no GST for now (no GSTIN yet)
begin
  perform rate_check('coupon', 15, interval '1 hour');
  if v_prod is null or coalesce(p_code,'') !~* '^[A-Z0-9_-]{4,32}$' then return jsonb_build_object('ok', false); end if;
  begin v_disc := coupon_discount(p_code, v_prod, v_region, left(coalesce(p_email,''), 200));
  exception when others then return jsonb_build_object('ok', false); end;
  v_base := plan_price(v_prod, v_region); v_ship := shipping_fee(v_prod, v_region);
  return jsonb_build_object('ok', true, 'code', upper(trim(p_code)), 'base', v_base, 'discount', v_disc, 'shipping', v_ship, 'tax', v_tax, 'total', v_base - v_disc + v_ship + v_tax);
end $$;
revoke all on function public.check_coupon(text, text, text, text) from public;
grant execute on function public.check_coupon(text, text, text, text) to anon, authenticated;

create or replace function public.place_order_core(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_card jsonb := payload->'card';
  v_base text := left(regexp_replace(lower(coalesce(v_card->>'slug','card')), '[^a-z0-9-]', '', 'g'), 38);
  v_slug text := v_base;
  v_no text := 'NBR-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  v_mode text := payload->>'mode';
  v_plan text := payload->>'plan';
  v_region text := case when payload->>'region' = 'IN' then 'IN' else 'US' end;
  v_price numeric;
  v_tax numeric;
  v_card_id uuid;
  v_ex jsonb;
  v_coupon text := nullif(upper(trim(coalesce(payload->>'coupon',''))), '');
  v_disc numeric := 0;
  v_pid text;
  v_tok text;
  v_product text := coalesce(nullif(payload->>'product', ''), 'digital');
  v_ship jsonb := '{}'::jsonb;
  v_ship_fee numeric := 0;
begin
  -- Same order sent twice (double tap, or retry after a dropped connection): return the first one instead of making a duplicate.
  if coalesce(payload->>'idem', '') ~ '^[a-f0-9-]{36}$' then
    declare p_prev record; begin
      select o.order_no, o.discount, o.total, o.pay_status, c.slug, c.public_id into p_prev from orders o left join cards c on c.id = o.card_id where o.idem = payload->>'idem';
      if found then return jsonb_build_object('order_no', p_prev.order_no, 'slug', p_prev.slug, 'public_id', p_prev.public_id, 'discount', p_prev.discount, 'total', p_prev.total, 'pay_status', p_prev.pay_status, 'repeat', true); end if;
    end;
  end if;
  -- Motion Card is switched off (2026-10); every product is a Digital Card ('basic') on the card itself.
  if v_mode not in ('builder','dfm') or v_plan is distinct from 'basic' or v_product not in ('digital','nfc','nfc_custom') then raise exception 'invalid order'; end if;
  if v_product <> 'digital' then
    if v_region <> 'IN' then raise exception 'invalid order'; end if;  -- NFC cards ship within India only
    v_ship := case when jsonb_typeof(payload->'ship') = 'object' then payload->'ship' else '{}'::jsonb end;
    v_ship := jsonb_build_object(
      'name',  left(trim(coalesce(v_ship->>'name', '')), 120),
      'line1', left(trim(coalesce(v_ship->>'line1', '')), 200),
      'line2', left(trim(coalesce(v_ship->>'line2', '')), 200),
      'city',  left(trim(coalesce(v_ship->>'city', '')), 80),
      'state', left(trim(coalesce(v_ship->>'state', '')), 80),
      'pin',   regexp_replace(coalesce(v_ship->>'pin', ''), '\D', '', 'g'),
      'phone', left(regexp_replace(coalesce(v_ship->>'phone', ''), '[^0-9+ ()-]', '', 'g'), 30));
    if v_ship->>'name' = '' or v_ship->>'line1' = '' or v_ship->>'city' = '' or v_ship->>'state' = '' then raise exception 'missing address'; end if;
    if v_ship->>'pin' !~ '^[1-9][0-9]{5}$' then raise exception 'invalid pin code'; end if;
    if v_ship->>'phone' <> '' and regexp_replace(v_ship->>'phone', '\D', '', 'g') !~ '^(91|0)?[6-9][0-9]{9}$' then raise exception 'invalid phone'; end if;
    v_ship_fee := shipping_fee(v_product, v_region);
  end if;
  if coalesce(v_card->>'first_name','') = '' or coalesce(v_card->>'phone','') = '' then raise exception 'missing fields'; end if;
  if length(payload::text) > 3000000 then raise exception 'payload too large'; end if;
  while exists (select 1 from cards where slug = v_slug) loop
    v_slug := v_base || (10 + floor(random() * 90))::int;
  end loop;
  v_card := v_card || jsonb_build_object('region', v_region, 'slug', v_slug, 'active', false, 'renewal', '2099-12-31'::date)  -- one-time price: the card never expires;

  -- Server-side input hardening (never trust the browser)
  v_ex := case when jsonb_typeof(v_card->'extras') = 'object' then v_card->'extras' else '{}'::jsonb end;
  v_ex := v_ex || jsonb_build_object(
    'facebook',     case when v_ex->>'facebook'     ~* '^https://[^\s<>"'']+$' then left(v_ex->>'facebook', 500)     else '' end,
    'x_url',        case when v_ex->>'x_url'        ~* '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,30}/?$' then v_ex->>'x_url' else '' end,
    'listings_url', case when v_ex->>'listings_url' ~* '^https://[^\s<>"'']+$' then left(v_ex->>'listings_url', 500) else '' end,
    'booking_url',  case when v_ex->>'booking_url'  ~* '^https://[^\s<>"'']+$' then left(v_ex->>'booking_url', 500)  else '' end,
    'iabs_url',     case when v_ex->>'iabs_url'     ~* '^https://[^\s<>"'']+$' then left(v_ex->>'iabs_url', 500)     else '' end);
  -- Business-specific fields (health, beauty, legal, trades, corporate)
  v_ex := v_ex || jsonb_build_object('meeting_url', case when v_ex->>'meeting_url' ~* '^https://[^\s<>"'']+$' then left(v_ex->>'meeting_url', 500) else '' end, 'reg_no', left(coalesce(v_ex->>'reg_no', ''), 60), 'quals', left(coalesce(v_ex->>'quals', ''), 120), 'hours', left(coalesce(v_ex->>'hours', ''), 80), 'services', left(coalesce(v_ex->>'services', ''), 300), 'practice', left(coalesce(v_ex->>'practice', ''), 200), 'service_area', left(coalesce(v_ex->>'service_area', ''), 120), 'insured', left(coalesce(v_ex->>'insured', ''), 20), 'emergency', left(coalesce(v_ex->>'emergency', ''), 20));
  -- Link-preview image (square JPG made in the browser from the photo or a video frame)
  v_ex := v_ex || jsonb_build_object('og_image', case when public.media_url_ok(v_ex->>'og_image', true) then v_ex->>'og_image' else '' end);
  v_card := v_card || jsonb_build_object(
    'extras', v_ex,
    'website',   case when v_card->>'website'   ~* '^https?://[^\s<>"'']+$' then left(v_card->>'website', 500)   else '' end,
    'instagram', case when v_card->>'instagram' ~* '^https://[^\s<>"'']+$'  then left(v_card->>'instagram', 500) else '' end,
    'linkedin',  case when v_card->>'linkedin'  ~* '^https://[^\s<>"'']+$'  then left(v_card->>'linkedin', 500)  else '' end,
    'photo_url', case when public.media_url_ok(v_card->>'photo_url') then v_card->>'photo_url' else '' end,
    'contact_photo_url', '',
    'email',     case when v_card->>'email' ~* '^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$' then left(v_card->>'email', 200) else '' end,
    'phone',     left(regexp_replace(coalesce(v_card->>'phone',''), '[^0-9+ ()-]', '', 'g'), 30),
    'whatsapp',  left(regexp_replace(coalesce(v_card->>'whatsapp',''), '[^0-9+ ()-]', '', 'g'), 30),
    'first_name', left(v_card->>'first_name', 60), 'last_name', left(coalesce(v_card->>'last_name',''), 60),
    'title', left(coalesce(v_card->>'title',''), 120), 'company', left(coalesce(v_card->>'company',''), 120),
    'tagline', left(coalesce(v_card->>'tagline',''), 120), 'category', left(coalesce(v_card->>'category',''), 60),
    'quote', left(coalesce(v_card->>'quote',''), 300), 'bio', left(coalesce(v_card->>'bio',''), 1200),
    'city', left(coalesce(v_card->>'city',''), 80), 'notes', left(coalesce(v_card->>'notes',''), 2000));
  if length(regexp_replace(v_card->>'phone', '\D', '', 'g')) < 7 then raise exception 'missing fields'; end if;
  -- Phone must be a real number for the order's country: India 10 digits (optionally 91/0), US 10 digits (optionally 1)
  declare d text := regexp_replace(v_card->>'phone', '\D', '', 'g'); begin
    if v_region = 'IN' and not (d ~ '^[6-9][0-9]{9}$' or d ~ '^91[6-9][0-9]{9}$' or d ~ '^0[6-9][0-9]{9}$') then raise exception 'invalid phone'; end if;
    if v_region = 'US' and not (d ~ '^[2-9][0-9]{9}$' or d ~ '^1[2-9][0-9]{9}$') then raise exception 'invalid phone'; end if;
  end;

  insert into cards (extras, region, layout, photo_x, photo_y, photo_zoom, phone_display, signature, titles, contact_photo_url, show_powered_by,
    profession, profession_other, city, notes, slug, prefix, first_name, last_name, title, company, preset, colour, category, tagline,
    phone, whatsapp, email, linkedin, instagram, website, quote, bio, photo_url, plan, renewal, active)
  select coalesce(v_card->'extras', '{}'::jsonb), r.region, r.layout, r.photo_x, r.photo_y, r.photo_zoom, r.phone_display, r.signature, r.titles, r.contact_photo_url, r.show_powered_by,
    r.profession, r.profession_other, r.city, r.notes, r.slug, r.prefix, r.first_name, r.last_name, r.title, r.company, r.preset, r.colour, r.category, r.tagline,
    r.phone, r.whatsapp, r.email, r.linkedin, r.instagram, r.website, r.quote, r.bio, r.photo_url, v_plan, r.renewal, r.active
  from jsonb_populate_record(null::cards, v_card) r
  returning id, public_id into v_card_id, v_pid;
  v_tok := new_edit_token();
  update cards set edit_hash = edit_hash_of(v_tok) where id = v_card_id;

  v_price := plan_price(v_product, v_region);
  if v_coupon is not null then
    v_disc := coupon_discount(v_coupon, v_product, v_region, left(coalesce(payload->>'customer_email',''), 200), true);  -- row lock: no double-spend under concurrency
    update coupons set uses = uses + 1 where code = v_coupon;
    insert into coupon_redemptions (code, order_no, email, discount) values (v_coupon, v_no, left(coalesce(payload->>'customer_email',''), 200), v_disc);
  end if;
  v_tax := 0;  -- Linkcardly: no GST for now (no GSTIN yet). Was 18% for India: round((v_price - v_disc) * 0.18)
  insert into orders (idem, order_no, mode, plan, region, price, tax, total, currency, customer_name, customer_email, customer_phone, notes, card, card_id, coupon, discount, product, shipping, ship)
  values (case when coalesce(payload->>'idem', '') ~ '^[a-f0-9-]{36}$' then payload->>'idem' end, v_no, v_mode, v_plan, v_region, v_price, v_tax, v_price - v_disc + v_ship_fee + v_tax,
    case when v_region = 'IN' then 'INR' else 'USD' end,
    left(payload->>'customer_name', 120), left(payload->>'customer_email', 200), left(payload->>'customer_phone', 40), left(payload->>'notes', 4000),
    v_card, v_card_id, v_coupon, v_disc, v_product, v_ship_fee, v_ship);

  -- 100% coupon (partners, sales agents, influencers): nothing to pay, so the order counts as paid now.
  if v_price - v_disc + v_ship_fee + v_tax <= 0 then
    update orders set pay_status = 'waived', paid_at = now(), pay_provider = 'coupon' where order_no = v_no;
    if v_mode = 'builder' then update cards set active = true where id = v_card_id; end if;
    return jsonb_build_object('order_no', v_no, 'slug', v_slug, 'public_id', v_pid, 'edit_token', v_tok, 'discount', v_disc, 'shipping', 0, 'total', 0, 'pay_status', 'waived');
  end if;
  return jsonb_build_object('order_no', v_no, 'slug', v_slug, 'public_id', v_pid, 'edit_token', v_tok, 'discount', v_disc, 'shipping', v_ship_fee, 'total', v_price - v_disc + v_ship_fee + v_tax, 'pay_status', 'unpaid');
end $$;
revoke all on function public.place_order_core(jsonb) from public, anon, authenticated;

-- Same as ALL-IN-ONE.sql, plus the product (for the checkout description).
create or replace function public.get_order_for_pay(p_order_no text, p_idem text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; c record;
begin
  if not from_worker() then raise exception 'not allowed'; end if;
  select * into o from orders where order_no = p_order_no and idem is not null and idem = p_idem;
  if not found then raise exception 'order not found'; end if;
  select slug, public_id into c from cards where id = o.card_id;
  return jsonb_build_object('order_no', o.order_no, 'mode', o.mode, 'plan', o.plan, 'product', o.product, 'region', o.region, 'total', o.total, 'currency', o.currency, 'pay_status', o.pay_status,
    'customer_email', o.customer_email, 'customer_phone', o.customer_phone, 'slug', c.slug, 'public_id', c.public_id);
end $$;
revoke all on function public.get_order_for_pay(text, text) from public;
grant execute on function public.get_order_for_pay(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
