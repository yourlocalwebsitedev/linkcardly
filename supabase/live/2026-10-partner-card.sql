-- Linkcardly, 2026-10: a partner's free card shows its partner code (extras.partner_code), so the card's
-- "Get a card like this" link opens linkcardly.com/r/<code> and sales from it count for the partner.
-- Run once in Supabase → SQL Editor (staging first, then production). Safe to run again. Already part of ALL-IN-ONE.sql.
begin;
drop view if exists public.public_card_extras;
create view public.public_card_extras as
  select public_id, slug, jsonb_strip_nulls(jsonb_build_object(
    'brokerage', extras->'brokerage', 'license_no', extras->'license_no', 'license_state', extras->'license_state',
    'facebook', extras->'facebook', 'x_url', extras->'x_url', 'listings_url', extras->'listings_url', 'booking_url', extras->'booking_url',
    'office_address', extras->'office_address', 'iabs_url', extras->'iabs_url', 'lead_capture', extras->'lead_capture',
    'seasonal', extras->'seasonal', 'seasonal_addon', extras->'seasonal_addon', 'greeting', extras->'greeting', 'motion', to_jsonb(plan = 'motion'),
    'meeting_url', extras->'meeting_url', 'reg_no', extras->'reg_no', 'quals', extras->'quals', 'hours', extras->'hours', 'services', extras->'services', 'practice', extras->'practice', 'service_area', extras->'service_area', 'insured', extras->'insured', 'emergency', extras->'emergency', 'og_image', extras->'og_image', 'partner_code', extras->'partner_code')) as extras
  from public.cards where active is not false;
revoke all on public.public_card_extras from anon, authenticated;  -- Linkcardly: read-only (the default grants made the view writable)
grant select on public.public_card_extras to anon, authenticated;
commit;
notify pgrst, 'reload schema';
