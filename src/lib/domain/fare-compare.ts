import { durationDeltaMinutes, formatDurationDelta, trainLabel } from "./board-decision";
import { formatDisplayDate } from "./calendar";
import { formatUsdCompact } from "./money";
import type { RankedCandidate } from "./types";

/* Two trains, and only what differs between them.
 *
 * The one thing no ordering can produce is a selection. Sorting by price
 * puts the $91 four-hour next to the $95 three-and-a-half and leaves the
 * $141 three-hour fourteen rows away; sorting by duration inverts it. The
 * per-row cost-per-hour column exists because somebody already noticed this
 * gap and tried to close it with a ratio — and the comment beside it
 * concedes that the ratio argues for the wrong train, because a figure
 * measured per hour aboard rewards being aboard longer.
 *
 * Subtraction closes it properly. Everything below is a signed difference
 * between two observed figures, oriented from the first pinned train to the
 * second, with the sign convention fixed in this one place: a flipped sign
 * here does not degrade gracefully, it prints a sentence that is false.
 *
 * There is deliberately no rate delta. Price and time already contain it,
 * and "$12/hr less" is this project's own documented failure mode with its
 * safety label taken off. There is no winner, no "better value", and no
 * colour on the cheaper side — a green figure is a recommendation, and
 * which train is better depends on things we were never told.
 */
export interface FareComparison {
  /** Named so the reader knows which two rows these differences are about. */
  from: string;
  to: string;
  /** Leads when the two are on different days: that is a different trip. */
  differentDays: string | null;
  clauses: string[];
}

export function compareFares(a: RankedCandidate, b: RankedCandidate): FareComparison {
  const clauses: string[] = [];

  const price = b.totalPartyPriceCents - a.totalPartyPriceCents;
  if (price === 0) {
    clauses.push("same price");
  } else {
    clauses.push(`${formatUsdCompact(Math.abs(price))} ${price > 0 ? "more" : "less"}`);
  }

  /* Both duration-derived clauses drop out when either duration is missing,
     matching the row's own "duration unknown" rather than inventing a zero. */
  const time = formatDurationDelta(durationDeltaMinutes(a, b));
  if (time) clauses.push(time);

  const changes = b.journey.transferCount - a.journey.transferCount;
  if (changes !== 0) {
    const n = Math.abs(changes);
    clauses.push(`${n} ${n === 1 ? "change" : "changes"} ${changes > 0 ? "more" : "fewer"}`);
  }

  /* A clause, not an item in the list: position in a dot-separated run is not
     disclosure that the reader is comparing two trips rather than two trains. */
  const differentDays =
    a.journey.searchedTravelDate === b.journey.searchedTravelDate
      ? null
      : `Different days — ${formatDisplayDate(a.journey.searchedTravelDate)} against ${formatDisplayDate(b.journey.searchedTravelDate)}`;

  return { from: trainLabel(a), to: trainLabel(b), differentDays, clauses };
}
