-- Turn the scheduled-run claim into a lease.
--
-- The row was inserted before the work ran, keyed uniquely on
-- (watch_id, local_check_date, check_slot), and nothing ever updated it. So a
-- cron invocation that died partway through its loop left every watch it had
-- reached holding a consumed slot with no work done. The next hourly wake saw
-- the unique row, counted it as a duplicate, and moved on. Those travelers
-- were never checked and nothing logged an error.
--
-- A lease distinguishes "this slot is being worked on" from "this slot is
-- finished". A RUNNING row past its expiry is evidence of a crash, not of
-- completed work, and can be reclaimed.
--
-- cycle_id also has to stop being a lie: the dispatcher assigned it to a local
-- object after the cycle ran and never wrote it back, so every row in this
-- table says 'pending' forever. It becomes nullable, set on completion.

alter table public.scheduled_check_runs
  add column if not exists status text not null default 'PENDING'
    check (status in ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'ABANDONED')),
  add column if not exists attempts smallint not null default 0,
  add column if not exists claimed_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists failure_reason text;

-- Existing rows predate the lease. They were inserted only on the success path
-- of the old dispatcher, so treat them as finished rather than reclaimable —
-- reclaiming them would re-check historical slots on the first deploy.
update public.scheduled_check_runs
set status = 'DONE',
    finished_at = coalesce(finished_at, created_at)
where status = 'PENDING';

-- cycle_id was 'pending' on every row because the write-back never happened.
alter table public.scheduled_check_runs
  alter column cycle_id drop not null;

update public.scheduled_check_runs
set cycle_id = null
where cycle_id = 'pending';

-- The reaper asks one question: which leases have expired? And the enqueue
-- route asks: what is still owed? Both want this index.
create index if not exists scheduled_check_runs_lease_idx
  on public.scheduled_check_runs (status, lease_expires_at)
  where status in ('PENDING', 'RUNNING');

-- ─────────────────────────────────────────────────────────────────────────────
-- Down
--
--   drop index if exists public.scheduled_check_runs_lease_idx;
--
--   update public.scheduled_check_runs set cycle_id = 'pending' where cycle_id is null;
--   alter table public.scheduled_check_runs alter column cycle_id set not null;
--
--   alter table public.scheduled_check_runs
--     drop column if exists failure_reason,
--     drop column if exists lease_expires_at,
--     drop column if exists finished_at,
--     drop column if exists started_at,
--     drop column if exists claimed_at,
--     drop column if exists attempts,
--     drop column if exists status;
--
-- Reversible in structure. Not reversible in information: the down discards
-- which runs failed and why, because the old schema has nowhere to put it.
-- ─────────────────────────────────────────────────────────────────────────────
