-- What the board actually saw, each time it looked.
--
-- The watch page has a panel headed "Price history" that plots
-- booking_price_events — the traveler's own benchmark, which only changes when
-- they press "I rebooked". For almost every watch that is a single point, and
-- for none of them is it a history of fares. The product checks a corridor
-- three times a day and threw away every observation but the latest.
--
-- Two columns on the cycle, written when it completes. A cycle is already the
-- record of one look at the market; this is what that look found. Deriving it
-- instead — min() over journey_options per cycle — is a join across the largest
-- table in the schema on every board render, to recompute a number that was in
-- memory at the moment it was known.
--
-- Nullable because a cycle can legitimately find nothing: a provider outage, or
-- a corridor with no listed inventory. NULL means "looked, saw nothing", which
-- is a different fact from 0 and from a missing row, and the chart draws it as
-- a gap rather than a crash to zero.

alter table public.fare_check_cycles
  add column if not exists best_price_cents integer,
  add column if not exists best_travel_date date;

comment on column public.fare_check_cycles.best_price_cents is
  'Cheapest eligible total party fare observed in this cycle. NULL = nothing qualified.';
comment on column public.fare_check_cycles.best_travel_date is
  'Which day in the window that cheapest fare was on.';

-- The chart reads the last N cycles for one watch, newest first.
create index if not exists fare_check_cycles_watch_started_idx
  on public.fare_check_cycles (watch_id, started_at desc);

-- Backfill from what is already stored, so the history does not start empty for
-- watches that have been running. journey_options holds every option each cycle
-- returned; the cheapest of them is the observation that cycle made.
--
-- Deliberately narrow: only rows that returned something, and only the total
-- party price, which is the figure the board ranks on. Anything it cannot work
-- out honestly stays NULL.
update public.fare_check_cycles as c
set best_price_cents = sub.cheapest
from (
  select
    j.cycle_id,
    min((j.option -> 'fares' -> 0 ->> 'totalPartyPriceCents')::integer) as cheapest
  from public.journey_options as j
  where j.option -> 'fares' -> 0 ->> 'totalPartyPriceCents' is not null
  group by j.cycle_id
) as sub
where sub.cycle_id = c.id
  and c.best_price_cents is null
  and sub.cheapest is not null
  and sub.cheapest > 0;
