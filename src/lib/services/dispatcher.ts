import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { decideDispatch } from '@/lib/domain/schedule';
import type { ScheduledSlot, Watch } from '@/lib/domain/types';
import { SCHEDULED_SLOTS } from '@/lib/domain/types';
import { getServerEnv } from '@/lib/env';
import { createLogger, describeError } from '@/lib/log';
import type { FareProvider } from '@/lib/providers/fare-provider';
import type { WatchRow } from '@/lib/db/types';
import { toDateString, toWatch } from './mappers';
import { runBatch, type BatchResult, type WatchJob } from './batch-runner';
import { retryPendingDeliveries } from './alerts';

const logger = createLogger({ component: 'dispatcher' });

export interface DispatchOptions {
  db: SupabaseClient;
  provider: FareProvider;
  now?: Date;
  source?: string;
  sendEmails?: boolean;
  /**
   * Wall-clock budget for the whole dispatch. Vercel kills the function at
   * maxDuration (300s); without a self-imposed deadline the batch is cut off
   * mid-flight, finish_dispatch never runs, and the run sits RUNNING with no
   * metrics and no error anywhere. Default leaves headroom for teardown.
   */
  deadlineMs?: number;
}

export interface DispatchResult {
  dispatchId: string | null;
  /** Runs that were claimed but deferred because the deadline was near. */
  deferredRuns: number;
  /** Runs recovered from a previous dispatch that died mid-flight. */
  reclaimedRuns: number;
  /** False when another worker already owns this hour - a correct no-op. */
  owned: boolean;
  watchesConsidered: number;
  runsClaimed: number;
  slotsSkipped: number;
  batch: BatchResult | null;
  emailRetriesSent: number;
  durationMs: number;
}

const WATCH_COLUMNS =
  'id,user_id,origin_code,destination_code,desired_date,passengers,benchmark_cents,benchmark_version,' +
  'original_train_number,original_departure_local,original_fare_family,booked_at,date_flexibility_days,' +
  'travel_class,benchmark_fare_family,include_thruway,include_restricted_fares,minimum_savings_cents,' +
  'target_price_cents,' +
  'preferred_departure_minutes,timezone,status,status_reason,monitoring_starts_at,monitoring_ends_at,' +
  'last_alerted_at,last_alert_best_total_cents,last_alert_signature,last_alert_convenience_score,' +
  'last_checked_at,last_cycle_status,best_total_cents,best_option_id,created_at,updated_at,' +
  'deleted_at,note,pinned,linked_watch_id';

/**
 * The hourly heartbeat.
 *
 * It performs NO fare searches by itself. It determines which local slots are due
 * and unclaimed, durably claims them, and only then runs cycles for what it won.
 */
export async function runDispatch(options: DispatchOptions): Promise<DispatchResult> {
  const env = getServerEnv();
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const { db, provider } = options;
  const dispatchLog = logger.child({ dispatch_id: randomUUID() });

  // The UNIQUE hour bucket is the dispatcher mutex. Two workers racing in the
  // same hour: exactly one gets an id, the other correctly does nothing.
  const { data: dispatchId, error: beginError } = await db.rpc('begin_dispatch', {
    p_bucket: now.toISOString(),
    p_lease_minutes: env.runLeaseMinutes,
    p_source: options.source ?? 'CRON',
  });

  if (beginError) {
    dispatchLog.error('begin_dispatch failed', { error: beginError.message });
    throw new Error(`begin_dispatch failed: ${beginError.message}`);
  }
  if (!dispatchId) {
    dispatchLog.info('dispatch already owned by another worker this hour');
    return {
      dispatchId: null,
      owned: false,
      watchesConsidered: 0,
      runsClaimed: 0,
      slotsSkipped: 0,
      deferredRuns: 0,
      reclaimedRuns: 0,
      batch: null,
      emailRetriesSent: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const id = String(dispatchId);
  const log = dispatchLog.child({ dispatch_id: id });

  try {
    // Only ACTIVE watches whose monitoring window is still open.
    const { data: watchRows, error: watchError } = await db
      .from('watches')
      .select(WATCH_COLUMNS)
      .eq('status', 'ACTIVE')
      .is('deleted_at', null)
      .lte('monitoring_starts_at', now.toISOString())
      .gt('monitoring_ends_at', now.toISOString())
      .limit(2000);

    if (watchError) throw new Error(`Failed to load watches: ${watchError.message}`);

    const watches = ((watchRows ?? []) as unknown as WatchRow[]).map(toWatch);
    log.info('dispatch started', { watches_considered: watches.length });

    const recorded = await loadRecordedSlots(db, watches, now);

    const claims: Array<{ watch: Watch; slot: ScheduledSlot; runId: string }> = [];
    let slotsSkipped = 0;

    for (const watch of watches) {
      const key = watch.id;
      const decision = decideDispatch(now, watch.timezone, recorded.get(key) ?? new Set());

      for (const skipped of decision.skip) {
        const { error } = await db.rpc('record_skipped_slot', {
          p_watch_id: watch.id,
          p_user_id: watch.userId,
          p_local_date: decision.localDate,
          p_slot: skipped.slot,
          p_reason: skipped.reason,
        });
        if (!error) slotsSkipped += 1;
      }

      if (!decision.claim) continue;

      const { data: runId, error } = await db.rpc('claim_check_slot', {
        p_watch_id: watch.id,
        p_user_id: watch.userId,
        p_local_date: decision.localDate,
        p_slot: decision.claim,
      });
      if (error) {
        log.error('claim_check_slot failed', { watch_id: watch.id, error: error.message });
        continue;
      }
      // No id means another dispatcher already owns this exact slot.
      if (runId) claims.push({ watch, slot: decision.claim, runId: String(runId) });
    }

    // Recover runs stranded by a worker that died mid-flight. Without this the
    // next heartbeat sees the row EXISTS, refuses to re-claim the slot, and the
    // check is silently lost - the reclaim path documented in ARCHITECTURE §17
    // was previously unreachable because leases were only ever taken on rows
    // claimed in the same dispatch.
    const reclaimedByWatch = new Map<
      string,
      { runId: string; slot: ScheduledSlot; attempt: number }
    >();
    if (watches.length > 0) {
      const { data: reclaimed, error: reclaimError } = await db.rpc('reclaim_stale_runs', {
        p_watch_ids: watches.map((w) => w.id),
        p_lease_minutes: env.runLeaseMinutes,
        p_limit: 200,
      });
      if (reclaimError) {
        log.error('reclaim_stale_runs failed', { error: reclaimError.message });
      } else {
        for (const row of (reclaimed ?? []) as Array<{
          id: string;
          watch_id: string;
          check_slot: string;
          attempt: number;
        }>) {
          reclaimedByWatch.set(row.watch_id, {
            runId: row.id,
            slot: row.check_slot as ScheduledSlot,
            attempt: row.attempt,
          });
        }
      }
    }

    // Lease with FOR UPDATE SKIP LOCKED so a racing worker cannot double-execute.
    let leasedIds = new Set<string>();
    if (claims.length > 0) {
      const { data: leased, error: leaseError } = await db.rpc('lease_check_runs', {
        p_ids: claims.map((c) => c.runId),
        p_lease_minutes: env.runLeaseMinutes,
      });
      if (leaseError) throw new Error(`lease_check_runs failed: ${leaseError.message}`);
      leasedIds = new Set(((leased ?? []) as Array<{ id: string }>).map((r) => r.id));
    }

    const watchById = new Map(watches.map((w) => [w.id, w]));
    const freshlyClaimed = claims
      .filter((c) => leasedIds.has(c.runId))
      .map((c) => ({ watch: c.watch, slot: c.slot, runId: c.runId, attempt: 1 }));

    const recovered = [...reclaimedByWatch.entries()]
      .filter(([watchId]) => !freshlyClaimed.some((c) => c.watch.id === watchId))
      .map(([watchId, r]) => {
        const watch = watchById.get(watchId);
        return watch ? { watch, slot: r.slot, runId: r.runId, attempt: r.attempt } : null;
      })
      .filter(
        (c): c is { watch: Watch; slot: ScheduledSlot; runId: string; attempt: number } =>
          c !== null,
      );

    const allOwned = [...freshlyClaimed, ...recovered];

    // Respect the wall-clock budget: run what fits, hand the rest back so the
    // next heartbeat picks them up rather than losing them to a function kill.
    const deadlineMs = options.deadlineMs ?? 240_000;
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, deadlineMs - elapsed);
    // A watch costs up to (dates x attempts x timeout) / concurrency.
    const perWatchMs = Math.max(5_000, (env.providerTimeoutMs * 3) / 3);
    const capacity = Math.max(1, Math.floor(remaining / perWatchMs));

    const owned = allOwned.slice(0, capacity);
    const deferred = allOwned.slice(capacity);
    for (const d of deferred) {
      await db
        .from('scheduled_check_runs')
        .update({ status: 'PENDING', leased_at: null })
        .eq('id', d.runId);
    }
    if (deferred.length > 0) {
      log.warn('dispatch deferred runs to stay inside its deadline', {
        deferred: deferred.length,
        capacity,
        remaining_ms: remaining,
      });
    }
    const emails = await loadRecipients(
      db,
      owned.map((c) => c.watch.userId),
    );

    const jobs: WatchJob[] = owned.map((c) => ({
      watch: c.watch,
      trigger: c.slot,
      scheduledRunId: c.runId,
      recipientEmail: emails.get(c.watch.userId) ?? null,
      attempt: c.attempt,
    }));

    const batch = await runBatch(jobs, {
      db,
      provider,
      dispatchRunId: id,
      now,
      sendEmails: options.sendEmails ?? true,
    });

    // Close out every leased run with the outcome of its cycle.
    const statusByWatch = new Map(batch.cycles.map((c) => [c.watchId, c.status]));
    for (const c of owned) {
      const cycleStatus = statusByWatch.get(c.watch.id);
      const runStatus = cycleStatus === 'FAILED' ? 'FAILED' : 'DONE';
      // Fenced on the attempt we leased: a resurrected zombie worker must not
      // overwrite the status written by the worker that reclaimed its run.
      await db.rpc('complete_check_run', {
        p_id: c.runId,
        p_status: runStatus,
        p_attempt: c.attempt,
      });
    }

    const emailRetriesSent = await retryPendingDeliveries(db);

    // Retention, once a day. fare_options and journey_options grow with every
    // check; without this the tables only ever get bigger, and a soft-deleted
    // watch would linger forever.
    let pruned = 0;
    if (now.getUTCHours() === 3) {
      const { data: snapshots } = await db.rpc('prune_old_snapshots', { p_keep_days: 45 });
      const { data: watchesPruned } = await db.rpc('prune_deleted_watches', { p_keep_days: 30 });
      pruned = Number(snapshots ?? 0) + Number(watchesPruned ?? 0);
      if (pruned > 0) log.info('retention pruned rows', { pruned });
    }

    const durationMs = Date.now() - startedAt;
    await db.rpc('finish_dispatch', {
      p_id: id,
      p_status: 'DONE',
      p_metrics: {
        watches_considered: watches.length,
        runs_claimed: owned.length,
        searches_requested: batch.searchesRequested,
        searches_executed: batch.searchesExecuted,
        searches_saved: batch.searchesSaved,
        credits_charged: batch.creditsCharged,
        alerts_created: batch.alertsCreated,
        emails_sent: batch.emailsSent + emailRetriesSent,
        errors: batch.errors,
        slots_skipped: slotsSkipped,
        deferred_runs: deferred.length,
        reclaimed_runs: recovered.length,
        pruned_rows: pruned,
      },
    });

    log.info('dispatch complete', {
      watches_considered: watches.length,
      runs_claimed: owned.length,
      slots_skipped: slotsSkipped,
      searches_requested: batch.searchesRequested,
      searches_executed: batch.searchesExecuted,
      searches_saved: batch.searchesSaved,
      credits_charged: batch.creditsCharged,
      alerts_created: batch.alertsCreated,
      emails_sent: batch.emailsSent,
      errors: batch.errors,
      duration_ms: durationMs,
    });

    return {
      dispatchId: id,
      owned: true,
      watchesConsidered: watches.length,
      runsClaimed: owned.length,
      slotsSkipped,
      deferredRuns: deferred.length,
      reclaimedRuns: recovered.length,
      batch,
      emailRetriesSent,
      durationMs,
    };
  } catch (error) {
    log.error('dispatch failed', describeError(error));
    await db.rpc('finish_dispatch', {
      p_id: id,
      p_status: 'FAILED',
      p_metrics: { errors: 1, message: describeError(error).message },
    });
    throw error;
  }
}

async function loadRecordedSlots(
  db: SupabaseClient,
  watches: Watch[],
  now: Date,
): Promise<Map<string, Set<ScheduledSlot>>> {
  const map = new Map<string, Set<ScheduledSlot>>();
  if (watches.length === 0) return map;

  // Local dates differ per timezone; a two-day lookback covers every offset.
  const since = new Date(now.getTime() - 48 * 3_600_000).toISOString().slice(0, 10);

  const { data, error } = await db
    .from('scheduled_check_runs')
    .select('watch_id, local_date, check_slot')
    .in(
      'watch_id',
      watches.map((w) => w.id),
    )
    .gte('local_date', since);

  if (error || !data) return map;

  const localDateByWatch = new Map(
    watches.map((w) => [
      w.id,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: w.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now),
    ]),
  );

  for (const row of data as Array<{ watch_id: string; local_date: string; check_slot: string }>) {
    if (localDateByWatch.get(row.watch_id) !== toDateString(row.local_date)) continue;
    const slot = row.check_slot as ScheduledSlot;
    if (!SCHEDULED_SLOTS.includes(slot)) continue;
    const set = map.get(row.watch_id) ?? new Set<ScheduledSlot>();
    set.add(slot);
    map.set(row.watch_id, set);
  }
  return map;
}

async function loadRecipients(db: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return map;
  const { data } = await db.from('profiles').select('id, email').in('id', unique);
  for (const row of (data ?? []) as Array<{ id: string; email: string | null }>) {
    if (row.email) map.set(row.id, row.email);
  }
  return map;
}

/**
 * Run one cycle for a single watch outside the scheduled quota.
 * Used by the immediate INITIAL scan and by the user-triggered MANUAL check.
 */
export async function runSingleWatchCycle(
  db: SupabaseClient,
  provider: FareProvider,
  watchRow: WatchRow,
  trigger: 'INITIAL' | 'MANUAL',
  now: Date = new Date(),
  options: { reservedCycleId?: string | null } = {},
): Promise<BatchResult> {
  const watch = toWatch(watchRow);
  const recipients = await loadRecipients(db, [watch.userId]);
  return runBatch(
    [
      {
        watch,
        trigger,
        scheduledRunId: null,
        recipientEmail: recipients.get(watch.userId) ?? null,
        reservedCycleId: options.reservedCycleId ?? null,
      },
    ],
    { db, provider, dispatchRunId: null, now },
  );
}

export { WATCH_COLUMNS };
