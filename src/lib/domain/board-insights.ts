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
