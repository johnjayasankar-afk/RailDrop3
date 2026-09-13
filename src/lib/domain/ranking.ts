import { dateOffsetDays } from "./calendar";
import { preferredTimeDeltaMinutes } from "./timezone";
import type { EligibleFare } from "./eligibility";
import type { RankedCandidate } from "./types";

export interface RankingContext {
  desiredTravelDate: string;
  preferredDepartureTime: string | null;
  currentBookedPriceCents: number;
}

export function rankCandidates(
  eligible: EligibleFare[],
  context: RankingContext,
): RankedCandidate[] {
  const ranked = eligible
    .filter((item) => item.fare.totalPartyPriceCents !== null)
    .map((item) => toRankedCandidate(item, context));

  ranked.sort(compareRankedCandidates);
  return ranked;
}

export function toRankedCandidate(item: EligibleFare, context: RankingContext): RankedCandidate {
  const totalPartyPriceCents = item.fare.totalPartyPriceCents ?? Number.MAX_SAFE_INTEGER;
  return {
    journey: item.journey,
    fare: item.fare,
    totalPartyPriceCents,
    savingsCents: context.currentBookedPriceCents - totalPartyPriceCents,
    dateOffsetDays: dateOffsetDays(context.desiredTravelDate, item.journey.searchedTravelDate),
    preferredTimeDeltaMinutes: preferredTimeDeltaMinutes(
      item.journey.departureAt,
      context.preferredDepartureTime,
    ),
    rankScore: 0,
  };
}

export function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate): number {
  if (a.totalPartyPriceCents !== b.totalPartyPriceCents) {
    return a.totalPartyPriceCents - b.totalPartyPriceCents;
  }
  const aSameDay = a.dateOffsetDays === 0 ? 0 : 1;
  const bSameDay = b.dateOffsetDays === 0 ? 0 : 1;
  if (aSameDay !== bSameDay) return aSameDay - bSameDay;
  if (Math.abs(a.dateOffsetDays) !== Math.abs(b.dateOffsetDays)) {
    return Math.abs(a.dateOffsetDays) - Math.abs(b.dateOffsetDays);
  }
  if (a.dateOffsetDays !== b.dateOffsetDays) {
    return a.dateOffsetDays - b.dateOffsetDays;
  }
  const aTime = a.preferredTimeDeltaMinutes ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.preferredTimeDeltaMinutes ?? Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  if (a.journey.transferCount !== b.journey.transferCount) {
    return a.journey.transferCount - b.journey.transferCount;
  }
  const aDuration = a.journey.durationMinutes ?? Number.MAX_SAFE_INTEGER;
  const bDuration = b.journey.durationMinutes ?? Number.MAX_SAFE_INTEGER;
  if (aDuration !== bDuration) return aDuration - bDuration;
  const aFlex = a.fare.fareFamily === "FLEXIBLE" ? 0 : 1;
  const bFlex = b.fare.fareFamily === "FLEXIBLE" ? 0 : 1;
  if (aFlex !== bFlex) return aFlex - bFlex;
  return a.journey.id.localeCompare(b.journey.id);
}

export function cheapestByDate(ranked: RankedCandidate[]): Map<string, RankedCandidate> {
  const map = new Map<string, RankedCandidate>();
  for (const candidate of ranked) {
    const date = candidate.journey.searchedTravelDate;
    const existing = map.get(date);
    if (!existing || candidate.totalPartyPriceCents < existing.totalPartyPriceCents) {
      map.set(date, candidate);
    }
  }
  return map;
}
