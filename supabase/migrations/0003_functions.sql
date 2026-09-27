-- ════════════════════════════════════════════════════════════════════════════
-- RailDrop 0003 - server-side functions
--
-- These carry the concurrency guarantees that make at-least-once cron delivery
-- produce effectively-once execution.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── profile bootstrap ──────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── dispatcher mutex ───────────────────────────────────────────────────────
--
-- The UNIQUE bucket column is the mutex. Two workers waking in the same hour
-- race on one INSERT; exactly one wins. A crashed owner is taken over only after
-- its lease expires, so a dead worker cannot wedge the schedule forever.

create or replace function public.begin_dispatch(
  p_bucket         timestamptz,
  p_lease_minutes  integer default 15,
  p_source         text default 'CRON'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.dispatch_runs (bucket, trigger_source)
  values (date_trunc('hour', p_bucket), p_source)
  on conflict (bucket) do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  -- Take over an abandoned lease.
  update public.dispatch_runs
     set status = 'RUNNING',
         leased_at = now(),
         trigger_source = p_source
   where bucket = date_trunc('hour', p_bucket)
     and status = 'RUNNING'
     and leased_at < now() - make_interval(mins => p_lease_minutes)
  returning id into v_id;

  return v_id;  -- null means another worker owns this hour
end;
$$;

create or replace function public.finish_dispatch(
  p_id      uuid,
  p_status  text,
  p_metrics jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dispatch_runs
     set status             = p_status,
         completed_at       = now(),
         duration_ms        = greatest(0, (extract(epoch from (now() - created_at)) * 1000)::int),
         watches_considered = coalesce((p_metrics->>'watches_considered')::int, watches_considered),
         runs_claimed       = coalesce((p_metrics->>'runs_claimed')::int, runs_claimed),
         searches_requested = coalesce((p_metrics->>'searches_requested')::int, searches_requested),
         searches_executed  = coalesce((p_metrics->>'searches_executed')::int, searches_executed),
         searches_saved     = coalesce((p_metrics->>'searches_saved')::int, searches_saved),
         credits_charged    = coalesce((p_metrics->>'credits_charged')::numeric, credits_charged),
         alerts_created     = coalesce((p_metrics->>'alerts_created')::int, alerts_created),
         emails_sent        = coalesce((p_metrics->>'emails_sent')::int, emails_sent),
         errors             = coalesce((p_metrics->>'errors')::int, errors),
         detail             = p_metrics
   where id = p_id;
end;
$$;

-- ─── slot claim ─────────────────────────────────────────────────────────────
--
-- INSERT ... ON CONFLICT DO NOTHING RETURNING id *is* the claim. A second
-- concurrent dispatcher gets zero rows and correctly does nothing.

create or replace function public.claim_check_slot(
  p_watch_id   uuid,
  p_user_id    uuid,
  p_local_date date,
  p_slot       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.scheduled_check_runs (watch_id, user_id, local_date, check_slot, status)
  values (p_watch_id, p_user_id, p_local_date, p_slot, 'PENDING')
  on conflict (watch_id, local_date, check_slot) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.record_skipped_slot(
  p_watch_id   uuid,
  p_user_id    uuid,
  p_local_date date,
  p_slot       text,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.scheduled_check_runs
    (watch_id, user_id, local_date, check_slot, status, skip_reason, completed_at)
  values (p_watch_id, p_user_id, p_local_date, p_slot, 'SKIPPED', p_reason, now())
  on conflict (watch_id, local_date, check_slot) do nothing;
end;
$$;

-- ─── run lease ──────────────────────────────────────────────────────────────
--
-- FOR UPDATE SKIP LOCKED: racing workers cannot both execute a claimed row.
-- A RUNNING row whose lease expired is reclaimable, so a killed worker does not
-- strand the slot. attempt is capped by the caller.

create or replace function public.lease_check_runs(
  p_ids           uuid[],
  p_lease_minutes integer default 15
)
returns setof public.scheduled_check_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.scheduled_check_runs s
     set status    = 'RUNNING',
         leased_at = now(),
         attempt   = s.attempt + 1
   where s.id in (
     select c.id
       from public.scheduled_check_runs c
      where c.id = any(p_ids)
        and c.attempt < 3
        and (
          c.status = 'PENDING'
          or (c.status = 'RUNNING' and c.leased_at < now() - make_interval(mins => p_lease_minutes))
        )
      for update skip locked
   )
  returning s.*;
end;
$$;

create or replace function public.complete_check_run(
  p_id     uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.scheduled_check_runs
     set status = p_status, completed_at = now()
   where id = p_id;
end;
$$;

-- ─── month-to-date provider usage ───────────────────────────────────────────

create or replace view public.provider_usage_mtd as
select
  date_trunc('month', now())                                     as period_start,
  count(*)                                                       as requests,
  count(*) filter (where status = 'SUCCESS')                     as successes,
  count(*) filter (where status = 'FAILED')                      as failures,
  coalesce(sum(coalesce(credits_charged, credits_estimated)), 0) as credits_used,
  coalesce(avg(latency_ms), 0)                                   as avg_latency_ms,
  coalesce(sum(served_cycles - 1), 0)                            as dedupe_fanout_saved
from public.provider_requests
where created_at >= date_trunc('month', now());

revoke all on public.provider_usage_mtd from anon, authenticated;

-- ─── execute grants ─────────────────────────────────────────────────────────
-- Every function above is worker-only and SECURITY DEFINER. Users must never be
-- able to claim slots, forge dispatches, or lease runs.
--
-- IMPORTANT: Postgres grants EXECUTE to PUBLIC by default, so revoking from
-- `anon, authenticated` alone leaves the function fully callable. The revoke
-- MUST target PUBLIC, and privileges are then granted back explicitly.

revoke all on function public.begin_dispatch(timestamptz, integer, text)        from public;
revoke all on function public.finish_dispatch(uuid, text, jsonb)                from public;
revoke all on function public.claim_check_slot(uuid, uuid, date, text)          from public;
revoke all on function public.record_skipped_slot(uuid, uuid, date, text, text) from public;
revoke all on function public.lease_check_runs(uuid[], integer)                 from public;
revoke all on function public.complete_check_run(uuid, text)                    from public;
revoke all on function public.handle_new_user()                                 from public;
revoke all on function public.touch_updated_at()                                from public;

grant execute on function public.begin_dispatch(timestamptz, integer, text)        to service_role;
grant execute on function public.finish_dispatch(uuid, text, jsonb)                to service_role;
grant execute on function public.claim_check_slot(uuid, uuid, date, text)          to service_role;
grant execute on function public.record_skipped_slot(uuid, uuid, date, text, text) to service_role;
grant execute on function public.lease_check_runs(uuid[], integer)                 to service_role;
grant execute on function public.complete_check_run(uuid, text)                    to service_role;
