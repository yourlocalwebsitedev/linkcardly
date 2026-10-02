// Applies supabase/migrations in an in-process Postgres (PGlite) and checks constraints, RLS and grants.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PUBLIC_CARD_COLUMNS } from '../src/routes/cards.js';

const dir = new URL('../supabase/migrations/', import.meta.url);
let db;

const asAnon = async sql => { await db.exec('set role anon'); try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); } };

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  // Mirror Supabase: API roles get table privileges by default, and RLS decides which rows they see.
  await db.exec(`create role anon; create role authenticated; grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;`);
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  assert.deepEqual(files.slice(0, 3), ['0001_init.sql', '0002_hardening.sql', '0003_retention_schedule.sql']);
  await db.exec(await readFile(new URL(files[0], dir), 'utf8'));
  // A row created before 0002 must survive the edit_token type change.
  await db.exec(`insert into cards(handle, full_name, status) values ('early', 'Early', 'live')`);
  for (const f of files.slice(1)) await db.exec(await readFile(new URL(f, dir), 'utf8'));
  await db.exec(`insert into cards(handle, full_name, status, paid_until) values ('alex', 'Alex', 'live', null), ('expired', 'Old', 'live', current_date - 1), ('waiting', 'W', 'pending', null);
    insert into links(card_id, type, url, is_visible) select id, 'call', '+1', true from cards where handle = 'alex';
    insert into links(card_id, type, url, is_visible) select id, 'website', 'x.test', false from cards where handle = 'alex';
    insert into leads(card_id, name) select id, 'Lead' from cards where handle = 'alex';`);
});

test('edit tokens are 40-hex (legacy /e/<token> format), unique, and generated for new and existing cards', async () => {
  const rows = (await db.query(`select edit_token from cards`)).rows;
  for (const r of rows) assert.match(r.edit_token, /^[a-f0-9]{40}$/);
  assert.equal(new Set(rows.map(r => r.edit_token)).size, rows.length);
  await assert.rejects(db.query(`update cards set edit_token = 'nope' where handle = 'alex'`), /cards_edit_token_format/);
});

test('handle format and uniqueness are enforced', async () => {
  await assert.rejects(db.query(`insert into cards(handle, full_name) values ('-bad', 'x')`), /cards_handle_check/);
  await assert.rejects(db.query(`insert into cards(handle, full_name) values ('alex', 'x')`), /cards_handle_key/);
});

test('anon sees only live, unexpired cards and their visible links', async () => {
  assert.deepEqual((await asAnon(`select handle from cards order by handle`)).map(r => r.handle), ['alex', 'early']);
  assert.deepEqual((await asAnon(`select type from links`)).map(r => r.type), ['call']);
});

test('anon can read every column the card page selects, but not edit_token', async () => {
  await asAnon(`select ${PUBLIC_CARD_COLUMNS} from cards`);
  await assert.rejects(asAnon(`select edit_token from cards`), /permission denied/);
  await assert.rejects(asAnon(`select * from cards`), /permission denied/);
});

test('anon cannot read or write private tables (RLS, no policies)', async () => {
  for (const t of ['leads', 'contact_messages', 'handle_history', 'organisations']) assert.deepEqual(await asAnon(`select * from ${t}`), [], t);
  await assert.rejects(asAnon(`insert into leads(card_id, name) select id, 'x' from cards limit 1`), /row-level security/);
  await asAnon(`update cards set full_name = 'hacked'`).catch(() => {});
  assert.equal((await db.query(`select count(*)::int as n from cards where full_name = 'hacked'`)).rows[0].n, 0);
  await assert.rejects(asAnon(`select purge_old_messages()`), /permission denied/);
});

test('retention purge removes only old rows', async () => {
  await db.exec(`insert into contact_messages(name, created_at) values ('old', now() - interval '25 months'), ('new', now())`);
  await db.query(`select purge_old_messages()`);
  assert.deepEqual((await db.query(`select name from contact_messages`)).rows.map(r => r.name), ['new']);
});

test('updated_at is touched on update', async () => {
  const before = (await db.query(`select updated_at from cards where handle = 'alex'`)).rows[0].updated_at;
  await new Promise(r => setTimeout(r, 5));
  await db.exec(`update cards set bio = 'x' where handle = 'alex'`);
  const after = (await db.query(`select updated_at from cards where handle = 'alex'`)).rows[0].updated_at;
  assert.ok(after > before);
});
