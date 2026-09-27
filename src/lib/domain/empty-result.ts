/* Telling "no trains run that day" apart from "we failed to read the page".
 *
 * The provider can return a perfectly successful search with zero journeys in
 * it, and the app had exactly one interpretation for that: NO_INVENTORY, which
 * the board renders as "No trains are listed for this window on the live board
 * right now. That is what the corridor is showing, not a problem at our end."
 *
 * The provider eval found that sentence being false. PHL→NYP on one specific
 * date returns zero trains, reproducibly, while the next day on the same
 * corridor returns thirty-three. Philadelphia to New York runs dozens of
 * weekday trains; a day with no timetable at all is not inventory, it is a
 * failed read. And the app was confidently telling the traveler otherwise.
 *
 * The signal is already in hand and costs nothing: a cycle searches a window
 * of dates on one corridor. If its neighbours found trains and this one found
 * none, the empty one is not to be believed. Trains on a served corridor run
 * daily — they can sell out, in which case the trains are still listed with no
 * available fares, which is a different and detectable thing.
 *
 * What it deliberately will not do is guess when it has no evidence. A single
 * date with no neighbours, or a whole window that came back empty, could
 * genuinely be a pair of stations with no service between them. Those stay
 * NO_INVENTORY, because "we could not read it" would be just as unfounded a
 * claim in the other direction.
 */

export interface DateOutcome {
  travelDate: string;
  /** Journeys the provider returned, before any screening. */
  journeyCount: number;
  /** Whether the search itself succeeded. A failure is not evidence either way. */
  ok: boolean;
}

export type EmptyVerdict = "believable" | "suspect" | "no-evidence";

export interface EmptyAssessment {
  travelDate: string;
  verdict: EmptyVerdict;
  /** One line, for the snapshot's error message and the log. */
  reason: string | null;
}

/**
 * Trains a neighbouring date must have found before we distrust a zero.
 *
 * One is not enough: a corridor with a single daily train, where the neighbour
 * caught it and this date genuinely has none, would be wrongly failed. Several
 * trains on another day means a real timetable exists on this route.
 */
const NEIGHBOUR_EVIDENCE = 3;

/**
 * Which empty dates in this cycle are not to be believed.
 *
 * Only dates that came back empty are assessed; everything else is absent from
 * the result.
 */
export function assessEmptyDates(outcomes: readonly DateOutcome[]): EmptyAssessment[] {
  const answered = outcomes.filter((outcome) => outcome.ok);
  const best = answered.reduce((most, outcome) => Math.max(most, outcome.journeyCount), 0);
  const withTrains = answered.filter((outcome) => outcome.journeyCount > 0).length;

  return answered
    .filter((outcome) => outcome.journeyCount === 0)
    .map((outcome) => {
      if (withTrains === 0 || best < NEIGHBOUR_EVIDENCE) {
        return {
          travelDate: outcome.travelDate,
          verdict: "no-evidence" as const,
          reason: null,
        };
      }
      return {
        travelDate: outcome.travelDate,
        verdict: "suspect" as const,
        reason: `No trains at all on ${outcome.travelDate}, while other days in this window returned up to ${best}. A served corridor runs trains daily, so this is a failed read rather than an empty timetable.`,
      };
    });
}

/** Convenience for the cycle: the dates it should not call empty. */
export function suspectEmptyDates(outcomes: readonly DateOutcome[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const assessment of assessEmptyDates(outcomes)) {
    if (assessment.verdict === "suspect" && assessment.reason) {
      out.set(assessment.travelDate, assessment.reason);
    }
  }
  return out;
}
