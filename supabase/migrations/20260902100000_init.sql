create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.profiles (
  id uuid primary key,
  email text not null default '',
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table if not exists public.stations (
  code text primary key,
  name text not null,
  city text not null,
  state text not null,
  country text not null default 'US',
  latitude double precision,
  longitude double precision,
  refreshed_at timestamptz not null default now()
);

create table if not exists public.watches (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  origin_code text not null,
  destination_code text not null,
  desired_travel_date date not null,
  date_flexibility_days smallint not null default 1 check (date_flexibility_days in (0, 1, 2)),
  preferred_departure_time text,
  passenger_count smallint not null default 1 check (passenger_count between 1 and 8),
  booked_train_number text,
  booked_departure_at timestamptz,
  booked_fare_family text not null default 'FLEXIBLE',
  travel_class text not null default 'COACH',
  current_booked_price_cents integer not null check (current_booked_price_cents >= 100),
  include_restricted_fares boolean not null default false,
  include_thruway boolean not null default false,
  minimum_savings_cents integer not null default 100,
  booked_at timestamptz not null,
  monitor_start_at timestamptz not null,
  monitor_end_at timestamptz,
  monitor_preset text not null default '48h',
  timezone text not null default 'America/New_York',
  alert_email text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'COMPLETED')),
  last_check_cycle_id uuid,
  last_checked_at timestamptz,
  next_check_slot text,
  next_check_at_label text,
  best_price_cents integer,
  best_savings_cents integer,
  last_opportunity jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fare_check_cycles (
  id uuid primary key,
  watch_id uuid not null references public.watches(id) on delete cascade,
  trigger text not null check (trigger in ('INITIAL', 'SCHEDULED', 'MANUAL')),
  check_slot text,
  local_check_date date,
  status text not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  dates_requested text[] not null default '{}',
  dates_succeeded text[] not null default '{}',
  dates_failed text[] not null default '{}',
  journeys_returned integer not null default 0,
  alerts_sent integer not null default 0,
  provider_requests integer not null default 0,
  reused_searches integer not null default 0
);

create table if not exists public.scheduled_check_runs (
  id uuid primary key,
  watch_id uuid not null references public.watches(id) on delete cascade,
  local_check_date date not null,
  check_slot text not null check (check_slot in ('MORNING', 'AFTERNOON', 'EVENING')),
  cycle_id text not null,
  created_at timestamptz not null default now(),
  unique (watch_id, local_check_date, check_slot)
);

create table if not exists public.provider_requests (
  id uuid primary key,
  search_key text not null,
  cycle_id uuid references public.fare_check_cycles(id) on delete set null,
  origin_code text not null,
  destination_code text not null,
  travel_date date not null,
  passenger_count smallint not null,
  status text not null,
  credits_consumed integer,
  latency_ms integer not null default 0,
  error_message text,
  reused_from_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.fare_snapshots (
  id uuid primary key,
  cycle_id uuid not null references public.fare_check_cycles(id) on delete cascade,
  watch_id uuid not null references public.watches(id) on delete cascade,
  travel_date date not null,
  status text not null,
  search_key text not null,
  provider_request_id uuid,
  error_message text
);

create table if not exists public.journey_options (
  id uuid primary key,
  cycle_id uuid not null references public.fare_check_cycles(id) on delete cascade,
  watch_id uuid not null references public.watches(id) on delete cascade,
  travel_date date not null,
  payload jsonb not null
);

create table if not exists public.search_cache (
  provider_request_id uuid primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key,
  watch_id uuid not null references public.watches(id) on delete cascade,
  cycle_id uuid not null references public.fare_check_cycles(id) on delete cascade,
  fingerprint jsonb not null,
  subject text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_deliveries (
  id uuid primary key,
  alert_id uuid not null references public.alerts(id) on delete cascade,
  watch_id uuid not null references public.watches(id) on delete cascade,
  to_email text not null,
  status text not null check (status in ('ATTEMPTED', 'ACCEPTED', 'FAILED')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.booking_price_events (
  id uuid primary key,
  watch_id uuid not null references public.watches(id) on delete cascade,
  previous_price_cents integer not null,
  new_price_cents integer not null,
  previous_travel_date date,
  new_travel_date date,
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.provider_usage_daily (
  day date primary key,
  credits integer not null default 0,
  requests integer not null default 0,
  successes integer not null default 0,
  failures integer not null default 0
);

create index if not exists watches_user_id_idx on public.watches(user_id);
create index if not exists watches_status_idx on public.watches(status);
create index if not exists provider_requests_search_key_idx on public.provider_requests(search_key, created_at desc);
create index if not exists journey_options_watch_idx on public.journey_options(watch_id, cycle_id);
create index if not exists stations_search_idx on public.stations using gin (name gin_trgm_ops);

create or replace function public.increment_provider_usage(
  usage_day date,
  add_credits integer,
  add_requests integer,
  add_successes integer,
  add_failures integer
) returns void
language plpgsql
security definer
as $$
begin
  insert into public.provider_usage_daily as u (day, credits, requests, successes, failures)
  values (usage_day, add_credits, add_requests, add_successes, add_failures)
  on conflict (day) do update set
    credits = u.credits + excluded.credits,
    requests = u.requests + excluded.requests,
    successes = u.successes + excluded.successes,
    failures = u.failures + excluded.failures;
end;
$$;

alter table public.profiles enable row level security;
alter table public.watches enable row level security;
alter table public.fare_check_cycles enable row level security;
alter table public.scheduled_check_runs enable row level security;
alter table public.provider_requests enable row level security;
alter table public.fare_snapshots enable row level security;
alter table public.journey_options enable row level security;
alter table public.search_cache enable row level security;
alter table public.alerts enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.booking_price_events enable row level security;
alter table public.provider_usage_daily enable row level security;
alter table public.stations enable row level security;

create policy profiles_self on public.profiles
  for select using (auth.uid() = id);

create policy watches_self on public.watches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy cycles_self on public.fare_check_cycles
  for select using (
    exists (select 1 from public.watches w where w.id = watch_id and w.user_id = auth.uid())
  );

create policy snapshots_self on public.fare_snapshots
  for select using (
    exists (select 1 from public.watches w where w.id = watch_id and w.user_id = auth.uid())
  );

create policy journeys_self on public.journey_options
  for select using (
    exists (select 1 from public.watches w where w.id = watch_id and w.user_id = auth.uid())
  );

create policy alerts_self on public.alerts
  for select using (
    exists (select 1 from public.watches w where w.id = watch_id and w.user_id = auth.uid())
  );

create policy notifications_self on public.notification_deliveries
  for select using (
    exists (select 1 from public.watches w where w.id = watch_id and w.user_id = auth.uid())
  );

create policy price_events_self on public.booking_price_events
  for select using (
    exists (select 1 from public.watches w where w.id = watch_id and w.user_id = auth.uid())
  );

create policy stations_read on public.stations
  for select using (true);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
