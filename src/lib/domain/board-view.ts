import { filterBoard, type TimeBucket } from "./board-tools";
import type { RankedCandidate } from "./types";

/* Narrowing the board you already paid for.
 *
 * A ±2-day window returns ten to forty fares across up to five dates in one
 * flat list whose only control was a three-way sort — so most of the rows
 * are for days the reader is not travelling, and the only way to see fewer
 * was to run another ten-seconds-per-date scrape. `filterBoard` had
 * implemented every predicate needed since before the rewrite and was
 * imported by nothing.
 *
 * This wraps it and whitelists the three predicates the interface actually
 * offers. `savingsOnly` is deliberately unreachable: it filters on
 * `savingsCents`, which is derived from the private figure the reader types
 * into "what you paid", and no code path or URL should be able to select it.
 */
export interface BoardView {
  /** An ISO date, or "all". */
  date: string | "all";
  bucket: TimeBucket | "all";
  nonstopOnly: boolean;
  /** "HH:MM", or "" for no bound. Unparseable text means no bound. */
  departAfter: string;
}

export const WHOLE_BOARD: BoardView = {
  date: "all",
  bucket: "all",
  nonstopOnly: false,
  departAfter: "",
};

export function viewIsNarrowed(view: BoardView): boolean {
  return (
    view.date !== "all" ||
    view.bucket !== "all" ||
    view.nonstopOnly ||
    parseClock(view.departAfter) !== null
  );
}

/* "17" and "5pm" are things people type into a time field.
 *
 * filterBoard treats an unparseable non-empty string as "match nothing" —
 * the regex fails and every candidate returns false — so the board emptied
 * completely on the first keystroke of a valid time. Unparseable means no
 * bound, and the caller shows nothing is being filtered. */
export function parseClock(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^([01]?\d|2[0-3]):([0-5]\d)$/.test(trimmed) ? trimmed : null;
}

export function narrow(ranked: RankedCandidate[], view: BoardView): RankedCandidate[] {
  return filterBoard(ranked, {
    dateFilter: view.date,
    service: view.nonstopOnly ? "direct" : "all",
    bucket: view.bucket,
    // Never reachable from the interface: it filters on the reader's own
    // private "what you paid" figure.
    savingsOnly: false,
    departAfter: parseClock(view.departAfter),
  });
}

/* The headline stays bound to the whole reading, which is correct — it
 * describes what was read, and a filter is a way of looking at that, not a
 * different reading. But it means the page can print "$91 · cheapest of 34
 * listed" directly above a list that does not contain $91, which is the
 * exact symptom a previous fix went to some trouble to eliminate. Saying it
 * out loud in the filter row is the honest resolution: the figure above is
 * still true, and this says where it went.
 */
export function orphanedHeadline(
  filtered: RankedCandidate[],
  cheapest: RankedCandidate | undefined,
): RankedCandidate | null {
  if (!cheapest) return null;
  return filtered.includes(cheapest) ? null : cheapest;
}
