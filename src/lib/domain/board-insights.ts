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

export function connectionNote(candidate: RankedCandidate): {
  quality: "direct" | "tight" | "ok" | "long";
  label: string;
} {
  if (candidate.journey.transferCount === 0 || candidate.journey.legs.length < 2) {
    return { quality: "direct", label: "Nonstop" };
  }
  const waits: number[] = [];
  for (let index = 0; index < candidate.journey.legs.length - 1; index += 1) {
    const wait = waitMinutes(
      candidate.journey.legs[index]!.arrivalAt,
      candidate.journey.legs[index + 1]!.departureAt,
    );
    if (wait != null) waits.push(wait);
  }
  const tightest = waits.length ? Math.min(...waits) : null;
  const longest = waits.length ? Math.max(...waits) : null;
  if (tightest != null && tightest < 20) {
    return { quality: "tight", label: `${tightest}m tight connection` };
  }
  if (longest != null && longest >= 90) {
    return { quality: "long", label: `${longest}m layover` };
  }
  return {
    quality: "ok",
    label: `${candidate.journey.transferCount} transfer${candidate.journey.transferCount === 1 ? "" : "s"}`,
  };
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
