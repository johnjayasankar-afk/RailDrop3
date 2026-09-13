-- ═══════════════════════════════════════════════════════════════════════════
-- 0008 — Round trips
--
-- Most people who buy an Amtrak ticket buy two. Until now each direction had
-- to be created as an unrelated watch, so the return leg was easy to forget
-- and the two never added up to anything.
--
-- The modelling choice that matters: a round trip is **two watches that know
-- about each other**, not one watch with two dates.
--
--   - each leg has its own benchmark, its own dates, its own eligible trains
--     and its own alert state, which is what the whole pipeline already does
--     correctly;
--   - fares move independently, so a drop on the return is worth telling
--     someone about whether or not the outbound moved;
--   - and it means RailDrop never has to split one combined receipt total
--     across two legs. Splitting would be inventing the number this product
--     exists to avoid inventing.
--
-- The link is symmetric and both rows are written together.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.watches
  add column if not exists linked_watch_id uuid
    references public.watches (id) on delete set null;

comment on column public.watches.linked_watch_id is
  'The other leg of a round trip. Symmetric: each leg points at the other. Null for a one-way watch.';

-- A leg cannot be its own return.
alter table public.watches drop constraint if exists watches_link_not_self;
alter table public.watches
  add constraint watches_link_not_self check (linked_watch_id is null or linked_watch_id <> id);

-- A leg belongs to at most one round trip. Without this a third watch could
-- claim an already-paired leg, and the pairing would stop being symmetric.
create unique index if not exists watches_linked_unique
  on public.watches (linked_watch_id)
  where linked_watch_id is not null;

create index if not exists watches_linked_idx
  on public.watches (linked_watch_id)
  where linked_watch_id is not null;
