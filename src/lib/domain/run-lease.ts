/* Leases on a scheduled check.
 *
 * The old claim was an insert: the row existed, therefore the slot was spent.
 * When a cron invocation timed out halfway through its loop, every watch it had
 * reached held a spent slot with no work done, and the next wake read that row
 * as "already handled". Travelers went unchecked and nothing logged an error.
 *
 * A lease separates two facts that the insert conflated: someone is working on
 * this, and this is finished. Only the second is permanent. The first expires,
 * and an expired one is evidence of a crash.
 */

export type RunStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "ABANDONED";

/**
 * How long a worker may hold a slot before the reaper assumes it died.
 *
 * Longer than the 300 s function ceiling, so a worker that is merely slow is
 * never reclaimed out from under itself while still running. The extra minute
 * covers the platform's own start-up and teardown.
 */
export const LEASE_MS = 360_000;

/**
 * Attempts before a slot is given up on.
 *
 * Three real chances. A slot that has failed three times is failing for a
 * reason that a fourth attempt will not fix, and continuing to retry it would
 * spend provider budget on a corridor that cannot be searched.
 */
export const MAX_ATTEMPTS = 3;

export interface LeaseRow {
  status: RunStatus;
  attempts: number;
  leaseExpiresAt: string | null;
}

/** A lease nobody is coming back to finish. */
export function isExpired(row: LeaseRow, now: Date): boolean {
  if (row.status !== "RUNNING") return false;
  if (!row.leaseExpiresAt) return true; // RUNNING with no expiry is corrupt; reclaim it
  const expiry = Date.parse(row.leaseExpiresAt);
  if (Number.isNaN(expiry)) return true;
  return expiry <= now.getTime();
}

export type ReapDecision =
  | { action: "retry"; attempts: number }
  | { action: "abandon"; attempts: number; reason: string }
  | { action: "leave" };

/**
 * What the reaper does with one row.
 *
 * Pure, so the policy can be tested without a database — and so "how many
 * chances does a slot get" is a decision written in one place rather than
 * implied by a SQL statement.
 */
export function reap(row: LeaseRow, now: Date, maxAttempts = MAX_ATTEMPTS): ReapDecision {
  if (!isExpired(row, now)) return { action: "leave" };
  const attempts = row.attempts;
  if (attempts >= maxAttempts) {
    return {
      action: "abandon",
      attempts,
      reason: `Lease expired ${attempts} times; giving up on this slot.`,
    };
  }
  return { action: "retry", attempts: attempts + 1 };
}

/** When a lease taken now should expire. */
export function leaseExpiry(now: Date, leaseMs = LEASE_MS): string {
  return new Date(now.getTime() + leaseMs).toISOString();
}

/**
 * Fair share of one dispatch across users.
 *
 * Without this, a user with twenty watches takes twenty of the worker slots in
 * a wake and everyone else waits for the next hour. Round-robin by user: one
 * watch each, then a second each, and so on, until the batch is full.
 *
 * Deliberately not "sort by user then slice": that is the same starvation with
 * extra steps.
 */
export function fairBatch<T>(items: readonly T[], userOf: (item: T) => string, limit: number): T[] {
  if (limit <= 0) return [];
  const byUser = new Map<string, T[]>();
  for (const item of items) {
    const key = userOf(item);
    const list = byUser.get(key);
    if (list) list.push(item);
    else byUser.set(key, [item]);
  }

  const batch: T[] = [];
  const queues = [...byUser.values()];
  let round = 0;
  while (batch.length < limit) {
    let tookAny = false;
    for (const queue of queues) {
      const item = queue[round];
      if (item === undefined) continue;
      batch.push(item);
      tookAny = true;
      if (batch.length >= limit) break;
    }
    if (!tookAny) break;
    round += 1;
  }
  return batch;
}
