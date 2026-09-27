-- ════════════════════════════════════════════════════════════════════════════
-- RailDrop 0005 - security and deployability hardening
--
-- Each change here closes a defect found by an adversarial audit of 0001-0004.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. profiles.email is a mail-relay surface ──────────────────────────────
--
-- 0002 granted a table-wide UPDATE on profiles to `authenticated`. Because the
-- anon key is public by design, any signed-up user could PATCH their own
-- profiles row to set email = victim@example.com, create a watch that trivially
-- qualifies, trigger a check, and have RailDrop send mail from its own verified
-- sending domain to an arbitrary address. Column-level grants close it.

revoke update on public.profiles from authenticated;
grant update (display_name, timezone) on public.profiles to authenticated;

-- ─── 2. Stale-run reclaim ───────────────────────────────────────────────────
--
-- lease_check_runs was only ever called with ids claimed in the SAME dispatch,
-- so a run stranded in RUNNING by a killed worker was never recovered: the next
-- heartbeat saw the row exist and refused to re-claim the slot, silently losing
-- that check. This finds genuinely recoverable runs server-side.

create or replace function public.reclaim_stale_runs(
  p_watch_ids     uuid[],
  p_lease_minutes integer default 15,
  p_limit         integer default 200
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
      where c.watch_id = any(p_watch_ids)
        and c.attempt < 3
        and (
          c.status = 'PENDING'
          or (c.status = 'RUNNING' and c.leased_at < now() - make_interval(mins => p_lease_minutes))
        )
      order by c.created_at
      limit p_limit
      for update skip locked
   )
  returning s.*;
end;
$$;

-- ─── 3. Fence run completion on the attempt that owns it ────────────────────
--
-- Without this, a resurrected zombie worker overwrites the status written by the
-- worker that legitimately reclaimed its run.

-- Adding a defaulted third parameter creates a SECOND function rather than
-- replacing the two-arg one, which makes every two-arg call ambiguous
-- ("function complete_check_run(unknown, unknown) is not unique") and silently
-- breaks run completion. Drop the old signature first.
drop function if exists public.complete_check_run(uuid, text);

create or replace function public.complete_check_run(
  p_id      uuid,
  p_status  text,
  p_attempt integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.scheduled_check_runs
     set status = p_status, completed_at = now()
   where id = p_id
     and (p_attempt is null or attempt = p_attempt);
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- ─── 4. Aggregate credit usage in the database ──────────────────────────────
--
-- The budget hard stop summed provider_requests row-by-row in the application.
-- PostgREST silently caps a response at max-rows (1000 by default), so once a
-- month exceeded that many calls the total froze at an arbitrary subset and the
-- hard stop could never fire. Aggregating in SQL returns one row, always exact.

create or replace function public.provider_usage_since(p_since timestamptz)
returns table (
  requests            bigint,
  successes           bigint,
  failures            bigint,
  credits_used        numeric,
  avg_latency_ms      numeric,
  dedupe_fanout_saved bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    count(*) filter (where status = 'SUCCESS')::bigint,
    count(*) filter (where status = 'FAILED')::bigint,
    coalesce(sum(coalesce(credits_charged, credits_estimated)), 0)::numeric,
    coalesce(avg(latency_ms), 0)::numeric,
    coalesce(sum(greatest(served_cycles - 1, 0)), 0)::bigint
  from public.provider_requests
  where created_at >= p_since;
$$;

-- ─── 5. Per-user lifetime spend ceiling ─────────────────────────────────────
--
-- maxActiveWatchesPerUser counted only ACTIVE rows, so create -> scan -> delete
-- -> repeat had no ceiling at all and could drain a shared credit pool.
-- provider_requests has no user column, so attribute spend through the cycles
-- that consumed it.

create or replace function public.user_credits_since(p_user_id uuid, p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(c.dates_total), 0)::numeric
    from public.fare_check_cycles c
   where c.user_id = p_user_id
     and c.started_at >= p_since
     and c.status not in ('SKIPPED_BUDGET', 'SKIPPED_EXPIRED');
$$;

-- ─── 6. Atomic manual-check reservation ─────────────────────────────────────
--
-- The cooldown was a read followed, an entire provider round-trip later, by the
-- write it was guarding. Two clicks 2s apart both passed. This inserts the
-- RUNNING cycle as the reservation, so the race is decided in one statement.

create or replace function public.claim_manual_check(
  p_watch_id          uuid,
  p_user_id           uuid,
  p_benchmark_cents   integer,
  p_benchmark_version integer,
  p_cooldown_minutes  integer default 15
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.fare_check_cycles
    (watch_id, user_id, trigger, status, benchmark_cents, benchmark_version)
  select p_watch_id, p_user_id, 'MANUAL', 'RUNNING', p_benchmark_cents, p_benchmark_version
   where not exists (
     select 1 from public.fare_check_cycles c
      where c.watch_id = p_watch_id
        and c.trigger = 'MANUAL'
        and c.started_at > now() - make_interval(mins => p_cooldown_minutes)
   )
  returning id into v_id;

  return v_id;  -- null means still cooling down
end;
$$;

-- ─── 7. Retention ───────────────────────────────────────────────────────────
--
-- fare_options/journey_options grow without bound; a watch's own history only
-- needs the recent cycles the UI and the sparkline actually read.

create or replace function public.prune_old_snapshots(p_keep_days integer default 45)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.fare_snapshots
   where created_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ─── grants ─────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC by default; revoke from PUBLIC, not roles.

revoke all on function public.reclaim_stale_runs(uuid[], integer, integer)                     from public;
revoke all on function public.complete_check_run(uuid, text, integer)                          from public;
revoke all on function public.provider_usage_since(timestamptz)                                from public;
revoke all on function public.user_credits_since(uuid, timestamptz)                            from public;
revoke all on function public.claim_manual_check(uuid, uuid, integer, integer, integer)        from public;
revoke all on function public.prune_old_snapshots(integer)                                     from public;

grant execute on function public.reclaim_stale_runs(uuid[], integer, integer)                  to service_role;
grant execute on function public.complete_check_run(uuid, text, integer)                       to service_role;
grant execute on function public.provider_usage_since(timestamptz)                             to service_role;
grant execute on function public.user_credits_since(uuid, timestamptz)                         to service_role;
grant execute on function public.claim_manual_check(uuid, uuid, integer, integer, integer)     to service_role;
grant execute on function public.prune_old_snapshots(integer)                                  to service_role;

-- ─── indexes for the new access paths ───────────────────────────────────────

create index if not exists cycles_user_started_idx on public.fare_check_cycles (user_id, started_at desc);
create index if not exists cycles_manual_idx on public.fare_check_cycles (watch_id, started_at desc)
  where trigger = 'MANUAL';
create index if not exists snapshots_created_idx on public.fare_snapshots (created_at);
