-- ════════════════════════════════════════════════════════════════════════════
-- RailDrop 0002 - Row Level Security
--
-- Authorization model:
--   * every user-owned table is RLS-protected and scoped by user_id = auth.uid()
--   * derived tables (cycles, snapshots, options, alerts, deliveries) are
--     READ-ONLY to their owner; all writes come from the background worker using
--     the service role, which bypasses RLS
--   * operational tables (provider_requests, dispatch_runs) have RLS enabled and
--     NO policies, so they are invisible to every non-service-role connection
--   * stations is public reference data: readable by anyone, writable by no one
-- ════════════════════════════════════════════════════════════════════════════

alter table public.profiles                enable row level security;
alter table public.stations                enable row level security;
alter table public.watches                 enable row level security;
alter table public.scheduled_check_runs    enable row level security;
alter table public.fare_check_cycles       enable row level security;
alter table public.fare_snapshots          enable row level security;
alter table public.journey_options         enable row level security;
alter table public.fare_options            enable row level security;
alter table public.alerts                  enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.booking_price_events    enable row level security;
alter table public.provider_requests       enable row level security;
alter table public.dispatch_runs           enable row level security;

-- ─── profiles ───────────────────────────────────────────────────────────────

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

-- ─── stations (public reference data) ───────────────────────────────────────

drop policy if exists stations_read_all on public.stations;
create policy stations_read_all on public.stations
  for select to anon, authenticated using (true);

-- ─── watches (full CRUD, owner only) ───────────────────────────────────────

drop policy if exists watches_select_own on public.watches;
create policy watches_select_own on public.watches
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists watches_insert_own on public.watches;
create policy watches_insert_own on public.watches
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists watches_update_own on public.watches;
create policy watches_update_own on public.watches
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists watches_delete_own on public.watches;
create policy watches_delete_own on public.watches
  for delete to authenticated using (user_id = (select auth.uid()));

-- ─── derived data: owner-readable, worker-writable ─────────────────────────

drop policy if exists runs_select_own on public.scheduled_check_runs;
create policy runs_select_own on public.scheduled_check_runs
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists cycles_select_own on public.fare_check_cycles;
create policy cycles_select_own on public.fare_check_cycles
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists snapshots_select_own on public.fare_snapshots;
create policy snapshots_select_own on public.fare_snapshots
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists journey_options_select_own on public.journey_options;
create policy journey_options_select_own on public.journey_options
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists fare_options_select_own on public.fare_options;
create policy fare_options_select_own on public.fare_options
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists alerts_select_own on public.alerts;
create policy alerts_select_own on public.alerts
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists deliveries_select_own on public.notification_deliveries;
create policy deliveries_select_own on public.notification_deliveries
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists price_events_select_own on public.booking_price_events;
create policy price_events_select_own on public.booking_price_events
  for select to authenticated using (user_id = (select auth.uid()));

-- provider_requests and dispatch_runs deliberately have NO policies:
-- RLS is enabled, so every non-service-role connection sees zero rows.

-- ─── explicit grants ────────────────────────────────────────────────────────
-- Stated explicitly rather than inherited from platform defaults, so the schema
-- is self-contained, reviewable, and testable against a plain Postgres.

grant usage on schema public to anon, authenticated;

grant select                         on public.stations                to anon, authenticated;
grant select, insert, update         on public.profiles                to authenticated;
grant select, insert, update, delete on public.watches                 to authenticated;
grant select                         on public.scheduled_check_runs    to authenticated;
grant select                         on public.fare_check_cycles       to authenticated;
grant select                         on public.fare_snapshots          to authenticated;
grant select                         on public.journey_options         to authenticated;
grant select                         on public.fare_options            to authenticated;
grant select                         on public.alerts                  to authenticated;
grant select                         on public.notification_deliveries to authenticated;
grant select                         on public.booking_price_events    to authenticated;

-- ─── privilege hygiene ──────────────────────────────────────────────────────
-- RLS governs rows; these revokes govern the surface area itself.

revoke all on public.provider_requests from anon, authenticated;
revoke all on public.dispatch_runs      from anon, authenticated;

revoke insert, update, delete on public.stations                from anon, authenticated;
revoke insert, update, delete on public.fare_check_cycles       from anon, authenticated;
revoke insert, update, delete on public.fare_snapshots          from anon, authenticated;
revoke insert, update, delete on public.journey_options         from anon, authenticated;
revoke insert, update, delete on public.fare_options            from anon, authenticated;
revoke insert, update, delete on public.alerts                  from anon, authenticated;
revoke insert, update, delete on public.notification_deliveries from anon, authenticated;
revoke insert, update, delete on public.scheduled_check_runs    from anon, authenticated;
revoke insert, update, delete on public.booking_price_events    from anon, authenticated;
