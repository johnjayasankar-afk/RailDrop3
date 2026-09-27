-- What a corridor costs, from every search we have ever run.
--
-- provider_requests already records origin, destination, travel date and time
-- for every search, across every user. It does not record what the search
-- found. So each watch starts blind: a new BOS→NYP watch says "we have no price
-- history for this trip yet" and gives a low-confidence recommendation, while
-- the product has been scraping that exact corridor three times a day for
-- somebody else all week.
--
-- One column closes that. It is the cheapest believable fare the search
-- returned — believable meaning it passed fare-sanity, so a misparse cannot
-- drag a corridor's floor down and make every traveler on it think they
-- overpaid.
--
-- NULL means the search found nothing, or failed, or was never completed. A
-- corridor summary counts only rows that have a price, and says how many.

alter table public.provider_requests
  add column if not exists cheapest_price_cents integer;

comment on column public.provider_requests.cheapest_price_cents is
  'Cheapest plausible total-party fare this search returned, at one adult. NULL = found nothing, failed, or still in flight.';

-- The corridor query: one origin-destination pair, recent first.
-- Partial, because a row with no price is never in the answer and there are a
-- lot of them (errors, in-flight claims, empty inventory).
create index if not exists provider_requests_corridor_idx
  on public.provider_requests (origin_code, destination_code, created_at desc)
  where cheapest_price_cents is not null;

-- Backfill from what is already stored. journey_options holds every option each
-- cycle returned; provider_requests and cycles are joined through the snapshot
-- that recorded the search. Only rows we can attribute confidently are filled —
-- anything ambiguous stays NULL, because a wrong number here becomes a claim
-- about what a corridor costs.
update public.provider_requests as pr
set cheapest_price_cents = sub.cheapest
from (
  select
    s.provider_request_id,
    min((j.option -> 'fares' -> 0 ->> 'totalPartyPriceCents')::integer) as cheapest
  from public.fare_snapshots as s
  join public.journey_options as j
    on j.cycle_id = s.cycle_id
   and j.travel_date = s.travel_date
  where s.provider_request_id is not null
    and j.option -> 'fares' -> 0 ->> 'totalPartyPriceCents' is not null
  group by s.provider_request_id
) as sub
where sub.provider_request_id = pr.id
  and pr.cheapest_price_cents is null
  and sub.cheapest is not null
  -- The same floor fare-sanity uses. A backfilled misparse is still a misparse.
  and sub.cheapest >= 300;
