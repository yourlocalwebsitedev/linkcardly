-- Linkcardly 0003: schedule the 24-month retention job from 0002 (DEF-33b).
-- Runs daily at 03:15 UTC through pg_cron when the extension is available (Supabase: Database →
-- Extensions → pg_cron). Without pg_cron this is a no-op; enable it, then run this file again.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    -- cron.schedule with a job name replaces an existing job of that name, so re-running is safe.
    execute $q$select cron.schedule('linkcardly-retention', '15 3 * * *', 'select public.purge_old_messages()')$q$;
  else
    raise notice 'pg_cron not available: purge_old_messages() is not scheduled';
  end if;
end $$;
