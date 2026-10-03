-- ================================================================
-- NexBizRise — COMPLETE database setup (latest). Paste ALL of this into
-- Supabase → SQL Editor → Run. Safe to run again any time.
-- Replaces: orders.sql, fix-colour-check.sql, security.sql
-- ================================================================

-- 0) Make sure the cards table has every column the order form and admin use (safe to re-run)
alter table public.cards
  add column if not exists layout text default 'original',
  add column if not exists region text default 'IN',
  add column if not exists notes text default '',
  add column if not exists plan text default 'basic',
  add column if not exists renewal date,
  add column if not exists active boolean default true,
  add column if not exists city text default '',
  add column if not exists profession text default '',
  add column if not exists profession_other text default '',
  add column if not exists phone_display text default '',
  add column if not exists signature text default '',
  add column if not exists titles text default '',
  add column if not exists contact_photo_url text default '',
  add column if not exists show_powered_by boolean default true,
  add column if not exists photo_x numeric default 50,
  add column if not exists photo_y numeric default 50,
  add column if not exists photo_zoom numeric default 1,
  add column if not exists extras jsonb not null default '{}'::jsonb;  -- per-profession fields (brokerage, license, listings, booking, office, lead_capture…)

-- Permanent card IDs for QR codes (/c/nbr_xxxxxx). Never change once set, so printed QRs keep working if the name link changes.
create or replace function public.new_public_id() returns text language plpgsql volatile set search_path = public as $$
declare v text;
begin
  loop
    v := 'nbr_' || substr(md5(gen_random_uuid()::text), 1, 6);
    exit when not exists (select 1 from public.cards where public_id = v);
  end loop;
  return v;
end $$;
alter table public.cards add column if not exists public_id text;
alter table public.cards alter column public_id set default public.new_public_id();
update public.cards set public_id = public.new_public_id() where public_id is null;
create unique index if not exists cards_public_id_key on public.cards (public_id);
create or replace function public.keep_public_id() returns trigger language plpgsql as $$
begin new.public_id := old.public_id; return new; end $$;
drop trigger if exists cards_keep_public_id on public.cards;
create trigger cards_keep_public_id before update on public.cards for each row when (old.public_id is not null) execute function public.keep_public_id();

-- Private edit links (/e/<token>): clients update their own card without logging in.
-- Only a SHA-256 hash of the link is stored, so a database leak can't be used to edit cards.
-- The link is shown once (order screen, or when an admin creates a new one) and stops working 15 days after expiry.
create or replace function public.edit_hash_of(t text) returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(t, ''), 'UTF8')), 'hex') $$;
create or replace function public.new_edit_token() returns text language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || left(replace(gen_random_uuid()::text, '-', ''), 8) $$;
alter table public.cards add column if not exists edit_hash text;
-- Changes made by our team this plan year (2 included on Digital, 4 on Motion). Reset it at renewal.
alter table public.cards add column if not exists changes_used int not null default 0;
alter table public.cards add column if not exists edited_at timestamptz;
alter table public.cards add column if not exists edit_seen boolean not null default true;
create unique index if not exists cards_edit_hash_key on public.cards (edit_hash);
do $$ begin  -- upgrade from plain edit_token (v60) if it exists
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cards' and column_name = 'edit_token') then
    execute 'update public.cards set edit_hash = public.edit_hash_of(edit_token) where edit_token is not null and edit_hash is null';
    execute 'alter table public.cards drop column edit_token';
  end if;
end $$;

-- Colour holds Personal colours and Professional/Luxury style ids (pro-*, lux-*)
alter table public.cards drop constraint if exists cards_colour_check;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  mode text not null check (mode in ('builder','dfm')),
  plan text not null check (plan in ('basic','motion')),
  region text not null default 'US' check (region in ('IN','US')),
  price numeric not null,
  currency text not null default 'USD',
  status text not null default 'new' check (status in ('new','in_progress','delivered')),
  customer_name text, customer_email text, customer_phone text, notes text,
  card jsonb not null,
  card_id uuid references public.cards(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.orders add column if not exists region text not null default 'US';
alter table public.orders add column if not exists tax numeric not null default 0;
alter table public.orders add column if not exists total numeric;
alter table public.orders add column if not exists coupon text;
alter table public.orders add column if not exists discount numeric not null default 0;
alter table public.orders add column if not exists idem text;
create unique index if not exists orders_idem_key on public.orders (idem) where idem is not null;
-- Payment (Stripe for US, Razorpay for India). Cards go live only after payment is confirmed.
alter table public.orders add column if not exists pay_status text not null default 'unpaid';
alter table public.orders drop constraint if exists orders_pay_status_check;
alter table public.orders add constraint orders_pay_status_check check (pay_status in ('unpaid','paid','refunded','waived'));
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists pay_provider text;
alter table public.orders add column if not exists pay_ref text;
alter table public.orders add column if not exists amount_paid numeric;
alter table public.orders enable row level security;
create index if not exists orders_created_idx on public.orders (created_at desc);
drop policy if exists "admins manage orders" on public.orders;
create policy "admins manage orders" on public.orders for all
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- ================================================================
-- RATE LIMITS by visitor IP (Cloudflare / proxy header)
-- ================================================================
create table if not exists public.rate_hits (
  id bigserial primary key, bucket text not null, ip text not null, created_at timestamptz not null default now());
create index if not exists rate_hits_idx on public.rate_hits (bucket, ip, created_at desc);
alter table public.rate_hits enable row level security;  -- no policies: nobody can read it from the site

create or replace function public.rate_check(p_bucket text, p_max int, p_window interval)
returns void language plpgsql security definer set search_path = public as $$
declare h json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
        v_ip text := case when coalesce(h->>'x-nbr-ip', '') <> '' and (public.from_worker() or not exists (select 1 from public.app_secrets where key = 'worker')) then h->>'x-nbr-ip' else coalesce(h->>'cf-connecting-ip', split_part(h->>'x-forwarded-for', ',', 1), 'unknown') end;
begin
  delete from rate_hits where created_at < now() - interval '2 days';
  if (select count(*) from rate_hits where bucket = p_bucket and ip = v_ip and created_at > now() - p_window) >= p_max then
    raise exception 'too many requests';
  end if;
  insert into rate_hits (bucket, ip) values (p_bucket, v_ip);
end $$;
revoke all on function public.rate_check(text, int, interval) from public, anon, authenticated;

-- BOT CHECK (Turnstile). The website sends orders and leads through the site worker, which checks Turnstile
-- and adds a secret header. Switched OFF until you add the 'worker' row below (see setup notes).
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;  -- no policies: never readable from the site
revoke all on public.app_secrets from anon, authenticated;
create or replace function public.from_worker() returns boolean language plpgsql stable security definer set search_path = public as $$
declare h json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json; s text;
begin
  select value into s from app_secrets where key = 'worker';
  return s is not null and length(s) >= 24 and coalesce(h->>'x-nbr-secret', '') = s;
end $$;
revoke all on function public.from_worker() from public, anon, authenticated;
create or replace function public.bot_gate() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from app_secrets where key = 'worker') and not from_worker() then raise exception 'bot check failed'; end if;
end $$;
revoke all on function public.bot_gate() from public, anon, authenticated;
-- Turn ON (after the worker has NBR_WORKER_SECRET + TURNSTILE_SECRET): run once with the SAME secret:
--   insert into public.app_secrets values ('worker', 'PASTE-YOUR-NBR_WORKER_SECRET') on conflict (key) do update set value = excluded.value;
-- Turn OFF:  delete from public.app_secrets where key = 'worker';

-- Admin check used by the site worker for the analytics endpoint
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid()) $$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ================================================================
-- COUPONS (admin-managed). Prices and discounts are only ever computed here, never trusted from the browser.
-- ================================================================
create table if not exists public.coupons (
  code text primary key check (code ~ '^[A-Z0-9_-]{4,32}$'),
  kind text not null check (kind in ('percent','amount')),
  value numeric not null check (value > 0),
  region text check (region in ('IN','US')),             -- null = any region (percent only)
  plan text check (plan in ('basic','motion')),          -- null = any plan
  max_uses int check (max_uses is null or max_uses > 0), -- null = unlimited
  per_email int not null default 1 check (per_email > 0),
  uses int not null default 0,
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean not null default true,
  note text default '',
  created_at timestamptz not null default now(),
  constraint coupon_percent_range check (kind <> 'percent' or value <= 100),
  constraint coupon_amount_region check (kind <> 'amount' or region is not null)
);
alter table public.coupons enable row level security;
drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons" on public.coupons for all
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
revoke all on public.coupons from anon;

create table if not exists public.coupon_redemptions (
  id bigserial primary key,
  code text not null references public.coupons(code) on delete cascade,
  order_no text not null,
  email text not null default '',
  discount numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists coupon_redemptions_idx on public.coupon_redemptions (code, lower(email));
alter table public.coupon_redemptions enable row level security;
drop policy if exists "admins read redemptions" on public.coupon_redemptions;
create policy "admins read redemptions" on public.coupon_redemptions for select
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));
revoke all on public.coupon_redemptions from anon;

-- Internal: validate a coupon and return the discount on the base price. Same generic error for every failure (no hints for guessing).
create or replace function public.coupon_discount(p_code text, p_plan text, p_region text, p_email text, p_lock boolean default false)
returns numeric language plpgsql security definer set search_path = public as $$
declare c coupons; v_base numeric;
begin
  v_base := case when p_region = 'IN' then (case p_plan when 'motion' then 1799 else 799 end) else (case p_plan when 'motion' then 79 else 49 end) end;
  if p_lock then select * into c from coupons where code = upper(trim(p_code)) for update;
  else select * into c from coupons where code = upper(trim(p_code)); end if;
  if c.code is null or not c.active
     or (c.starts_at is not null and now() < c.starts_at)
     or (c.expires_at is not null and now() > c.expires_at)
     or (c.region is not null and c.region <> p_region)
     or (c.plan is not null and c.plan <> p_plan)
     or (c.max_uses is not null and c.uses >= c.max_uses)
     or (coalesce(p_email,'') <> '' and (select count(*) from coupon_redemptions r where r.code = c.code and lower(r.email) = lower(trim(p_email))) >= c.per_email)
  then raise exception 'invalid coupon'; end if;
  return least(v_base, case when c.kind = 'percent' then round(v_base * c.value / 100) else c.value end);
end $$;
revoke all on function public.coupon_discount(text, text, text, text, boolean) from public, anon, authenticated;

-- Public: preview a code at checkout. Rate limited to slow down guessing: 15 checks per hour per connection.
create or replace function public.check_coupon(p_code text, p_plan text, p_region text, p_email text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_region text := case when p_region = 'IN' then 'IN' else 'US' end;
        v_plan text := case when p_plan = 'motion' then 'motion' else 'basic' end;
        v_base numeric; v_disc numeric; v_tax numeric;
begin
  perform rate_check('coupon', 15, interval '1 hour');
  if coalesce(p_code,'') !~* '^[A-Z0-9_-]{4,32}$' then return jsonb_build_object('ok', false); end if;
  begin v_disc := coupon_discount(p_code, v_plan, v_region, left(coalesce(p_email,''), 200));
  exception when others then return jsonb_build_object('ok', false); end;
  v_base := case when v_region = 'IN' then (case v_plan when 'motion' then 1799 else 799 end) else (case v_plan when 'motion' then 79 else 49 end) end;
  v_tax := case when v_region = 'IN' then round((v_base - v_disc) * 0.18) else 0 end;
  return jsonb_build_object('ok', true, 'code', upper(trim(p_code)), 'base', v_base, 'discount', v_disc, 'tax', v_tax, 'total', v_base - v_disc + v_tax);
end $$;
revoke all on function public.check_coupon(text, text, text, text) from public;
grant execute on function public.check_coupon(text, text, text, text) to anon, authenticated;

-- ================================================================
-- ORDERS: public entry point. Creates the order AND its client card in one step.
-- Every card starts paused. Payment confirmed -> self-built cards go live; "design it for me" cards go live when delivered.
-- ================================================================
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
begin
  -- Same order sent twice (double tap, or retry after a dropped connection): return the first one instead of making a duplicate.
  if coalesce(payload->>'idem', '') ~ '^[a-f0-9-]{36}$' then
    declare p_prev record; begin
      select o.order_no, o.discount, o.total, o.pay_status, c.slug, c.public_id into p_prev from orders o left join cards c on c.id = o.card_id where o.idem = payload->>'idem';
      if found then return jsonb_build_object('order_no', p_prev.order_no, 'slug', p_prev.slug, 'public_id', p_prev.public_id, 'discount', p_prev.discount, 'total', p_prev.total, 'pay_status', p_prev.pay_status, 'repeat', true); end if;
    end;
  end if;
  if v_mode not in ('builder','dfm') or v_plan not in ('basic','motion') then raise exception 'invalid order'; end if;
  if coalesce(v_card->>'first_name','') = '' or coalesce(v_card->>'phone','') = '' then raise exception 'missing fields'; end if;
  if length(payload::text) > 3000000 then raise exception 'payload too large'; end if;
  while exists (select 1 from cards where slug = v_slug) loop
    v_slug := v_base || (10 + floor(random() * 90))::int;
  end loop;
  v_card := v_card || jsonb_build_object('region', v_region, 'slug', v_slug, 'active', false, 'renewal', (current_date + interval '1 year')::date);

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
  v_ex := v_ex || jsonb_build_object('og_image', case when coalesce(v_ex->>'og_image', '') ~ '^https://((img\.nexbizrise\.com|(www\.|card\.)?nexbizrise\.com/img)/p/[a-f0-9]{24}|hyaqvmrtqafqhbhcdecd\.supabase\.co/storage/v1/object/public/photos/orders/[A-Za-z0-9._-]+)\.jpg$' then v_ex->>'og_image' else '' end);
  v_card := v_card || jsonb_build_object(
    'extras', v_ex,
    'website',   case when v_card->>'website'   ~* '^https?://[^\s<>"'']+$' then left(v_card->>'website', 500)   else '' end,
    'instagram', case when v_card->>'instagram' ~* '^https://[^\s<>"'']+$'  then left(v_card->>'instagram', 500) else '' end,
    'linkedin',  case when v_card->>'linkedin'  ~* '^https://[^\s<>"'']+$'  then left(v_card->>'linkedin', 500)  else '' end,
    'photo_url', case when v_card->>'photo_url' ~ '^https://hyaqvmrtqafqhbhcdecd\.supabase\.co/storage/v1/object/public/photos/orders/[A-Za-z0-9._-]+$'
                        or v_card->>'photo_url' ~ '^https://(img\.nexbizrise\.com|(www\.|card\.)?nexbizrise\.com/img)/p/[a-f0-9]{24}\.(webp|jpg|png|gif|mp4|webm)$' then v_card->>'photo_url' else '' end,
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

  v_price := case when v_region = 'IN' then (case v_plan when 'motion' then 1799 else 799 end) else (case v_plan when 'motion' then 79 else 49 end) end;
  if v_coupon is not null then
    v_disc := coupon_discount(v_coupon, v_plan, v_region, left(coalesce(payload->>'customer_email',''), 200), true);  -- row lock: no double-spend under concurrency
    update coupons set uses = uses + 1 where code = v_coupon;
    insert into coupon_redemptions (code, order_no, email, discount) values (v_coupon, v_no, left(coalesce(payload->>'customer_email',''), 200), v_disc);
  end if;
  v_tax := case when v_region = 'IN' then round((v_price - v_disc) * 0.18) else 0 end;
  insert into orders (idem, order_no, mode, plan, region, price, tax, total, currency, customer_name, customer_email, customer_phone, notes, card, card_id, coupon, discount)
  values (case when coalesce(payload->>'idem', '') ~ '^[a-f0-9-]{36}$' then payload->>'idem' end, v_no, v_mode, v_plan, v_region, v_price, v_tax, v_price - v_disc + v_tax,
    case when v_region = 'IN' then 'INR' else 'USD' end,
    left(payload->>'customer_name', 120), left(payload->>'customer_email', 200), left(payload->>'customer_phone', 40), left(payload->>'notes', 4000),
    v_card, v_card_id, v_coupon, v_disc);

  -- 100% coupon (partners, sales agents, influencers): nothing to pay, so the order counts as paid now.
  if v_price - v_disc + v_tax <= 0 then
    update orders set pay_status = 'waived', paid_at = now(), pay_provider = 'coupon' where order_no = v_no;
    if v_mode = 'builder' then update cards set active = true where id = v_card_id; end if;
    return jsonb_build_object('order_no', v_no, 'slug', v_slug, 'public_id', v_pid, 'edit_token', v_tok, 'discount', v_disc, 'total', 0, 'pay_status', 'waived');
  end if;
  return jsonb_build_object('order_no', v_no, 'slug', v_slug, 'public_id', v_pid, 'edit_token', v_tok, 'discount', v_disc, 'total', v_price - v_disc + v_tax, 'pay_status', 'unpaid');
end $$;
revoke all on function public.place_order_core(jsonb) from public, anon, authenticated;

-- PAYMENTS: called only by the site worker (needs the 'worker' secret row in app_secrets).
-- The worker checks the Stripe/Razorpay signature, then calls this. Amount and currency must match the order.
create or replace function public.mark_order_paid(p_order_no text, p_provider text, p_ref text, p_amount_minor bigint, p_currency text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; c record; v_first boolean := false; v_tok text := '';
begin
  if not from_worker() then raise exception 'not allowed'; end if;
  select * into o from orders where order_no = p_order_no for update;
  if not found then raise exception 'order not found'; end if;
  if upper(coalesce(p_currency, '')) <> o.currency then raise exception 'currency mismatch'; end if;
  if coalesce(p_amount_minor, 0) < round(coalesce(o.total, o.price) * 100) then raise exception 'amount mismatch'; end if;
  if o.pay_status <> 'paid' then
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

-- Look up an order to start (or retry) payment. Needs the order number AND the browser's order key (idem).
create or replace function public.get_order_for_pay(p_order_no text, p_idem text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; c record;
begin
  if not from_worker() then raise exception 'not allowed'; end if;
  select * into o from orders where order_no = p_order_no and idem is not null and idem = p_idem;
  if not found then raise exception 'order not found'; end if;
  select slug, public_id into c from cards where id = o.card_id;
  return jsonb_build_object('order_no', o.order_no, 'mode', o.mode, 'plan', o.plan, 'region', o.region, 'total', o.total, 'currency', o.currency, 'pay_status', o.pay_status,
    'customer_email', o.customer_email, 'customer_phone', o.customer_phone, 'slug', c.slug, 'public_id', c.public_id);
end $$;
revoke all on function public.get_order_for_pay(text, text) from public;
grant execute on function public.get_order_for_pay(text, text) to anon, authenticated;

-- Production TODO: move photo data URLs into the "photos" storage bucket, add a bot check (Turnstile), email alert via Resend.

-- Let website orders upload their photo into photos/orders/ (images only; no read/update/delete for the public)
drop policy if exists "public order photo uploads" on storage.objects;
-- Public uploads to Supabase storage are OFF: website photos go to Cloudflare R2 through the site. Admins can still upload.
drop policy if exists "admins upload photos" on storage.objects;
create policy "admins upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and exists (select 1 from public.admins a where a.user_id = auth.uid())
    and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','gif'));

-- Stop the public from LISTING every uploaded photo (public URLs keep working because the bucket is public).
do $$ declare p record; begin
  for p in select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
      and (roles @> array['anon']::name[] or roles @> array['public']::name[])
      and coalesce(qual,'') ilike '%photos%'
  loop execute format('drop policy %I on storage.objects', p.policyname); end loop;
end $$;
drop policy if exists "admins read photos" on storage.objects;
create policy "admins read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- ================================================================
-- Real-estate extras + lead capture (safe to re-run)
-- ================================================================

-- Leads captured from "Share your contact" on a card
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references public.cards(id) on delete cascade,
  slug text not null,
  name text not null,
  phone text not null,
  email text default '',
  topic text default '',
  message text default '',
  source text default 'card',
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
create index if not exists leads_card_idx on public.leads (card_id, created_at desc);
alter table public.leads enable row level security;
drop policy if exists "admins manage leads" on public.leads;
create policy "admins manage leads" on public.leads for all
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- Public entry point for the lead form. Light rate limit: 5 per phone per card per day.
create or replace function public.submit_lead_core(p_slug text, p_name text, p_phone text, p_email text default '', p_topic text default '', p_message text default '', p_source text default 'card')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_card uuid; v_email text; v_owner text; v_phone text := left(regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'), 20);
begin
  select id, email, first_name into v_card, v_email, v_owner from cards where slug = lower(p_slug) and active is not false and coalesce((extras->>'lead_capture')::boolean, true);
  if v_card is null then raise exception 'card not found'; end if;
  if length(coalesce(trim(p_name),'')) = 0 or length(regexp_replace(v_phone, '\D', '', 'g')) < 7 then raise exception 'missing fields'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) not between 10 and 15 then raise exception 'invalid phone'; end if;
  if (select count(*) from leads where card_id = v_card and phone = v_phone and created_at > now() - interval '1 day') >= 5 then raise exception 'too many'; end if;
  insert into leads (card_id, slug, name, phone, email, topic, message, source)
  values (v_card, lower(p_slug), left(trim(p_name), 120), v_phone, left(coalesce(p_email,''), 200), left(coalesce(p_topic,''), 40), left(coalesce(p_message,''), 1000), left(coalesce(p_source,'card'), 40));
  return jsonb_build_object('ok', true, 'owner_email', coalesce(v_email, ''), 'owner_name', coalesce(v_owner, ''));
end $$;
revoke all on function public.submit_lead_core(text, text, text, text, text, text, text) from public, anon, authenticated;

-- Demo requests from the website contact form (nexbizrise.com/#/contact). Sent through the site worker.
create table if not exists public.site_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null, business_name text not null, email text not null, phone text not null,
  business_type text default '', website_url text default '', message text default '', preferred_contact text default '',
  page text default '', status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
create index if not exists site_leads_at_idx on public.site_leads (created_at desc);
alter table public.site_leads enable row level security;
drop policy if exists "admins manage site leads" on public.site_leads;
create policy "admins manage site leads" on public.site_leads for all
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
create or replace function public.submit_site_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_phone text := left(regexp_replace(coalesce(p->>'phone',''), '[^0-9+]', '', 'g'), 20); v_email text := lower(trim(coalesce(p->>'email','')));
begin
  perform bot_gate(); perform rate_check('site_lead', 5, interval '1 hour');
  if length(trim(coalesce(p->>'name',''))) < 2 or length(trim(coalesce(p->>'business_name',''))) < 2 then raise exception 'missing fields'; end if;
  if v_email !~* '^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$' then raise exception 'invalid email'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) not between 10 and 15 then raise exception 'invalid phone'; end if;
  if length(trim(coalesce(p->>'message',''))) < 10 then raise exception 'missing fields'; end if;
  if (select count(*) from site_leads where email = v_email and created_at > now() - interval '1 day') >= 3 then raise exception 'too many'; end if;
  insert into site_leads (name, business_name, email, phone, business_type, website_url, message, preferred_contact, page)
  values (left(trim(p->>'name'), 120), left(trim(p->>'business_name'), 160), left(v_email, 200), v_phone, left(coalesce(p->>'business_type',''), 60),
    left(coalesce(p->>'website_url',''), 300), left(trim(p->>'message'), 2000), left(coalesce(p->>'preferred_contact_method',''), 20), left(coalesce(p->>'page',''), 80));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.submit_site_lead(jsonb) from public;
grant execute on function public.submit_site_lead(jsonb) to anon, authenticated;


-- ================================================================
-- SECURITY + PUBLIC VIEWS
-- ================================================================
-- A) Public card view: only the fields the card page shows, only live cards
drop view if exists public.public_cards;
create view public.public_cards as
  select public_id, slug, region, layout, preset, colour, category, tagline,
         prefix, first_name, last_name, title, company,
         photo_url, contact_photo_url, photo_x, photo_y, photo_zoom,
         quote, bio, signature, titles,
         phone, phone_display, whatsapp, email, linkedin, instagram, website, city,
         show_powered_by
  from public.cards
  where active is not false;
grant select on public.public_cards to anon, authenticated;

drop view if exists public.public_card_extras;
create view public.public_card_extras as
  select public_id, slug, jsonb_strip_nulls(jsonb_build_object(
    'brokerage', extras->'brokerage', 'license_no', extras->'license_no', 'license_state', extras->'license_state',
    'facebook', extras->'facebook', 'x_url', extras->'x_url', 'listings_url', extras->'listings_url', 'booking_url', extras->'booking_url',
    'office_address', extras->'office_address', 'iabs_url', extras->'iabs_url', 'lead_capture', extras->'lead_capture',
    'seasonal', extras->'seasonal', 'seasonal_addon', extras->'seasonal_addon', 'greeting', extras->'greeting', 'motion', to_jsonb(plan = 'motion'),
    'meeting_url', extras->'meeting_url', 'reg_no', extras->'reg_no', 'quals', extras->'quals', 'hours', extras->'hours', 'services', extras->'services', 'practice', extras->'practice', 'service_area', extras->'service_area', 'insured', extras->'insured', 'emergency', extras->'emergency', 'og_image', extras->'og_image')) as extras
  from public.cards where active is not false;
grant select on public.public_card_extras to anon, authenticated;

-- B) Public entry points with limits.
-- Orders: 20 per hour per connection (a manager ordering for a team fits; bigger teams go through admin).
-- Leads: 10 per hour per connection.
drop function if exists public.place_order_limited(jsonb);
create or replace function public.place_order(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin perform bot_gate(); perform rate_check('order', 20, interval '1 hour'); return place_order_core(payload); end $$;
revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

create or replace function public.submit_lead(p_slug text, p_name text, p_phone text, p_email text default '', p_topic text default '', p_message text default '', p_source text default 'card')
returns jsonb language plpgsql security definer set search_path = public as $$
begin perform bot_gate(); perform rate_check('lead', 10, interval '1 hour'); return submit_lead_core(p_slug, p_name, p_phone, p_email, p_topic, p_message, p_source); end $$;
revoke all on function public.submit_lead(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_lead(text, text, text, text, text, text, text) to anon, authenticated;

-- C) Photo uploads: images only, 5 MB max
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
where id = 'photos';

-- D) Only safe link types stored on cards (https, tel, sms, mailto)
update public.cards set
  website   = case when website   ~* '^https?://' then website   else '' end,
  instagram = case when instagram ~* '^https?://' then instagram else '' end,
  linkedin  = case when linkedin  ~* '^https?://' then linkedin  else '' end
where coalesce(website,'') <> '' or coalesce(instagram,'') <> '' or coalesce(linkedin,'') <> '';

-- ================================================================
-- EDIT LINKS: clients update their own card from /e/<token>. Changes go live at once;
-- the Admin Panel flags the card as "Edited by client" until an admin opens it.
-- ================================================================
create or replace function public.safe_https(t text, n int) returns text language sql immutable as $$
  select case when t ~* '^https://[^\s<>"'']+$' then left(t, n) else '' end $$;

create or replace function public.get_card_for_edit(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r cards;
begin
  perform rate_check('edit_get', 60, interval '1 hour');
  if coalesce(p_token, '') !~ '^[a-f0-9]{40}$' then raise exception 'invalid link'; end if;
  select * into r from cards where edit_hash = edit_hash_of(p_token);
  if not found then raise exception 'invalid link'; end if;
  if r.renewal is not null and r.renewal::date < current_date - 15 then raise exception 'card expired'; end if;
  return jsonb_build_object('slug', r.slug, 'public_id', r.public_id, 'region', r.region, 'plan', r.plan, 'active', r.active,
    'profession', r.profession, 'colour', r.colour, 'layout', r.layout, 'category', r.category, 'tagline', r.tagline, 'preset', r.preset, 'first_name', r.first_name, 'last_name', r.last_name,
    'title', r.title, 'company', r.company, 'phone', r.phone, 'whatsapp', r.whatsapp, 'email', r.email, 'city', r.city,
    'website', r.website, 'instagram', r.instagram, 'linkedin', r.linkedin, 'bio', r.bio,
    'photo_url', r.photo_url, 'photo_x', r.photo_x, 'photo_y', r.photo_y, 'photo_zoom', r.photo_zoom, 'extras', coalesce(r.extras, '{}'::jsonb));
end $$;
revoke all on function public.get_card_for_edit(text) from public;
grant execute on function public.get_card_for_edit(text) to anon, authenticated;

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
    when v->>'photo_url' ~ '^https://hyaqvmrtqafqhbhcdecd\.supabase\.co/storage/v1/object/public/photos/orders/[A-Za-z0-9._-]+$'
      or v->>'photo_url' ~ '^https://(img\.nexbizrise\.com|(www\.|card\.)?nexbizrise\.com/img)/p/[a-f0-9]{24}\.(webp|jpg|png|gif|mp4|webm)$' then v->>'photo_url'
    else r.photo_url end;
  v_ex := v_ex || jsonb_build_object('og_image', case when v_photo = '' then ''
    when coalesce(v_in->>'og_image', '') ~ '^https://((img\.nexbizrise\.com|(www\.|card\.)?nexbizrise\.com/img)/p/[a-f0-9]{24}|hyaqvmrtqafqhbhcdecd\.supabase\.co/storage/v1/object/public/photos/orders/[A-Za-z0-9._-]+)\.jpg$' then v_in->>'og_image'
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
    colour = case when v->>'colour' ~ '^[a-z-]{2,30}$' then v->>'colour' else r.colour end,
    layout = case when v->>'layout' in ('original', 'professional', 'luxuryEstate') then v->>'layout' else r.layout end,
    preset = case when v->>'preset' ~ '^[A-Za-z]{2,30}$' then v->>'preset' else r.preset end,
    category = left(coalesce(v->>'category', r.category, ''), 60), tagline = left(coalesce(v->>'tagline', r.tagline, ''), 120),
    photo_url = v_photo,
    photo_x = least(100, greatest(0, coalesce((v->>'photo_x')::numeric, 50))),
    photo_y = least(100, greatest(0, coalesce((v->>'photo_y')::numeric, 50))),
    photo_zoom = least(3, greatest(1, coalesce((v->>'photo_zoom')::numeric, 1))),
    extras = v_ex, edited_at = now(), edit_seen = false
  where id = r.id;
  return jsonb_build_object('ok', true, 'slug', r.slug, 'public_id', r.public_id);
end $$;
revoke all on function public.update_card_by_token(text, jsonb) from public;
grant execute on function public.update_card_by_token(text, jsonb) to anon, authenticated;

-- Admin: make a new edit link for a card (old one stops working). Returns the link code once.
create or replace function public.admin_new_edit_link(p_card uuid) returns text
language plpgsql security definer set search_path = public as $$
declare t text := new_edit_token();
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then raise exception 'not allowed'; end if;
  update cards set edit_hash = edit_hash_of(t) where id = p_card;
  if not found then raise exception 'card not found'; end if;
  return t;
end $$;
revoke all on function public.admin_new_edit_link(uuid) from public, anon;
grant execute on function public.admin_new_edit_link(uuid) to authenticated;

-- RENEWAL REMINDERS: the nightly GitHub job asks the site for cards renewing in 30 / 7 / 0 days, and the site emails them.
-- Turn on once:  insert into public.app_secrets values ('cron', 'PASTE-YOUR-CRON_KEY') on conflict (key) do update set value = excluded.value;
drop function if exists public.renewal_due(text);
create or replace function public.renewal_due(p_key text)
returns table (r_first_name text, r_email text, r_slug text, r_public_id text, r_renewal date, r_days int)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from app_secrets s where s.key = 'cron' and length(s.value) >= 24 and s.value = coalesce(p_key, '')) then raise exception 'not allowed'; end if;
  return query select c.first_name, c.email, c.slug, c.public_id, c.renewal, (c.renewal - current_date)::int
    from cards c where c.renewal is not null and (c.renewal - current_date) in (30, 7, 0) and coalesce(c.email, '') <> '' and c.active is not false;
end $$;
revoke all on function public.renewal_due(text) from public;
grant execute on function public.renewal_due(text) to anon, authenticated;


-- ================================================================
-- OPTIONAL one-time cleanup (keeps only 3 cards). Remove the "-- " to run.
-- ================================================================
-- Deletes every card and order EXCEPT these three cards (and their orders).
-- Run once in Supabase → SQL Editor. Check the preview result first, then run the delete block.

-- 1) Preview: what will be deleted
-- select slug, first_name, last_name, plan, region from public.cards
-- where slug not in ('neeharika7747', 'swamy3649', 'sandeep3649')
-- order by slug;

-- 2) Delete (runs as one transaction)
-- begin;
-- delete from public.orders
-- where card_id is null
--    or card_id not in (select id from public.cards where slug in ('neeharika7747', 'swamy3649', 'sandeep3649'));
-- delete from public.cards
-- where slug not in ('neeharika7747', 'swamy3649', 'sandeep3649');
-- commit;

-- 3) Confirm: should list only the three kept cards
-- select slug, first_name, last_name from public.cards order by slug;

-- Refresh the API so new columns (public_id) show up immediately
notify pgrst, 'reload schema';


-- ADMIN LOG: who changed what (cards, coupons, orders, leads). Written automatically by the database; admins can read it.
create table if not exists public.admin_log (
  id bigserial primary key, at timestamptz not null default now(), user_id uuid, tbl text not null, action text not null, row_id text, before jsonb, after jsonb);
create index if not exists admin_log_at_idx on public.admin_log (at desc);
alter table public.admin_log enable row level security;
drop policy if exists "admins read log" on public.admin_log;
create policy "admins read log" on public.admin_log for select using (exists (select 1 from public.admins a where a.user_id = auth.uid()));
revoke insert, update, delete on public.admin_log from anon, authenticated;
create or replace function public.log_admin_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and exists (select 1 from admins where user_id = auth.uid()) then
    insert into admin_log (user_id, tbl, action, row_id, before, after)
    values (auth.uid(), tg_table_name, tg_op, coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', ''),
      case when tg_op = 'INSERT' then null else to_jsonb(old) - 'photo_url' - 'edit_hash' end,
      case when tg_op = 'DELETE' then null else to_jsonb(new) - 'photo_url' - 'edit_hash' end);
  end if;
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['cards', 'coupons', 'orders', 'leads', 'site_leads'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_admin_log', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_admin_change()', t || '_admin_log', t);
  end loop;
end $$;


-- ================================================================
-- ONE-TIME LAUNCH CLEANUP (v131): removes all test data, keeps only these three cards and their orders.
-- Runs once. Re-running this file afterwards skips it (flag in app_flags).
-- ================================================================
create table if not exists public.app_flags (key text primary key, at timestamptz not null default now());
alter table public.app_flags enable row level security;
revoke all on public.app_flags from anon, authenticated;
do $$ begin
  if not exists (select 1 from public.app_flags where key = 'purge_test_data_v131') then
    delete from public.leads where card_id is null or card_id not in (select id from public.cards where slug in ('neeharika7747', 'swamy3649', 'sandeep3649'));
    delete from public.orders where card_id is null or card_id not in (select id from public.cards where slug in ('neeharika7747', 'swamy3649', 'sandeep3649'));
    delete from public.cards where slug not in ('neeharika7747', 'swamy3649', 'sandeep3649');
    delete from public.site_leads;
    delete from public.coupon_redemptions where order_no not in (select order_no from public.orders);
    update public.coupons c set uses = (select count(*) from public.coupon_redemptions r where r.code = c.code);
    update public.orders set pay_status = 'waived' where pay_status = 'unpaid';   -- the three kept cards are yours
    insert into public.app_flags (key) values ('purge_test_data_v131');
  end if;
end $$;
select slug, first_name, last_name, active from public.cards order by slug;
