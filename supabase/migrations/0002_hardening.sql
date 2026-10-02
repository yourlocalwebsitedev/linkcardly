-- Linkcardly schema hardening (after 0001_init.sql). Safe to run before any data is loaded.

-- 1. Edit tokens: legacy NexBizRise edit links are /e/<40 hex>, which a uuid column cannot hold.
--    Store tokens as 40-hex text so migrated links keep working; new cards get a random 40-hex token.
alter table cards alter column edit_token drop default;
alter table cards alter column edit_token type text using replace(edit_token::text, '-', '') || substr(md5(random()::text), 1, 8);
alter table cards alter column edit_token set default encode(gen_random_bytes(20), 'hex');
alter table cards add constraint cards_edit_token_format check (edit_token ~ '^[a-f0-9]{40}$');
create unique index cards_edit_token_idx on cards(edit_token);

-- 2. Anonymous (anon key) reads: RLS limits rows to live cards; column grants keep secrets and
--    internal fields out of reach even if a client selects "*".
revoke select on cards from anon;
grant select (
  id, handle, status, plan, theme, full_name, title, company, profession, bio,
  phone, email, website, address, avatar_url, cover_url, cover_focus, video_url,
  service_area, city, hours, services, qualifications, practice_areas, emergency,
  licence, brokerage, compliance_html, booking_url, booking_label, lead_form, seasonal,
  powered_by, paid_until
) on cards to anon;

-- Expired cards are not public.
drop policy "public read live cards" on cards;
create policy "public read live cards" on cards for select to anon
  using (status = 'live' and (paid_until is null or paid_until >= current_date));

-- 3. Indexes and housekeeping.
create index if not exists handle_history_card_idx on handle_history(card_id);
create index if not exists contact_messages_created_idx on contact_messages(created_at);
alter table links add column if not exists updated_at timestamptz not null default now();

-- 4. Retention: delete contact messages and leads older than 24 months (run daily, e.g. pg_cron:
--    select cron.schedule('retention', '15 3 * * *', 'select purge_old_messages()');).
create or replace function purge_old_messages() returns void language sql security definer set search_path = public as $$
  delete from contact_messages where created_at < now() - interval '24 months';
  delete from leads where created_at < now() - interval '24 months';
$$;
revoke all on function purge_old_messages() from public, anon, authenticated;
