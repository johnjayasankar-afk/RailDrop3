-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 — Target prices, per-trip thresholds, and a durable trip timeline
--
-- Two additions:
--
--   1. A target price. "Materially cheaper than what I paid" is the right
--      default, but it is not the only question people ask — plenty of trips
--      have a number in mind ("under $80 and I'll rebook"). A target is a
--      second, independent reason to alert, and it fires even when the
--      material-drop rule has already been satisfied and gone quiet.
--
--   2. watch_events. The dashboard shows what is true now; it could never show
--      what happened. Checks and alerts are already durable, but the actions a
--      person takes — rebooking, extending, pausing, setting a target — left
--      no trace at all. Without them a timeline would silently omit exactly
--      the entries a user is looking for when they ask "why did this change?".
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Target price and per-trip threshold ────────────────────────────────────

alter table public.watches
  add column if not exists target_price_cents integer
    check (target_price_cents is null or target_price_cents > 0);

comment on column public.watches.target_price_cents is
  'Optional. Alert whenever the best qualifying total is at or below this, independently of the material-drop rule. Null means no target.';

comment on column public.watches.minimum_savings_cents is
  'Per-trip override of the material-drop threshold. Defaults to the profile default at creation time.';

-- A target below what you paid is the point; a target above it would fire on
-- every check forever, so the form clamps it and the database agrees.
alter table public.watches
  drop constraint if exists watches_target_below_benchmark;
alter table public.watches
  add constraint watches_target_below_benchmark
    check (target_price_cents is null or target_price_cents < benchmark_cents);

-- ─── TARGET_REACHED joins the alert reasons ─────────────────────────────────

alter table public.alerts drop constraint if exists alerts_reason_check;
alter table public.alerts
  add constraint alerts_reason_check
    check (reason in ('FIRST_DROP','PRICE_DROP','BETTER_CONVENIENCE','TARGET_REACHED'));

-- ─── Trip timeline ──────────────────────────────────────────────────────────

create table if not exists public.watch_events (
  id         uuid primary key default gen_random_uuid(),
  watch_id   uuid not null references public.watches (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in (
               'CREATED','REBOOKED','PAUSED','RESUMED','EXTENDED',
               'TARGET_SET','TARGET_CLEARED','DELETED','RESTORED','COMPLETED'
             )),
  -- Human-facing specifics: the amounts, the new end date, and so on. Kept as
  -- jsonb so a new event kind never needs a migration to carry its detail.
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists watch_events_watch_idx
  on public.watch_events (watch_id, created_at desc);

comment on table public.watch_events is
  'Append-only record of user-visible actions on a watch. Checks and alerts have their own tables; this covers everything a person did.';

alter table public.watch_events enable row level security;

drop policy if exists watch_events_select_own on public.watch_events;
create policy watch_events_select_own on public.watch_events
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists watch_events_insert_own on public.watch_events;
create policy watch_events_insert_own on public.watch_events
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Deliberately no update or delete policy: the log is append-only, and a row a
-- user could rewrite would not be worth showing them.
grant select, insert on public.watch_events to authenticated;

-- ─── Retention ──────────────────────────────────────────────────────────────
-- Events belong to their watch and cascade with it, so the existing
-- prune_deleted_watches() sweep already covers them.

-- ─── Fix: the benchmark ledger was never actually written ───────────────────
--
-- 0002 revoked insert on booking_price_events from `authenticated`, on the
-- reasoning that an append-only ledger should not be user-writable. But both
-- writers — watch creation and rebooking — run as the user through the
-- RLS-scoped client, and neither checked the insert result. Every write was
-- silently discarded, so the "append-only benchmark history" was empty in
-- every deployment.
--
-- Append-only is still the right model; it just has to permit the append.
-- Insert is granted with a WITH CHECK that pins the row to its owner, while
-- update and delete stay revoked — so history can be added to and never
-- rewritten, which is what append-only means.

grant insert on public.booking_price_events to authenticated;

drop policy if exists price_events_insert_own on public.booking_price_events;
create policy price_events_insert_own on public.booking_price_events
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Belt and braces: these must stay revoked for the ledger to mean anything.
revoke update, delete on public.booking_price_events from anon, authenticated;
