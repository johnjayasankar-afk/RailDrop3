-- ════════════════════════════════════════════════════════════════════════════
-- RailDrop 0001 - core schema
--
-- Conventions:
--   * money is ALWAYS integer cents (never numeric, never float)
--   * all timestamps are timestamptz
--   * child tables carry user_id so RLS policies stay simple and index-friendly
--   * status vocabularies use CHECK constraints (cheap to evolve, unlike enums)
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─── profiles ───────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  display_name  text,
  timezone      text not null default 'America/New_York',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is 'One row per authenticated user.';

-- ─── stations (public reference data, seeded locally) ───────────────────────

create table if not exists public.stations (
  code        text primary key check (code ~ '^[A-Z]{3}$'),
  name        text not null,
  city        text not null,
  state       text not null,
  timezone    text,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);

comment on table public.stations is
  'Local station catalog. Seeded and refreshed deliberately so typeahead never costs provider credits.';

create index if not exists stations_search_idx
  on public.stations using gin (to_tsvector('simple', name || ' ' || city || ' ' || code));

-- ─── watches ────────────────────────────────────────────────────────────────

create table if not exists public.watches (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,

  origin_code              text not null references public.stations (code),
  destination_code         text not null references public.stations (code),
  desired_date             date not null,
  passengers               integer not null default 1 check (passengers between 1 and 8),

  -- Canonical benchmark: what the user ACTUALLY paid, total for the party.
  benchmark_cents          integer not null check (benchmark_cents > 0),
  benchmark_version        integer not null default 1 check (benchmark_version > 0),

  -- Context about the original purchase (never used to derive the benchmark).
  original_train_number    text,
  original_departure_local text,
  original_fare_family     text not null default 'FLEXIBLE'
                             check (original_fare_family in ('FLEXIBLE','VALUE','SAVER','UNKNOWN')),
  booked_at                timestamptz not null default now(),

  -- Preferences
  date_flexibility_days    integer not null default 1 check (date_flexibility_days in (0,1,2)),
  travel_class             text not null default 'COACH'
                             check (travel_class in ('COACH','BUSINESS','FIRST','SLEEPER','UNKNOWN')),
  benchmark_fare_family    text not null default 'FLEXIBLE'
                             check (benchmark_fare_family in ('FLEXIBLE','VALUE','SAVER','UNKNOWN')),
  include_thruway          boolean not null default false,
  include_restricted_fares boolean not null default false,
  minimum_savings_cents    integer not null default 500 check (minimum_savings_cents >= 0),
  preferred_departure_minutes integer check (preferred_departure_minutes between 0 and 1439),

  timezone                 text not null default 'America/New_York',
  status                   text not null default 'ACTIVE'
                             check (status in ('ACTIVE','PAUSED','COMPLETED','NEEDS_ATTENTION')),
  status_reason            text,

  monitoring_starts_at     timestamptz not null default now(),
  monitoring_ends_at       timestamptz not null,

  -- Alert state (drives the anti-spam comparator)
  last_alerted_at              timestamptz,
  last_alert_best_total_cents  integer check (last_alert_best_total_cents >= 0),
  last_alert_signature         text,
  last_alert_convenience_score numeric,

  -- Denormalised latest-cycle summary, for fast dashboard rendering
  last_checked_at          timestamptz,
  last_cycle_status        text,
  best_total_cents         integer check (best_total_cents >= 0),
  best_option_id           uuid,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint watches_distinct_stations check (origin_code <> destination_code),
  constraint watches_window_valid      check (monitoring_ends_at > monitoring_starts_at)
);

create index if not exists watches_user_idx    on public.watches (user_id, created_at desc);
create index if not exists watches_active_idx  on public.watches (status, monitoring_ends_at)
  where status = 'ACTIVE';
create index if not exists watches_route_idx    on public.watches (origin_code, destination_code, desired_date);

-- ─── scheduled_check_runs (the durable exactly-once claim) ──────────────────

create table if not exists public.scheduled_check_runs (
  id             uuid primary key default gen_random_uuid(),
  watch_id       uuid not null references public.watches (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  local_date     date not null,
  check_slot     text not null check (check_slot in ('MORNING','AFTERNOON','EVENING')),
  status         text not null default 'PENDING'
                   check (status in ('PENDING','RUNNING','DONE','FAILED','SKIPPED')),
  skip_reason    text,
  attempt        integer not null default 0 check (attempt >= 0),
  leased_at      timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),

  -- THE exactly-once guarantee: at-least-once cron delivery collapses here.
  constraint scheduled_check_runs_slot_unique unique (watch_id, local_date, check_slot)
);

create index if not exists scheduled_runs_claimable_idx
  on public.scheduled_check_runs (status, leased_at);

-- ─── dispatch_runs (one row per heartbeat; also the dispatcher mutex) ───────

create table if not exists public.dispatch_runs (
  id                    uuid primary key default gen_random_uuid(),
  bucket                timestamptz not null unique,
  status                text not null default 'RUNNING'
                          check (status in ('RUNNING','DONE','FAILED')),
  trigger_source        text not null default 'CRON',
  leased_at             timestamptz not null default now(),
  watches_considered    integer not null default 0,
  runs_claimed          integer not null default 0,
  searches_requested    integer not null default 0,
  searches_executed     integer not null default 0,
  searches_saved        integer not null default 0,
  credits_charged       numeric not null default 0,
  alerts_created        integer not null default 0,
  emails_sent           integer not null default 0,
  errors                integer not null default 0,
  duration_ms           integer,
  detail                jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);

comment on table public.dispatch_runs is
  'One row per hourly heartbeat. The UNIQUE bucket is the dispatcher mutex: two concurrent workers cannot both own an hour.';

-- ─── fare_check_cycles ──────────────────────────────────────────────────────

create table if not exists public.fare_check_cycles (
  id                      uuid primary key default gen_random_uuid(),
  watch_id                uuid not null references public.watches (id) on delete cascade,
  user_id                 uuid not null references auth.users (id) on delete cascade,
  scheduled_check_run_id  uuid references public.scheduled_check_runs (id) on delete set null,
  dispatch_run_id         uuid references public.dispatch_runs (id) on delete set null,

  trigger                 text not null
                            check (trigger in ('INITIAL','MORNING','AFTERNOON','EVENING','MANUAL')),
  status                  text not null default 'PENDING'
                            check (status in ('PENDING','RUNNING','SUCCESS','PARTIAL_SUCCESS','FAILED',
                                              'SKIPPED_BUDGET','SKIPPED_EXPIRED')),

  -- Benchmark captured at cycle start, so a rebook mid-flight is detectable.
  benchmark_cents         integer not null check (benchmark_cents > 0),
  benchmark_version       integer not null,

  dates_total             integer not null default 0,
  dates_succeeded         integer not null default 0,
  dates_failed            integer not null default 0,
  journeys_returned       integer not null default 0,
  eligible_candidates     integer not null default 0,
  qualifying_options      integer not null default 0,
  best_total_cents        integer check (best_total_cents >= 0),
  best_savings_cents      integer,

  alert_suppressed_reason text,
  error_kind              text,
  error_message           text,

  started_at              timestamptz not null default now(),
  completed_at            timestamptz,
  duration_ms             integer
);

create index if not exists cycles_watch_idx on public.fare_check_cycles (watch_id, started_at desc);
create index if not exists cycles_user_idx  on public.fare_check_cycles (user_id, started_at desc);
create unique index if not exists cycles_scheduled_run_unique
  on public.fare_check_cycles (scheduled_check_run_id)
  where scheduled_check_run_id is not null;

-- ─── provider_requests (one row per EXTERNAL call, shared across cycles) ────

create table if not exists public.provider_requests (
  id                  uuid primary key default gen_random_uuid(),
  dispatch_run_id     uuid references public.dispatch_runs (id) on delete set null,
  provider_id         text not null,
  canonical_key       text not null,
  origin_code         text not null,
  destination_code    text not null,
  travel_date         date not null,
  passengers          integer not null,

  status              text not null check (status in ('SUCCESS','FAILED')),
  error_kind          text,
  error_message       text,
  http_status         integer,
  latency_ms          integer,
  attempts            integer not null default 1,

  journeys_returned   integer not null default 0,
  credits_charged     numeric,
  credits_estimated   numeric not null default 0,
  credits_remaining   numeric,

  -- How many cycles were served by this ONE call (dedupe fan-out).
  served_cycles       integer not null default 1,
  schema_aliases      text[] not null default '{}',

  created_at          timestamptz not null default now()
);

create index if not exists provider_requests_created_idx on public.provider_requests (created_at desc);
create index if not exists provider_requests_key_idx     on public.provider_requests (canonical_key, created_at desc);

-- ─── fare_snapshots (one per cycle per travel date) ─────────────────────────

create table if not exists public.fare_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  cycle_id              uuid not null references public.fare_check_cycles (id) on delete cascade,
  watch_id              uuid not null references public.watches (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  provider_request_id   uuid references public.provider_requests (id) on delete set null,

  travel_date           date not null,
  displacement_days     integer not null,

  -- NO_AVAILABILITY is a SUCCESSFUL provider response with no inventory.
  status                text not null
                          check (status in ('SUCCESS','NO_AVAILABILITY','FAILED')),
  error_kind            text,
  error_message         text,

  journeys_returned     integer not null default 0,
  eligible_candidates   integer not null default 0,
  rejected_summary      jsonb not null default '{}'::jsonb,
  cheapest_total_cents  integer check (cheapest_total_cents >= 0),

  created_at            timestamptz not null default now(),

  constraint fare_snapshots_cycle_date_unique unique (cycle_id, travel_date)
);

create index if not exists snapshots_watch_idx on public.fare_snapshots (watch_id, created_at desc);

-- ─── journey_options / fare_options (persisted normalized results) ──────────

create table if not exists public.journey_options (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_id         uuid not null references public.fare_snapshots (id) on delete cascade,
  watch_id            uuid not null references public.watches (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,

  provider_journey_id text not null,
  service_name        text,
  train_number        text,
  origin_code         text not null,
  destination_code    text not null,
  departure_local     text not null,
  arrival_local       text not null,
  duration_minutes    integer not null,
  transfers           integer not null default 0,
  travel_date         date not null,
  service_type        text not null
                        check (service_type in ('DIRECT_RAIL','CONNECTING_RAIL','THRUWAY_BUS','UNKNOWN')),
  booking_url         text,
  legs                jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists journey_options_snapshot_idx on public.journey_options (snapshot_id);
create index if not exists journey_options_watch_idx    on public.journey_options (watch_id, travel_date);

create table if not exists public.fare_options (
  id                  uuid primary key default gen_random_uuid(),
  journey_option_id   uuid not null references public.journey_options (id) on delete cascade,
  snapshot_id         uuid not null references public.fare_snapshots (id) on delete cascade,
  watch_id            uuid not null references public.watches (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,

  fare_family         text not null check (fare_family in ('FLEXIBLE','VALUE','SAVER','UNKNOWN')),
  fare_family_raw     text,
  travel_class        text not null check (travel_class in ('COACH','BUSINESS','FIRST','SLEEPER','UNKNOWN')),
  amount_cents        integer not null check (amount_cents >= 0),
  party_total_cents   integer not null check (party_total_cents >= 0),
  currency            text not null default 'USD',
  pricing_basis       text not null check (pricing_basis in ('PER_PASSENGER','TOTAL_PARTY','UNKNOWN')),
  pricing_confidence  text not null check (pricing_confidence in ('CONFIRMED','UNAMBIGUOUS_SINGLE','AMBIGUOUS')),
  availability        text not null check (availability in ('AVAILABLE','LIMITED','SOLD_OUT','UNKNOWN')),
  restricted          boolean not null default false,
  refundable          boolean,
  seats_remaining     integer,

  is_qualifying       boolean not null default false,
  savings_cents       integer,
  displacement_days   integer not null default 0,
  convenience_score   numeric,
  rank                integer,
  signature           text not null,

  created_at          timestamptz not null default now()
);

create index if not exists fare_options_snapshot_idx on public.fare_options (snapshot_id);
create index if not exists fare_options_watch_rank_idx
  on public.fare_options (watch_id, is_qualifying, party_total_cents);

-- ─── alerts ─────────────────────────────────────────────────────────────────

create table if not exists public.alerts (
  id                  uuid primary key default gen_random_uuid(),
  watch_id            uuid not null references public.watches (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  cycle_id            uuid references public.fare_check_cycles (id) on delete set null,

  reason              text not null check (reason in ('FIRST_DROP','PRICE_DROP','BETTER_CONVENIENCE')),
  -- A retried cycle produces an identical key and is rejected by this index.
  dedupe_key          text not null,

  benchmark_cents     integer not null,
  best_total_cents    integer not null,
  savings_cents       integer not null,
  best_signature      text not null,
  best_convenience_score numeric,
  options_snapshot    jsonb not null default '[]'::jsonb,
  cycle_status        text not null,
  unchecked_dates     date[] not null default '{}',

  created_at          timestamptz not null default now(),

  constraint alerts_dedupe_unique unique (watch_id, dedupe_key)
);

create index if not exists alerts_watch_idx on public.alerts (watch_id, created_at desc);

-- ─── notification_deliveries ────────────────────────────────────────────────

create table if not exists public.notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  alert_id            uuid not null references public.alerts (id) on delete cascade,
  watch_id            uuid not null references public.watches (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,

  channel             text not null default 'EMAIL' check (channel in ('EMAIL')),
  recipient           text not null,
  subject             text not null,
  -- Written as PENDING *before* the send, so a crash cannot lose the attempt.
  status              text not null default 'PENDING'
                        check (status in ('PENDING','SENT','FAILED','ABANDONED')),
  attempt             integer not null default 0,
  provider_message_id text,
  error               text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  updated_at          timestamptz not null default now()
);

create index if not exists deliveries_retryable_idx
  on public.notification_deliveries (status, updated_at)
  where status in ('PENDING','FAILED');

-- ─── booking_price_events (append-only benchmark history) ──────────────────

create table if not exists public.booking_price_events (
  id                  uuid primary key default gen_random_uuid(),
  watch_id            uuid not null references public.watches (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,

  event_type          text not null check (event_type in ('INITIAL_PURCHASE','REBOOKED')),
  amount_cents        integer not null check (amount_cents > 0),
  benchmark_version   integer not null,
  travel_date         date,
  train_number        text,
  departure_local     text,
  fare_family         text check (fare_family in ('FLEXIBLE','VALUE','SAVER','UNKNOWN')),
  note                text,
  created_at          timestamptz not null default now()
);

comment on table public.booking_price_events is
  'Append-only. Historical benchmarks are never rewritten.';

create index if not exists price_events_watch_idx on public.booking_price_events (watch_id, created_at);

-- ─── updated_at trigger ─────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists watches_touch on public.watches;
create trigger watches_touch before update on public.watches
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists deliveries_touch on public.notification_deliveries;
create trigger deliveries_touch before update on public.notification_deliveries
  for each row execute function public.touch_updated_at();
