-- Linkcardly, 2026-10: admin_partner_create no longer depends on media_url_ok() (not present with that signature on
-- every database); the photo address is checked inline with the same rule (img.linkcardly.com photo files only).
-- Also: the free card's renewal date is 2099-12-31 (cards.renewal is NOT NULL), so it never expires or gets reminders.
-- Run once (staging, then production). Safe to run again.
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
