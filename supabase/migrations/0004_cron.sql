-- ════════════════════════════════════════════════════════════════════════════
-- RailDrop 0004 - scheduler
--
-- pg_cron fires an HOURLY HEARTBEAT. The heartbeat does not search fares; it
-- asks the dispatcher which local slots are due and unclaimed (see ADR-002).
--
-- The app URL and CRON_SECRET are read from database settings so no secret is
-- ever committed to a migration file. Set them once, as a superuser/owner:
--
--   alter database postgres set app.settings.raildrop_app_url    = 'https://<your-app>';
--   alter database postgres set app.settings.raildrop_cron_secret = '<CRON_SECRET>';
--
-- This migration is safe to run on a project without pg_cron/pg_net: it detects
-- their absence and leaves a notice instead of failing the whole migration.
-- ════════════════════════════════════════════════════════════════════════════

-- pg_cron 1.5+ is NOT relocatable (it pins itself to pg_catalog), so
-- `with schema extensions` is a hard error that aborts the whole migration on a
-- fresh project. Both extensions are also optional: a project without superuser
-- or without them installed must still get the rest of the schema, and the
-- Vercel Cron fallback in vercel.json covers scheduling either way.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'RailDrop: pg_cron unavailable (%); using the Vercel Cron fallback', sqlerrm;
end
$$;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'RailDrop: pg_net unavailable (%); using the Vercel Cron fallback', sqlerrm;
end
$$;

create or replace function public.raildrop_dispatch_heartbeat()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url    text := current_setting('app.settings.raildrop_app_url', true);
  v_secret text := current_setting('app.settings.raildrop_cron_secret', true);
begin
  if v_url is null or v_url = '' then
    raise notice 'RailDrop: app.settings.raildrop_app_url is not set; heartbeat skipped';
    return;
  end if;
  if v_secret is null or v_secret = '' then
    raise notice 'RailDrop: app.settings.raildrop_cron_secret is not set; heartbeat skipped';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/api/cron/dispatch',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_secret
               ),
    body    := jsonb_build_object('source', 'pg_cron', 'firedAt', now()),
    timeout_milliseconds := 60000
  );
end;
$$;

-- Revoke from PUBLIC: Postgres grants EXECUTE to PUBLIC by default, so
-- revoking only from anon/authenticated would leave this callable by anyone.
revoke all on function public.raildrop_dispatch_heartbeat() from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('raildrop-hourly-dispatch')
      where exists (select 1 from cron.job where jobname = 'raildrop-hourly-dispatch');

    perform cron.schedule(
      'raildrop-hourly-dispatch',
      '0 * * * *',
      $cron$select public.raildrop_dispatch_heartbeat();$cron$
    );
    raise notice 'RailDrop: hourly dispatch job scheduled';
  else
    raise notice 'RailDrop: pg_cron not available; use the Vercel Cron fallback in vercel.json';
  end if;
exception when others then
  raise notice 'RailDrop: could not schedule pg_cron job (%). Vercel Cron fallback still applies.', sqlerrm;
end
$$;
