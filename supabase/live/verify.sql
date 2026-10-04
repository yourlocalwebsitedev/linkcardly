with expect as (select 'on' as test_mode)   -- ← staging: 'on'   ·   prod: change to 'off'
select check_name, result, expected, case when result = expected then 'PASS' else 'FAIL' end as status
from (values
  ('01 Every table has row-level security on',            (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity)::text, '0'),
  ('02 Worker secret saved (64 characters)',              coalesce((select length(value) from public.app_secrets where key = 'worker'), 0)::text, '64'),
  ('03 Cron key saved (64 characters)',                   coalesce((select length(value) from public.app_secrets where key = 'cron'), 0)::text, '64'),
  ('04 Worker secret and cron key are different',         (select (select value from public.app_secrets where key = 'worker') is distinct from (select value from public.app_secrets where key = 'cron'))::text, 'true'),
  ('05 Test mode',                                        case when exists (select 1 from public.app_flags where key = 'test_mode') then 'on' else 'off' end, (select test_mode from expect)),
  ('06 At least one admin added',                         (select (count(*) >= 1) from public.admins)::text, 'true'),
  ('07 Every admin is a real login',                      (select count(*) from public.admins a where not exists (select 1 from auth.users u where u.id = a.user_id))::text, '0'),
  ('08 Visitors cannot read the cards table',             has_table_privilege('anon', 'public.cards', 'select')::text, 'false'),
  ('09 Visitors cannot read the admins list',             has_table_privilege('anon', 'public.admins', 'select')::text, 'false'),
  ('10 Visitors cannot change orders',                    has_table_privilege('anon', 'public.orders', 'update')::text, 'false'),
  ('11 Visitors can read public cards',                   has_table_privilege('anon', 'public.public_cards', 'select')::text, 'true'),
  ('12 Visitors cannot write public cards',               has_table_privilege('anon', 'public.public_cards', 'insert')::text, 'false'),
  ('13 Visitors cannot read secrets',                     has_table_privilege('anon', 'public.app_secrets', 'select')::text, 'false'),
  ('14 Order, link and edit functions exist',             (select count(distinct proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                                            where n.nspname = 'public' and proname in ('place_order', 'slug_available', 'get_card_for_edit', 'update_card_by_token', 'mark_order_paid'))::text, '5'),
  ('15 Partner programme installed',                      (select count(*) from pg_tables where schemaname = 'partner')::text, '6'),
  ('16 No orders or cards yet (clean start)',             ((select count(*) from public.orders) + (select count(*) from public.cards))::text, '0')
) as t(check_name, result, expected)
order by check_name;
