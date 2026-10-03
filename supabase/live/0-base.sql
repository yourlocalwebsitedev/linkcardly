-- ================================================================
-- Linkcardly — base tables (run FIRST on a new Supabase project)
-- ================================================================
-- ALL-IN-ONE.sql builds on two tables that the original NexBizRise project created by hand: `cards` and
-- `admins`. This file creates them exactly as they were in that project (columns, checks, indexes, access
-- rules and triggers, read from it on 2026-10-03), so a new, empty project ends up the same.
-- Order on a new project: 0-base.sql → ALL-IN-ONE.sql → linkcardly.sql. Safe to run again.

-- Admins: Supabase users who may use the admin page.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- Admin check used by the access rules below (SECURITY DEFINER so a rule on `admins` can read `admins`).
-- ALL-IN-ONE.sql defines the same function again; the body is identical.
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid()) $$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Cards: one row per digital card. ALL-IN-ONE.sql adds public_id, edit_hash, edited_at, edit_seen, changes_used.
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  prefix text default '',
  first_name text not null,
  last_name text default '',
  title text not null,
  company text default '',
  preset text not null default 'entrepreneur' check (preset in ('entrepreneur', 'realEstate', 'services', 'healthcare')),
  colour text not null default 'forest',
  category text default '',
  tagline text default '',
  phone text not null,
  whatsapp text default '',
  email text default '',
  linkedin text default '',
  instagram text default '',
  website text default '',
  quote text default '',
  bio text default '',
  photo_url text default '',
  plan text not null default 'basic' check (plan in ('basic', 'motion')),
  renewal date not null default (current_date + interval '1 year'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  profession text default 'Entrepreneur / Business owner',
  profession_other text default '',
  city text default '',
  notes text default '',
  phone_display text default '',
  signature text default '',
  titles text default '',
  contact_photo_url text default '',
  show_powered_by boolean not null default true,
  photo_x numeric not null default 50,
  photo_y numeric not null default 50,
  photo_zoom numeric not null default 1,
  region text not null default 'IN' check (region in ('IN', 'US')),
  layout text default 'original',
  extras jsonb not null default '{}'::jsonb
);
alter table public.cards enable row level security;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists cards_touch on public.cards;
create trigger cards_touch before update on public.cards for each row execute function public.touch_updated_at();

-- Access rules: only admins (signed in on the admin page) read or change these tables directly. Customers
-- reach cards through the read-only public views and the database functions, never the tables.
drop policy if exists "admins read admins" on public.admins;
create policy "admins read admins" on public.admins for select using (public.is_admin());
drop policy if exists "admins read cards" on public.cards;
create policy "admins read cards" on public.cards for select using (public.is_admin());
drop policy if exists "admins insert cards" on public.cards;
create policy "admins insert cards" on public.cards for insert with check (public.is_admin());
drop policy if exists "admins update cards" on public.cards;
create policy "admins update cards" on public.cards for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete cards" on public.cards;
create policy "admins delete cards" on public.cards for delete using (public.is_admin());
