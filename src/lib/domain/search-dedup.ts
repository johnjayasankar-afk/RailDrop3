/* One Chromium run per corridor and date, even when workers race.
 *
 * Reuse itself already worked: a completed provider_requests row is matched by
 * canonical search key inside a freshness window and its journeys come back
 * from search_cache, so a second watch on the same corridor costs nothing.
 *
 * What broke it was fan-out. While dispatch ran watches one at a time, the
 * second watch always saw the first one's finished row. Now that every watch
 * gets its own invocation, two workers can start the same search in the same
 * second, both find no completed row, and both launch a browser. The cache is
 * not wrong — it is just too late to help.
 *
 * So a search announces itself before it runs. A worker that finds someone
 * else already in flight waits for that result instead of duplicating it, and
 * gives up waiting rather than stalling its own cycle.
 */

/** How long a completed search may be reused. Matches the cycle's own window. */
export const SEARCH_FRESHNESS_MS = 20 * 60 * 1000;

/**
 * How long an in-flight marker is believed.
 *
 * A Chromium search can take most of a minute, and the worker holding it may
 * die without cleaning up. Past this the marker is treated as abandoned and
 * the next worker does the search itself — a duplicate run costs money, but a
 * corridor nobody ever searches costs the traveler their alert.
 */
export const IN_FLIGHT_TTL_MS = 90_000;

/** Total time a worker will wait for somebody else's search before doing its own. */
export const MAX_WAIT_FOR_PEER_MS = 25_000;

/** Gap between checks while waiting. */
export const PEER_POLL_INTERVAL_MS = 1_000;

export type SearchPlan =
  /** Nothing usable exists; this worker should run the search. */
  | { action: "search" }
  /** A completed, fresh result exists. */
  | { action: "reuse"; requestId: string }
  /** Someone else is running it; wait for them, then re-check. */
  | { action: "wait"; msRemaining: number };

export interface SearchRowLike {
  id: string;
  status: string;
  createdAt: string;
}

/**
 * What to do about a search key, given the newest row for it.
 *
 * Pure so the waiting rules can be tested without a database or a clock.
 */
export function planSearch(input: {
  newest: SearchRowLike | null;
  now: Date;
  waitedMs: number;
  freshnessMs?: number;
  inFlightTtlMs?: number;
  maxWaitMs?: number;
}): SearchPlan {
  const freshness = input.freshnessMs ?? SEARCH_FRESHNESS_MS;
  const ttl = input.inFlightTtlMs ?? IN_FLIGHT_TTL_MS;
  const maxWait = input.maxWaitMs ?? MAX_WAIT_FOR_PEER_MS;
  const row = input.newest;
  if (!row) return { action: "search" };

  const age = input.now.getTime() - Date.parse(row.createdAt);
  if (Number.isNaN(age)) return { action: "search" };

  if (row.status === "IN_FLIGHT") {
    // Abandoned marker: the worker that claimed it is not coming back.
    if (age >= ttl) return { action: "search" };
    const remaining = maxWait - input.waitedMs;
    if (remaining <= 0) return { action: "search" };
    return { action: "wait", msRemaining: remaining };
  }

  // A failure is not a result. Re-running it is the point of retrying.
  if (row.status === "PROVIDER_ERROR") return { action: "search" };

  if (age <= freshness) return { action: "reuse", requestId: row.id };
  return { action: "search" };
}
