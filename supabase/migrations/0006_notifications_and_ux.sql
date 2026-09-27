-- ════════════════════════════════════════════════════════════════════════════
-- RailDrop 0006 - push notifications, per-user preferences, and UX state
--
-- Adds: web-push subscriptions, notification preferences (channels, quiet
-- hours), soft delete with an undo window, trip notes and pinning, and the
-- retention job that keeps snapshot tables from growing without bound.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Web push subscriptions ─────────────────────────────────────────────────
--
-- One row per browser/device. The endpoint is the natural key: re-subscribing
-- the same browser returns the same endpoint, so an upsert refreshes the keys
-- rather than accumulating duplicates.

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  label         text,
  failure_count integer not null default 0,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

comment on table public.push_subscriptions is
  'Web Push endpoints. A 404/410 from the push service means the browser revoked it; the row is deleted rather than retried.';

-- ─── Notification preferences ───────────────────────────────────────────────

alter table public.profiles
  add column if not exists email_alerts          boolean not null default true,
  add column if not exists push_alerts           boolean not null default true,
  -- Minutes since local midnight. Alerts inside the window are held, not dropped.
  add column if not exists quiet_hours_start     integer check (quiet_hours_start between 0 and 1439),
  add column if not exists quiet_hours_end       integer check (quiet_hours_end between 0 and 1439),
  add column if not exists default_min_savings_cents integer not null default 500
    check (default_min_savings_cents >= 0),
  add column if not exists onboarded_at          timestamptz;

-- ─── Watch UX state ─────────────────────────────────────────────────────────

alter table public.watches
  -- Soft delete: deleting is instantly undoable for a short window, and the row
  -- is only really removed by the retention job. Losing a watch's whole price
  -- history to a mis-tap is not recoverable otherwise.
  add column if not exists deleted_at timestamptz,
  add column if not exists note       text,
  add column if not exists pinned     boolean not null default false;

create index if not exists watches_live_idx
  on public.watches (user_id, pinned desc, created_at desc)
  where deleted_at is null;

-- The dispatcher must never pick up a soft-deleted watch.
drop index if exists watches_active_idx;
create index if not exists watches_active_idx
  on public.watches (status, monitoring_ends_at)
  where status = 'ACTIVE' and deleted_at is null;

-- ─── Alert delivery channel ─────────────────────────────────────────────────

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_channel_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_channel_check
  check (channel in ('EMAIL', 'PUSH'));

-- A single alert can now fan out to more than one channel.
drop index if exists deliveries_alert_channel_idx;
create unique index if not exists deliveries_alert_channel_idx
  on public.notification_deliveries (alert_id, channel, recipient);

-- Quiet hours HOLD a notification rather than dropping it: the delivery row is
-- created immediately (so the alert is never lost) with a deliver_after stamp,
-- and the retry sweep picks it up once the window closes.
alter table public.notification_deliveries
  add column if not exists deliver_after timestamptz;

create index if not exists deliveries_deliver_after_idx
  on public.notification_deliveries (deliver_after)
  where status in ('PENDING', 'FAILED');

-- ─── Retention ──────────────────────────────────────────────────────────────

create or replace function public.prune_deleted_watches(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.watches
   where deleted_at is not null
     and deleted_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.push_subscriptions enable row level security;

drop policy if exists push_select_own on public.push_subscriptions;
create policy push_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists push_insert_own on public.push_subscriptions;
create policy push_insert_own on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists push_update_own on public.push_subscriptions;
create policy push_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists push_delete_own on public.push_subscriptions;
create policy push_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Preferences are user-editable; email remains NOT user-writable (0005 closed a
-- mail-relay hole by making it a column-level grant, and that must not regress).
revoke update on public.profiles from authenticated;
grant update (
  display_name,
  timezone,
  email_alerts,
  push_alerts,
  quiet_hours_start,
  quiet_hours_end,
  default_min_savings_cents,
  onboarded_at
) on public.profiles to authenticated;

revoke all on function public.prune_deleted_watches(integer) from public;
grant execute on function public.prune_deleted_watches(integer) to service_role;
