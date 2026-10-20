-- Linkcardly, 2026-10: the admin Partners tab can open any partner and see their page as they see it.
-- Run once (staging, then production). Safe to run again. Already part of linkcardly.sql.
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
notify pgrst, 'reload schema';
