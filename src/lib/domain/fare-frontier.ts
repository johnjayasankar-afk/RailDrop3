import type { RankedCandidate } from "./types";

/* Which fares are not beaten on both price and journey time.
 *
 * Deliberately a function with no interface attached. Both dominance
 * proposals that reached this module — dimming "beaten outright" rows, and
 * drawing a staircase of the undominated set — assumed the relation fires
 * often enough to be worth a panel, and on real Northeast Corridor data it
 * does not. A timetable is near-monotone by construction, so strict
 * dominance needs a schedule overtake AND the overtaker to be no dearer,
 * while on this corridor the faster service is the expensive one. On the
 * repository's own fixtures the frontier collapses to a single point and
 * there is no staircase to draw.
 *
 * So: the relation is computed and tested, the size can be logged against
 * real searches, and nothing is drawn until a real board is observed with
 * enough points on its frontier to be worth drawing. "6 of 23 are beaten
 * outright" is not a sentence anyone here has an observation behind.
 *
 * Three decisions that matter if it is ever drawn:
 *
 *   - WEAK dominance (<= on both, strictly better on one). Requiring strict
 *     on both never eliminates equal-duration fares, so a $74 and a $59
 *     fare on the same train at the same minute would both be "undominated".
 *   - ONE date at a time. Pooling a window puts a whole column of prices at
 *     one train's duration and asserts cross-day comparability, which this
 *     product refuses everywhere else.
 *   - The honest claim is "not beaten on both price and journey time", never
 *     "worth considering". Dominance says nothing about the fare's own
 *     conditions, and the normalizer sets fareFamily UNKNOWN precisely
 *     because inventing a fare's attributes is the same failure as
 *     inventing its price.
 */
export interface FrontierResult {
  travelDate: string;
  /** Fares not beaten on both price and journey time. */
  frontier: RankedCandidate[];
  /** How many fares on this date were considered at all. */
  considered: number;
}

function comparable(candidate: RankedCandidate): boolean {
  return (
    candidate.journey.durationMinutes != null &&
    candidate.journey.durationMinutes > 0 &&
    candidate.totalPartyPriceCents > 0
  );
}

export function fareFrontier(
  ranked: readonly RankedCandidate[],
  travelDate: string,
): FrontierResult {
  const onDate = ranked.filter((c) => c.journey.searchedTravelDate === travelDate && comparable(c));

  /* Exact (price, duration) duplicates collapse to the first seen: two fare
     families on one train are one point, and keeping both would report a
     frontier of two where there is one train. */
  const seen = new Set<string>();
  const points = onDate.filter((c) => {
    const key = `${c.totalPartyPriceCents}:${c.journey.durationMinutes}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const frontier = points.filter(
    (candidate) =>
      !points.some((other) => {
        // Two fares on the same journey are not alternatives to each other.
        if (other === candidate || other.journey.id === candidate.journey.id) return false;
        const cheaperOrSame = other.totalPartyPriceCents <= candidate.totalPartyPriceCents;
        const fasterOrSame = other.journey.durationMinutes! <= candidate.journey.durationMinutes!;
        const strictlyBetter =
          other.totalPartyPriceCents < candidate.totalPartyPriceCents ||
          other.journey.durationMinutes! < candidate.journey.durationMinutes!;
        return cheaperOrSame && fasterOrSame && strictlyBetter;
      }),
  );

  return { travelDate, frontier, considered: onDate.length };
}
