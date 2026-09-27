/* Applying fare-sanity to a whole search.
 *
 * Kept apart from fare-sanity.ts because that module answers "is this one row
 * believable" and this one answers "what do we do about it" — a policy, and one
 * worth being able to read on its own.
 *
 * The policy: drop the fares that cannot be believed, drop a journey once it
 * has no believable fare left, and if enough of the search failed, hand back
 * nothing at all. Partial trust is the trap. A parser that produces obviously
 * wrong rows is also producing subtly wrong ones, and the subtle ones are the
 * ones that get emailed.
 */

import {
  checkFare,
  searchIntegrity,
  type IntegrityVerdict,
  type SanityContext,
} from "./fare-sanity";
import type { JourneyOption } from "./types";

export interface ScreenedSearch {
  /** What survived. Empty when the search as a whole could not be believed. */
  journeys: JourneyOption[];
  verdict: IntegrityVerdict;
}

export function screenJourneys(
  journeys: readonly JourneyOption[],
  context: SanityContext,
): ScreenedSearch {
  const perFare: Array<{ rejections: ReturnType<typeof checkFare> }> = [];
  const kept: JourneyOption[] = [];

  for (const journey of journeys) {
    const fares = journey.fares.filter((fare) => {
      const rejections = checkFare(journey, fare, context);
      perFare.push({ rejections });
      return rejections.length === 0;
    });
    // A journey with no believable fare is not a journey we can show: the board
    // ranks on price and there is no price left to rank on.
    if (fares.length > 0) kept.push({ ...journey, fares });
  }

  const verdict = searchIntegrity(perFare);
  // All or nothing once the parser is suspect — see the note above.
  return { journeys: verdict.trustworthy ? kept : [], verdict };
}
