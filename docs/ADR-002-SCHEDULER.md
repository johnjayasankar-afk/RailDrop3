# ADR-002 — Scheduler

**Status:** Accepted · **Date:** 2026-09-02

## Context

Each active watch needs 3 checks/day at local `08:00`, `14:00`, `20:00`, plus one immediate scan at
creation. Requirements: survive at-least-once delivery, survive concurrent workers, survive DST, never
double-charge the fare provider, and never silently skip a user's check.

## Options considered

| Option                                             | Verdict                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Per-watch timers / setTimeout                      | Rejected — serverless has no durable timers.                                         |
| A cron entry per watch                             | Rejected — unbounded cron rows, no per-user timezone story, ugly lifecycle.          |
| Three fixed daily crons (08/14/20 UTC)             | Rejected — wrong local time for anyone outside one offset, breaks on DST.            |
| **Hourly heartbeat + durable due-slot dispatcher** | **Accepted.**                                                                        |
| Queue (pgmq / SQS)                                 | Deferred — adds infrastructure for a workload that a claim table already serialises. |

## Decision

**pg_cron fires an hourly heartbeat. The heartbeat does _not_ search fares.** It computes, per watch and in
that watch's own IANA timezone, which logical slot is due and unclaimed, durably claims it, and only then
runs cycles for the claimed slots.

```
pg_cron (hourly, UTC)
  └─ pg_net.http_post → POST /api/cron/dispatch   (Authorization: Bearer CRON_SECRET)
       ├─ begin_dispatch(now)   ── dispatch_runs.bucket is UNIQUE on the hour
       ├─ for each ACTIVE watch inside its monitoring window:
       │    localNow  = now in watch.timezone
       │    dueSlot   = latest of {08:00,14:00,20:00} ≤ localNow today
       │    olderDue  = due slots earlier today that were never recorded → inserted as SKIPPED(missed)
       │    INSERT INTO scheduled_check_runs (watch_id, local_date, check_slot)
       │      ON CONFLICT DO NOTHING RETURNING id        ── the exactly-once claim
       ├─ claim: UPDATE … SET status='RUNNING' WHERE id IN (
       │      SELECT id … WHERE status='PENDING' OR (status='RUNNING' AND leased_at < now()-lease)
       │      FOR UPDATE SKIP LOCKED)
       └─ BatchRunner: plan → global dedupe → provider → normalize → rank → snapshot → alert
```

## Why hourly, not every 6 hours

An hourly wake gives a missed heartbeat (deploy, outage, cold start) up to 5 recovery attempts before the
next slot, while costing nothing: a heartbeat with no due unclaimed slot performs **zero** provider calls.

## Idempotency

1. `UNIQUE (watch_id, local_date, check_slot)` — the insert _is_ the claim.
2. `FOR UPDATE SKIP LOCKED` on execution — racing workers cannot both run a claimed row.
3. Lease expiry (`RUN_LEASE_MINUTES`, default 15) reclaims rows from dead workers; `attempt` is capped at 3.
4. `dispatch_runs.bucket` is `UNIQUE` on the truncated hour, so two heartbeats in the same hour race
   on one INSERT and exactly one wins; the loser is a correct no-op. A Postgres **advisory lock was
   rejected** for this: advisory locks are session-scoped, and every PostgREST call uses a different
   pooled connection, so the lock could not be held across a dispatch. A row with a UNIQUE key is
   durable, observable, and survives a connection change. A crashed owner is taken over only after
   its lease expires.
5. Alert-level `UNIQUE (watch_id, dedupe_key)` — a re-run cannot re-send an email.

`INITIAL` and `MANUAL` cycles carry `scheduled_check_run_id = NULL` and never consume a slot.

## DST correctness

Slots are **local wall-clock** concepts. `localPartsInTimeZone(instant, tz)` uses
`Intl.DateTimeFormat` with the watch's IANA zone, so:

- **Spring forward** (02:00 → 03:00): 08/14/20 all exist; nothing is lost. A slot skipped because the
  heartbeat itself was late is caught by the "latest due unclaimed slot" rule on the next hour.
- **Fall back** (01:00 repeats): 08/14/20 each occur once. Even if a wall-clock hour repeats, the
  `(local_date, slot)` key is already claimed, so the repeat is a no-op.
- A user changing `timezone` cannot retroactively duplicate an already-claimed `(local_date, slot)`.

Tested explicitly for `America/New_York` across both 2026 transitions, plus `Asia/Kolkata` (+05:30) and
`Pacific/Chatham` (+12:45) to prove non-hour offsets work.

## Backfill policy

Only the **latest** due slot is executed. Earlier un-recorded slots for the same local date are inserted
with `status='SKIPPED'`, `skip_reason='MISSED_WINDOW'` — honest quota accounting, and no burst of three
cycles (and 9 provider calls) after an outage.

## Deployment redundancy

`vercel.json` declares an hourly Vercel Cron hitting the same endpoint. Because dispatch is idempotent,
running both triggers is harmless; it removes pg_net availability from the critical path.

## Consequences

- **Good:** correct per-user local times, DST-safe, exactly-once under at-least-once delivery, cheap
  heartbeats, trivially testable as a pure function plus a thin DB claim.
- **Bad:** up to ~59 minutes of slot latency granularity; a `RUNNING` row is invisible to other workers for
  the lease duration.
- **Accepted:** fare monitoring does not need minute precision; a 15-minute lease is far longer than a
  cycle (3 calls) needs.
