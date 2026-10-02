import { changeNote, isOvernight } from "./board-insights";
import type { RankedCandidate } from "./types";

/* What kind of journey this is, beyond its price.
 *
 * transferCount, legs[] and the two timestamps were all in the data and on no
 * screen. The board showed "$154 · 10H 12M · $15/hr" for an overnight
 * connecting train directly above "$167 · 4H 02M · $41/hr" for a nonstop, and
 * the only thing distinguishing them was a duration the reader had to convert
 * in their head — while the cost-per-hour column actively argued for the
 * overnight, because a figure measured per hour aboard rewards being aboard
 * longer.
 *
 * These are facts, not advice. Each one is read straight off the journey:
 * whether the arrival date differs from the departure date, how many
 * transfers the provider reported, and the gap between the legs it gave us.
 * The product does not say which train to take; it says what the train is.
 */
export type FlagTone = "plain" | "warn";

export interface JourneyFlag {
  label: string;
  tone: FlagTone;
}

export interface JourneyShape {
  flags: JourneyFlag[];
  /** Direct and same-day: nothing worth saying. */
  unremarkable: boolean;
}

export function journeyShape(candidate: RankedCandidate): JourneyShape {
  const flags: JourneyFlag[] = [];

  if (isOvernight(candidate.journey.departureAt, candidate.journey.arrivalAt)) {
    flags.push({ label: "arrives next day", tone: "warn" });
  }

  /* The count comes from the provider's own transferCount. A nonstop gets no
     flag rather than the word "nonstop": the absence already says it, and
     asserting it would have been false for the two-change single-leg
     journeys the old helper classified as direct.

     Tone stays plain. A change is a fact about the journey, not a warning —
     "warn" is for the two things that change what the trip IS: landing on a
     different day, and a fare the provider itself called limited. */
  const change = changeNote(candidate);
  if (change.label) flags.push({ label: change.label, tone: "plain" });

  /* The board filters to available fares, so LIMITED is the only status worth
     surfacing: a seat the provider said was scarce when we looked, which is
     the one case where "confirm on Amtrak" is more than boilerplate. We do not
     say how many seats, because we were not told how many. */
  if (candidate.fare.availability === "LIMITED") {
    flags.push({ label: "limited when we looked", tone: "warn" });
  }

  return { flags, unremarkable: flags.length === 0 };
}
