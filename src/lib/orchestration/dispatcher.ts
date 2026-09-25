import { logger } from "@/lib/logger";
import { dueSlotsAt, nextSlotAfter } from "@/lib/domain/timezone";
import { shouldCompleteWatch } from "@/lib/domain/monitoring";
import { fairBatch, isExpired, leaseExpiry, reap } from "@/lib/domain/run-lease";
import type { FareProvider } from "@/lib/providers/fare-provider";
import type { RailDropRepository } from "@/lib/db/repository";
import type { CheckSlot } from "@/lib/domain/types";
import type { Mailer } from "@/lib/notifications/send-alert";
import { runWatchCycle } from "./check-cycle";

/* Dispatch is now three separable things.
 *
 * It used to be one sequential loop that claimed a slot by inserting a row and
 * then ran the whole 165-second check inline. Past the second or third watch
 * the 300-second function ceiling killed the invocation — and because the row
 * already existed, the next hourly wake read it as "already handled". Every
 * watch the timeout never reached was silently never checked, forever, and
 * nothing logged an error.
 *
 * The fix is not a longer timeout. It is that a slot is only spent when the
 * work finishes:
 *
 *   reap     — hand back leases whose worker died
 *   enqueue  — decide what is due, lease it, ask a worker to run it
 *   run      — one watch, its own invocation, its own budget
 *
 * The safety property that matters: if fan-out fails completely, nothing is
 * lost. The lease expires, the reaper hands the slot back, and the next wake
 * tries again. The system degrades to "slower" rather than to "silently wrong".
 */

export interface DispatchCounts {
  considered: number;
  completed: number;
  leased: number;
  executed: number;
  failed: number;
  reclaimed: number;
  abandoned: number;
  skipped: number;
}

/** How many watches one wake will start. Keeps a wake's cost predictable. */
export const DISPATCH_BATCH_LIMIT = 40;

/**
 * Asks something to run one watch. Injected so the enqueue path can be tested
 * without HTTP, and so the transport can change without touching this logic.
 */
export type WorkerInvoker = (job: { watchId: string; runId: string }) => Promise<void>;

/** Step 1: give back slots whose worker never came home. */
export async function reapExpiredRuns(
  repo: RailDropRepository,
  now: Date,
): Promise<{ reclaimed: number; abandoned: number }> {
  const expired = await repo.listExpiredRuns(now);
  let reclaimed = 0;
  let abandoned = 0;

  for (const run of expired) {
    const decision = reap(run, now);
    if (decision.action === "retry") {
      await repo.reclaimScheduledRun(run.id, decision.attempts);
      reclaimed += 1;
      logger.warn("dispatcher.lease_reclaimed", {
        run_id: run.id,
        watch_id: run.watchId,
        attempts: decision.attempts,
      });
    } else if (decision.action === "abandon") {
      await repo.abandonScheduledRun(run.id, decision.reason);
      abandoned += 1;
      // Loud: a slot nobody will ever check again is a promise broken to a
      // traveler, and it should never pass unnoticed.
      logger.error("dispatcher.slot_abandoned", {
        run_id: run.id,
        watch_id: run.watchId,
        attempts: run.attempts,
        reason: decision.reason,
      });
    }
  }
  return { reclaimed, abandoned };
}

/**
 * Step 2: work out what is due, lease it, and hand it to a worker.
 *
 * Returns fast. It runs no searches, so its cost is a query plus one lease and
 * one fan-out call per due watch.
 */
export async function dispatchScheduledChecks(input: {
  repo: RailDropRepository;
  invokeWorker: WorkerInvoker;
  now?: Date;
  batchLimit?: number;
}): Promise<DispatchCounts> {
  const now = input.now ?? new Date();
  const limit = input.batchLimit ?? DISPATCH_BATCH_LIMIT;

  const { reclaimed, abandoned } = await reapExpiredRuns(input.repo, now);

  const watches = await input.repo.listActiveWatches();
  let completed = 0;
  const due: Array<{ watchId: string; userId: string; slot: CheckSlot; localDate: string }> = [];

  for (const watch of watches) {
    if (
      shouldCompleteWatch({
        now,
        monitorEndAt: watch.monitorEndAt ? new Date(watch.monitorEndAt) : null,
        desiredTravelDate: watch.desiredTravelDate,
        flexibilityDays: watch.dateFlexibilityDays,
        timeZone: watch.timezone,
      })
    ) {
      await input.repo.updateWatch(watch.id, { status: "COMPLETED" });
      completed += 1;
      continue;
    }
    for (const slot of dueSlotsAt(now, watch.timezone)) {
      due.push({
        watchId: watch.id,
        userId: watch.userId,
        slot: slot.slot,
        localDate: slot.localDate,
      });
    }
  }

  // Drop slots that are already settled, or genuinely being worked on right
  // now, before choosing a batch. Without this a batch fills with watches that
  // were checked hours ago, every lease attempt is refused, and the wake makes
  // no progress — which is how 50 watches stalled at 8.
  const settled = new Set<string>();
  const checkedWatchIds = new Set<string>();
  const localDates = [...new Set(due.map((job) => job.localDate))];
  for (const run of await input.repo.listRunsForDates(localDates)) {
    const held =
      run.status === "DONE" ||
      run.status === "ABANDONED" ||
      (run.status === "RUNNING" && !isExpired(run, now));
    if (held) settled.add(`${run.watchId}:${run.localCheckDate}:${run.checkSlot}`);
    if (run.status === "DONE") checkedWatchIds.add(run.watchId);
  }
  const outstanding = due.filter(
    (job) => !settled.has(`${job.watchId}:${job.localDate}:${job.slot}`),
  );

  // A watch nobody has checked today outranks a second check for one already
  // done. Both matter, but the first is the promise the product made: a
  // traveler who is never checked at all is failed in a way that a traveler
  // who gets two of their three slots is not.
  const checkedToday = new Set(checkedWatchIds);
  const unchecked = outstanding.filter((job) => !checkedToday.has(job.watchId));
  const repeats = outstanding.filter((job) => checkedToday.has(job.watchId));

  // One user with twenty watches must not consume the whole wake.
  const batch = [
    ...fairBatch(unchecked, (job) => job.userId, limit),
    ...fairBatch(repeats, (job) => job.userId, Math.max(0, limit - unchecked.length)),
  ].slice(0, limit);
  const expiry = leaseExpiry(now);

  let leased = 0;
  let executed = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of batch) {
    const run = await input.repo.leaseScheduledRun({
      id: crypto.randomUUID(),
      watchId: job.watchId,
      localCheckDate: job.localDate,
      checkSlot: job.slot,
      now,
      leaseExpiresAt: expiry,
    });
    if (!run) {
      // Someone else holds it, or it is already done. Both are fine.
      skipped += 1;
      continue;
    }
    leased += 1;

    try {
      await input.invokeWorker({ watchId: job.watchId, runId: run.id });
      executed += 1;
    } catch (error) {
      // The lease stays. It will expire and be reclaimed, so a fan-out failure
      // costs a delay rather than a missed check.
      failed += 1;
      logger.error("dispatcher.worker_invoke_failed", {
        run_id: run.id,
        watch_id: job.watchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const counts: DispatchCounts = {
    considered: watches.length,
    completed,
    leased,
    executed,
    failed,
    reclaimed,
    abandoned,
    skipped,
  };
  logger.info("dispatcher.finished", {
    ...counts,
    due: due.length,
    outstanding: outstanding.length,
    batched: batch.length,
  });
  return counts;
}

/**
 * Step 3: run one watch, then close its lease.
 *
 * The lease is always closed, including on failure — a slot left RUNNING is
 * one the reaper has to clean up, and a slot left open is one nobody checks.
 */
export async function runLeasedWatch(input: {
  repo: RailDropRepository;
  provider: FareProvider;
  mailer?: Mailer;
  watchId: string;
  runId: string;
  slot?: CheckSlot;
  localCheckDate?: string;
  now?: Date;
}): Promise<{ ok: boolean; cycleId: string | null; reason?: string }> {
  const now = input.now ?? new Date();
  const watch = await input.repo.getWatch(input.watchId);
  if (!watch) {
    await input.repo.finishScheduledRun(input.runId, {
      status: "FAILED",
      failureReason: "Watch no longer exists.",
    });
    return { ok: false, cycleId: null, reason: "missing watch" };
  }

  try {
    const result = await runWatchCycle({
      watch,
      trigger: "SCHEDULED",
      checkSlot: input.slot ?? watch.nextCheckSlot ?? null,
      localCheckDate: input.localCheckDate,
      now,
      repo: input.repo,
      provider: input.provider,
      mailer: input.mailer,
    });
    // The cycle id is written back this time. It used to be assigned to a local
    // object and dropped, so every row in the table read "pending" forever.
    await input.repo.finishScheduledRun(input.runId, {
      status: "DONE",
      cycleId: result.cycle.id,
    });
    return { ok: true, cycleId: result.cycle.id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await input.repo.finishScheduledRun(input.runId, { status: "FAILED", failureReason: reason });
    logger.error("dispatcher.run_failed", { run_id: input.runId, watch_id: input.watchId, reason });
    return { ok: false, cycleId: null, reason };
  }
}

export function previewNextChecks(timeZone: string, now = new Date()) {
  return nextSlotAfter(now, timeZone);
}
