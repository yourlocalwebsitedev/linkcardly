-- Linkcardly, 2026-10: admin partner functions also work from the Supabase SQL Editor (until the admin screens exist).
-- Website callers still need a signed-in admin. Run once (staging, then production). Safe to run again.
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
