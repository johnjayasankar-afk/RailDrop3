import { meetsSavingsThreshold } from "./money";
import type { AlertDecision, OpportunityFingerprint, RankedCandidate } from "./types";

const MEANINGFUL_PRICE_IMPROVEMENT_CENTS = 100;

export function journeyKey(candidate: RankedCandidate): string {
  return [
    candidate.journey.searchedTravelDate,
    candidate.journey.trainNumber ?? candidate.journey.serviceName ?? "unknown",
    candidate.journey.departureAt,
    candidate.fare.fareFamily,
    candidate.fare.travelClass,
    String(candidate.totalPartyPriceCents),
  ].join("|");
}

export function buildOpportunityFingerprint(
  qualifying: RankedCandidate[],
): OpportunityFingerprint | null {
  if (qualifying.length === 0) return null;
  const best = qualifying[0];
  const sameDay = qualifying.find((candidate) => candidate.dateOffsetDays === 0) ?? null;
  return {
    bestJourneyKey: journeyKey(best),
    bestPriceCents: best.totalPartyPriceCents,
    bestTravelDate: best.journey.searchedTravelDate,
    sameDayBestPriceCents: sameDay?.totalPartyPriceCents ?? null,
    sameDayJourneyKey: sameDay ? journeyKey(sameDay) : null,
    qualifyingCount: qualifying.length,
  };
}

export function qualifyingCandidates(
  ranked: RankedCandidate[],
  bookedPriceCents: number,
  minimumSavingsCents: number,
): RankedCandidate[] {
  return ranked.filter((candidate) =>
    meetsSavingsThreshold(bookedPriceCents, candidate.totalPartyPriceCents, minimumSavingsCents),
  );
}

export function compareOpportunities(
  previous: OpportunityFingerprint | null,
  next: OpportunityFingerprint | null,
): AlertDecision {
  if (!next) {
    return { notify: false, reason: "no_qualifying" };
  }
  if (!previous) {
    return { notify: true, reason: "first_qualifying" };
  }
  if (next.bestPriceCents <= previous.bestPriceCents - MEANINGFUL_PRICE_IMPROVEMENT_CENTS) {
    return { notify: true, reason: "better_price" };
  }
  if (isMeaningfullyMoreConvenient(previous, next)) {
    return { notify: true, reason: "better_convenience" };
  }
  return { notify: false, reason: "unchanged" };
}

function isMeaningfullyMoreConvenient(
  previous: OpportunityFingerprint,
  next: OpportunityFingerprint,
): boolean {
  if (previous.sameDayBestPriceCents !== null) return false;
  if (next.sameDayBestPriceCents === null) return false;
  const gap = next.sameDayBestPriceCents - next.bestPriceCents;
  return gap <= 1000;
}

export class OpportunityComparator {
  decide(
    previous: OpportunityFingerprint | null,
    ranked: RankedCandidate[],
    bookedPriceCents: number,
    minimumSavingsCents: number,
  ): {
    decision: AlertDecision;
    fingerprint: OpportunityFingerprint | null;
    qualifying: RankedCandidate[];
  } {
    const qualifying = qualifyingCandidates(ranked, bookedPriceCents, minimumSavingsCents);
    const fingerprint = buildOpportunityFingerprint(qualifying);
    return {
      decision: compareOpportunities(previous, fingerprint),
      fingerprint,
      qualifying,
    };
  }
}
