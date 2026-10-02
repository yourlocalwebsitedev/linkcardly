-- Linkcardly core schema
create extension if not exists pgcrypto;

create type card_status as enum ('pending', 'live', 'paused');
create type card_plan as enum ('basic', 'motion');

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  locked_theme text,
  created_at timestamptz not null default now()
);

create table cards (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9.-]{1,28}[a-z0-9]$'),
  status card_status not null default 'pending',
  plan card_plan not null default 'basic',
  organisation_id uuid references organisations(id) on delete set null,
  edit_token uuid not null default gen_random_uuid(),         -- private self-edit link
  theme text not null default 'folio',                        -- design family + colourway key
  full_name text not null,
  title text, company text, profession text, bio text,
  phone text, email text, website text, address text,
  avatar_url text, cover_url text, cover_focus text, video_url text,
  service_area text, city text, hours text, services text[],
  qualifications text, practice_areas text[], emergency text,
  licence text, brokerage text, compliance_html text,
  booking_url text, booking_label text,
  lead_form boolean not null default false,
  seasonal text not null default 'auto' check (seasonal in ('auto', 'off')),
  powered_by boolean not null default true,
  paid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cards_status_idx on cards(status);
create index cards_org_idx on cards(organisation_id);

create table links (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  type text not null,            -- call, whatsapp, sms, email, directions, website, instagram, linkedin, listings, facebook, youtube, tiktok, link
  label text,
  url text not null,
  sort_order int not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now()
);
create index links_card_idx on links(card_id, sort_order);

create table leads (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  name text, phone text, email text, message text,
  created_at timestamptz not null default now()
);
create index leads_card_idx on leads(card_id, created_at desc);

create table handle_history (
  old_handle text primary key,
  card_id uuid not null references cards(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text, email text, phone text, message text,
  created_at timestamptz not null default now()
);

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger cards_touch before update on cards for each row execute function touch_updated_at();

-- RLS: the Worker uses the service key server-side. Public (anon) may read live cards and their visible links only.
alter table cards enable row level security;
alter table links enable row level security;
alter table leads enable row level security;
alter table handle_history enable row level security;
alter table contact_messages enable row level security;
alter table organisations enable row level security;

create policy "public read live cards" on cards for select to anon using (status = 'live');
create policy "public read visible links" on links for select to anon
  using (is_visible and exists (select 1 from cards c where c.id = card_id and c.status = 'live'));
-- No anon policies on leads, contact_messages, handle_history, organisations: service key only.
-- Note: never select edit_token for public responses.
