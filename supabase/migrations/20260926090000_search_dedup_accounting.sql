-- Make cross-watch search reuse measurable, and safe under fan-out.
--
-- Two separate problems.
--
-- 1. Reuse was invisible. Dedup already worked — findFreshSearch matches a
--    completed provider_requests row by canonical search_key inside a 20-minute
--    window, and the journeys come back from search_cache — but nothing counted
--    it. provider_usage_daily tracked credits, requests, successes and failures,
--    so the cost model in ARCHITECTURE.md could not be checked against reality:
--    there was no way to say how many Chromium runs the cache actually avoided.
--
-- 2. Fan-out introduced a race. While dispatch ran one watch at a time, the
--    second watch on a corridor always saw the first watch's finished row. Now
--    that each watch gets its own invocation, two workers can start the same
--    corridor and date in the same second, both miss the cache because neither
--    has finished, and both launch Chromium. The dedup is correct and still
--    silently pays for the collision.
--
--    An IN_FLIGHT marker lets the second worker see that someone is already
--    doing the work. provider_requests.status is free text, so the marker needs
--    no constraint change — but it does need an index, because the dedup lookup
--    scans by search_key and there has never been one.

alter table public.provider_usage_daily
  add column if not exists reused integer not null default 0;

-- The dedup lookup: newest completed row for a search key. Without this it is a
-- sequential scan of every provider request ever made, on every date of every
-- cycle.
create index if not exists provider_requests_search_key_idx
  on public.provider_requests (search_key, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Down
--
--   drop index if exists public.provider_requests_search_key_idx;
--   alter table public.provider_usage_daily drop column if exists reused;
--
-- Reversible in structure. The reuse counts are lost, which is acceptable:
-- they are an accounting aid, not a record of anything a traveler was told.
-- ─────────────────────────────────────────────────────────────────────────────

-- The accumulator has to learn the new column. Kept as a separate overload
-- signature rather than an in-place edit so a deploy that is mid-rollout — old
-- code calling the five-argument form, new code calling the six — works either
-- way for the minute that matters.
create or replace function public.increment_provider_usage(
  usage_day date,
  add_credits integer,
  add_requests integer,
  add_successes integer,
  add_failures integer,
  add_reused integer default 0
) returns void
language plpgsql
security definer
as $$
begin
  insert into public.provider_usage_daily as u (day, credits, requests, successes, failures, reused)
  values (usage_day, add_credits, add_requests, add_successes, add_failures, add_reused)
  on conflict (day) do update set
    credits = u.credits + excluded.credits,
    requests = u.requests + excluded.requests,
    successes = u.successes + excluded.successes,
    failures = u.failures + excluded.failures,
    reused = u.reused + excluded.reused;
end;
$$;

-- Down for the function: restore the five-argument body from the init
-- migration and drop the six-argument form.
--
--   drop function if exists public.increment_provider_usage(date, integer, integer, integer, integer, integer);

-- The in-flight marker has to be a claim, not an announcement.
--
-- Looking for a marker and then writing one is check-then-act: two workers
-- that look at the same instant both see nothing and both proceed, which is
-- exactly the race fan-out introduced. A partial unique index makes the insert
-- itself the arbiter — the loser gets 23505 and waits for the winner.
create unique index if not exists provider_requests_one_in_flight_idx
  on public.provider_requests (search_key)
  where status = 'IN_FLIGHT';

-- Down:
--   drop index if exists public.provider_requests_one_in_flight_idx;
