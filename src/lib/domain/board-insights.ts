import { departureBucket, type TimeBucket } from "./board-tools";
import type { RankedCandidate } from "./types";

export function isOvernight(departureAt: string, arrivalAt: string): boolean {
  const depart = departureAt.slice(0, 10);
  const arrive = arrivalAt.slice(0, 10);
  return Boolean(depart && arrive && depart !== arrive);
}

export function waitMinutes(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.round((to - from) / 60_000);
}

/* How many changes, and where — from the provider's own count.
 *
 * connectionNote returned "Nonstop" when `transferCount === 0 || legs.length
 * < 2`, and this repository's own representative connecting itinerary trips
 * that second clause: the Lake Shore Limited entry in wanderu-trips.json has
 * `transfers: 2` and exactly ONE itinerary leg, because
 * wanderu-normalizer.ts builds `legs` from the train legs only and a
 * train-bus-train journey loses its middle. So a two-change trip rendered
 * with no change flag at all — the board said nothing, and a reader who
 * knows a nonstop is unmarked read that silence as "nonstop".
 *
 * The count now comes from `transferCount` and nothing else. Everything
 * derived from `legs` is guarded by whether the legs we were given account
 * for the changes we were told about:
 *
 *   - the connecting station is named only when consecutive legs agree on
 *     it, and never when it is the normalizer's "—" placeholder;
 *   - the minutes between legs are printed only when `legs.length - 1`
 *     equals `transferCount`, because otherwise the subtraction spans a leg
 *     the reader was never shown.
 *
 * The old "tight connection" and "layover" thresholds are gone. Twenty
 * minutes and ninety minutes were editorial policy that exists nowhere in
 * the data, rendered as though the provider had said it.
 */
export interface ChangeNote {
  changes: number;
  /** Null when there is nothing to say, which is also how "nonstop" is said. */
  label: string | null;
}

const UNKNOWN_STATION = "—";

export function changeNote(candidate: RankedCandidate): ChangeNote {
  const changes = candidate.journey.transferCount;
  if (changes <= 0) return { changes: 0, label: null };

  const legs = candidate.journey.legs;
  const legsAccountForChanges = legs.length - 1 === changes;

  const stations: string[] = [];
  for (let index = 0; index < legs.length - 1; index += 1) {
    const arriving = legs[index]!.destinationCode;
    const leaving = legs[index + 1]!.originCode;
    if (arriving === leaving && arriving !== UNKNOWN_STATION) stations.push(arriving);
  }

  const noun = changes === 1 ? "change" : "changes";
  if (!legsAccountForChanges) {
    /* We were told how many changes and not where. Saying so beats naming a
       station we are guessing at, and beats saying nothing. */
    return { changes, label: `${changes} ${noun}, station not stated` };
  }

  const waits: number[] = [];
  for (let index = 0; index < legs.length - 1; index += 1) {
    const wait = waitMinutes(legs[index]!.arrivalAt, legs[index + 1]!.departureAt);
    if (wait != null) waits.push(wait);
  }
  const tightest = waits.length ? Math.min(...waits) : null;

  const where = stations.length === changes ? ` at ${stations.join(", ")}` : "";
  const how = tightest == null ? "" : ` · ${tightest}m to connect`;
  return { changes, label: `${changes} ${noun}${where}${how}` };
}

/* The cheapest departure in each part of ONE day, with the sample size.
 *
 * cheapestByBucket pools the whole window, so a "morning" minimum drawn from
 * Oct 1 could sit beside an "afternoon" minimum drawn from Oct 3 and render
 * as a time-of-day pattern when it is purely a date effect — the exact
 * confound this product refuses to make everywhere else. Sitting directly
 * under "cheapest day in this window", it also invited the reader to compose
 * the two into a date-and-time nobody had checked existed together.
 *
 * One date, named in the heading, and the count of fares behind each cell,
 * because the methodology page says: "If a number appears without something
 * next to it saying how much was seen, that is a bug."
 */
export function cheapestByBucketOnDate(
  ranked: RankedCandidate[],
  travelDate: string,
): Record<TimeBucket, { candidate: RankedCandidate; count: number } | null> {
  const onDate = ranked.filter((c) => c.journey.searchedTravelDate === travelDate);
  const result: Record<TimeBucket, { candidate: RankedCandidate; count: number } | null> = {
    morning: null,
    afternoon: null,
    evening: null,
  };
  for (const candidate of onDate) {
    const bucket = departureBucket(candidate.journey.departureAt);
    const current = result[bucket];
    if (!current) {
      result[bucket] = { candidate, count: 1 };
    } else {
      result[bucket] = {
        candidate:
          candidate.totalPartyPriceCents < current.candidate.totalPartyPriceCents
            ? candidate
            : current.candidate,
        count: current.count + 1,
      };
    }
  }
  return result;
}

export function cheapestByBucket(
  ranked: RankedCandidate[],
): Record<TimeBucket, RankedCandidate | null> {
  const result: Record<TimeBucket, RankedCandidate | null> = {
    morning: null,
    afternoon: null,
    evening: null,
  };
  for (const candidate of ranked) {
    const bucket = departureBucket(candidate.journey.departureAt);
    const current = result[bucket];
    if (!current || candidate.totalPartyPriceCents < current.totalPartyPriceCents) {
      result[bucket] = candidate;
    }
  }
  return result;
}

export function fastestCheaper(ranked: RankedCandidate[]): RankedCandidate | null {
  const cheaper = ranked.filter((candidate) => candidate.savingsCents > 0);
  if (cheaper.length === 0) return null;
  return cheaper.reduce((best, item) => {
    const bestDuration = best.journey.durationMinutes ?? Number.MAX_SAFE_INTEGER;
    const itemDuration = item.journey.durationMinutes ?? Number.MAX_SAFE_INTEGER;
    if (itemDuration !== bestDuration) return itemDuration < bestDuration ? item : best;
    return item.totalPartyPriceCents < best.totalPartyPriceCents ? item : best;
  });
}

export function cheaperCount(ranked: RankedCandidate[]): number {
  return ranked.filter((candidate) => candidate.savingsCents > 0).length;
}

export function sparklineValues(
  events: Array<{ newPriceCents: number }>,
  current: number,
): number[] {
  const values = events.map((event) => event.newPriceCents);
  values.push(current);
  return values.filter((value) => Number.isFinite(value) && value > 0);
}
