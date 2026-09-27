-- ═══════════════════════════════════════════════════════════════════════════
-- 0009 — Date probes: looking outside the monitoring window, once, on purpose
--
-- The monitoring window is capped at ±2 days by a CHECK constraint on
-- watches.date_flexibility_days, and deliberately so: it runs three times a
-- day for the life of a trip, so every extra date is a *recurring* cost.
--
-- That left one obvious question unanswerable — "what if I shifted a few
-- days?" — and the tempting fix, quietly widening the window, would multiply
-- the standing spend without anybody choosing it.
--
-- A probe is the honest shape instead: one scan, of dates the trip is not
-- already monitoring, with the exact cost stated before it runs.
--
-- Deliberately NOT part of the alerting pipeline. A fare on a date the user
-- never opted to monitor is not eligible under the rules the rest of the
-- product enforces, so a probe stores prices and raises nothing. Giving it its
-- own table rather than a flag on fare_snapshots keeps that separation
-- structural: no query that feeds the alert engine can reach these rows.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.date_probes (
  id                   uuid primary key default gen_random_uuid(),
  watch_id             uuid not null references public.watches (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,

  travel_date          date not null,
  status               text not null
                         check (status in ('SUCCESS','NO_AVAILABILITY','FAILED')),
  -- Null for NO_AVAILABILITY and FAILED. A failed probe is a gap, never a
  -- price of zero and never "nothing cheaper" — the same rule the price chart
  -- follows.
  cheapest_total_cents integer check (cheapest_total_cents is null or cheapest_total_cents >= 0),
  journeys_returned    integer not null default 0,
  error_kind           text,

  probed_at            timestamptz not null default now(),

  -- One row per date. Re-probing replaces it, so the calendar shows the most
  -- recent answer rather than an accumulating pile of stale ones.
  unique (watch_id, travel_date)
);

create index if not exists date_probes_watch_idx
  on public.date_probes (watch_id, travel_date);

comment on table public.date_probes is
  'One-off price lookups for dates outside the monitoring window. Never feeds the alert engine: those dates are not eligible under the watch the user actually created.';

alter table public.date_probes enable row level security;

drop policy if exists date_probes_select_own on public.date_probes;
create policy date_probes_select_own on public.date_probes
  for select to authenticated using (user_id = (select auth.uid()));

-- Written by the service role only, like every other row that costs money:
-- the provider call and its accounting happen server-side, so a user-side
-- insert could record a price nobody paid for.
grant select on public.date_probes to authenticated;
revoke insert, update, delete on public.date_probes from anon, authenticated;
