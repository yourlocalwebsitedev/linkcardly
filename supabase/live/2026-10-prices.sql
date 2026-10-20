-- Linkcardly prices, 2026-10: Motion Card in India is ₹1,299 a year (was ₹1,799). Digital stays ₹799; US prices unchanged.
-- The database prices every order, so these three functions change together (same text as ALL-IN-ONE.sql).
-- Also: PAN is asked for once a partner's earnings this financial year pass ₹10,000 (was ₹20,000).
-- Run once in Supabase → SQL Editor (staging first, then production). Safe to run again.
begin;

create or replace function public.coupon_discount(p_code text, p_plan text, p_region text, p_email text, p_lock boolean default false)
returns numeric language plpgsql security definer set search_path = public as $$
declare c coupons; v_base numeric;
begin
  v_base := case when p_region = 'IN' then (case p_plan when 'motion' then 1299 else 799 end) else (case p_plan when 'motion' then 79 else 49 end) end;
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
  v_base := case when v_region = 'IN' then (case v_plan when 'motion' then 1299 else 799 end) else (case v_plan when 'motion' then 79 else 49 end) end;
  v_tax := 0;  -- Linkcardly: no GST for now (no GSTIN yet). Was 18% for India: round((v_base - v_disc) * 0.18)
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

  v_price := case when v_region = 'IN' then (case v_plan when 'motion' then 1299 else 799 end) else (case v_plan when 'motion' then 79 else 49 end) end;
  if v_coupon is not null then
    v_disc := coupon_discount(v_coupon, v_plan, v_region, left(coalesce(payload->>'customer_email',''), 200), true);  -- row lock: no double-spend under concurrency
    update coupons set uses = uses + 1 where code = v_coupon;
    insert into coupon_redemptions (code, order_no, email, discount) values (v_coupon, v_no, left(coalesce(payload->>'customer_email',''), 200), v_disc);
  end if;
  v_tax := 0;  -- Linkcardly: no GST for now (no GSTIN yet). Was 18% for India: round((v_price - v_disc) * 0.18)
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

alter table partner.settings alter column pan_threshold set default 10000;
update partner.settings set pan_threshold = 10000 where pan_threshold = 20000;

commit;
notify pgrst, 'reload schema';

-- Check (should show 10000):
select pan_threshold from partner.settings;
