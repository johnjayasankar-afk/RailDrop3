/* How long a cycle may keep searching before it has to write down what it has.
 *
 * On serverless the provider runs one page at a time, and a single date can
 * take 55 s to navigate plus 25 s for the first wait plus 28 s for trips plus a
 * settle, with a second attempt behind it. Three dates in a ±1 window can
 * therefore ask for several times the 300 s function ceiling. When that happens
 * the platform kills the invocation mid-flight: no cycle row is completed, no
 * snapshot is written, and the traveler sees the previous check as the latest
 * one with no indication that anything was attempted.
 *
 * A cycle that ran out of time should say so. Reserving the tail of the budget
 * lets it persist what it found, mark the dates it never reached, and finish as
 * PARTIAL_SUCCESS instead of vanishing.
 */

/** Vercel kills the function at 300 s (`vercel.json`). */
export const FUNCTION_CEILING_MS = 300_000;

/**
 * Time kept back for everything after the last search: writing snapshots,
 * ranking, the opportunity comparison, sending the alert, and the response.
 */
export const CYCLE_RESERVE_MS = 45_000;

export const CYCLE_SEARCH_BUDGET_MS = FUNCTION_CEILING_MS - CYCLE_RESERVE_MS;

export function searchDeadline(startedAt: Date, budgetMs: number = CYCLE_SEARCH_BUDGET_MS): number {
  return startedAt.getTime() + budgetMs;
}

/**
 * Whether there is time to start one more provider search.
 *
 * Deliberately not just "is the deadline past". Starting a search that cannot
 * finish is worse than skipping it: it spends a provider credit, holds the one
 * available page, and the invocation dies anyway. So the decision is made
 * against how long searches in *this* cycle have actually been taking, using
 * the slowest one seen — the pessimistic read, because overrunning costs the
 * whole cycle while stopping early costs one date.
 *
 * The first search always proceeds. A cycle that refuses to try anything has
 * learned nothing and is indistinguishable from an outage.
 */
export function hasTimeForAnotherSearch(input: {
  now: number;
  deadline: number;
  /** Latencies of completed live searches in this cycle, in ms. */
  observedMs: readonly number[];
}): boolean {
  const remaining = input.deadline - input.now;
  if (input.observedMs.length === 0) return true;
  if (remaining <= 0) return false;
  const slowest = Math.max(...input.observedMs);
  return remaining >= slowest;
}

/** What a date that was never attempted is called in logs and snapshots. */
export const DEADLINE_SKIP_MESSAGE =
  "Not checked: the cycle ran out of time before reaching this date.";
