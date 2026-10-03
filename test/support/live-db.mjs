// The live database (supabase/live/ALL-IN-ONE.sql + linkcardly.sql) in an in-process Postgres (PGlite), with
// stand-ins for what Supabase provides: the anon/authenticated API roles with default privileges, auth.uid()/jwt(),
// storage tables, and the base tables that existed before ALL-IN-ONE.sql. Used by test/live-db.test.js and the
// end-to-end suite (test/support/postgrest.mjs serves it to the browser).
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const live = f => readFile(new URL('../../supabase/live/' + f, import.meta.url), 'utf8');
export const ADMIN_ID = '00000000-0000-0000-0000-00000000000a';

export async function createLiveDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant execute on all functions in schema auth to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id bigserial primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.extension(name text) returns text language sql immutable as $$ select split_part(name, '.', -1) $$;
    create table public.admins (user_id uuid primary key);
    create table public.cards (id uuid primary key default gen_random_uuid(), slug text unique not null, prefix text, first_name text, last_name text, title text,
      company text, preset text, colour text, category text, tagline text, phone text, whatsapp text, email text, linkedin text, instagram text,
      website text, quote text, bio text, photo_url text, created_at timestamptz default now());
    alter table public.cards enable row level security; -- as in production (the base schema turned it on)
    insert into public.admins values ('${ADMIN_ID}');`);
  await db.exec(await live('ALL-IN-ONE.sql'));
  await db.exec(await live('linkcardly.sql'));
  return db;
}
