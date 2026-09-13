/**
 * Deterministic ranking. Price is always primary.
 *
 * Order:
 *   1. total party price ascending
 *   2. is the desired date (displacement 0)
 *   3. smaller |date displacement|
 *   4. closer to the preferred departure time (only when the user supplied one)
 *   5. fewer transfers
 *   6. shorter duration
 *   7. stronger fare flexibility
 *   8. stable tiebreak on journey id
 */

import { minutesOfDayFromLocalIso } from './dates';
import type { Candidate, FareFamily, Opportunity, Watch } from './types';

export const FARE_FAMILY_STRENGTH: Record<FareFamily, number> = {
  FLEXIBLE: 3,
  VALUE: 2,
  SAVER: 1,
  UNKNOWN: 0,
};

/** Minutes between a journey's departure and the user's preferred time. */
export function departureProximityMinutes(candidate: Candidate, preferred: number | null): number {
  if (preferred === null) return 0;
  try {
    return Math.abs(minutesOfDayFromLocalIso(candidate.journey.departureLocal) - preferred);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * Higher is more convenient. Used for ranking key #4 context and, crucially, by
 * the alert comparator to justify a second alert when a similarly priced option
 * is materially more convenient.
 */
export function convenienceScore(candidate: Candidate, watch: Watch): number {
  const displacement = Math.abs(candidate.searchDate.displacementDays);
  let score = 0;

  // Travelling on the day you actually wanted dominates every other comfort factor.
  score += displacement === 0 ? 100 : displacement === 1 ? 50 : 20;

  // Each connection is a real cost to the traveller.
  score -= candidate.journey.transfers * 15;

  // Preferred departure time, decaying to zero over a 4-hour miss.
  const preferred = watch.preferences.preferredDepartureMinutes;
  if (preferred !== null) {
    const delta = departureProximityMinutes(candidate, preferred);
    score += 30 * Math.max(0, 1 - Math.min(delta, 240) / 240);
  }

  // Flexibility has genuine option value after a fare drop.
  score += FARE_FAMILY_STRENGTH[candidate.fare.family] * 3;

  // Long journeys are less convenient; 3 points per hour.
  score -= (candidate.journey.durationMinutes / 60) * 3;

  return Math.round(score * 100) / 100;
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

export function compareCandidates(watch: Watch): (a: Candidate, b: Candidate) => number {
  const preferred = watch.preferences.preferredDepartureMinutes;
  return (a, b) => {
    // 1. price
    const byPrice = compareNumbers(a.fare.partyTotalCents, b.fare.partyTotalCents);
    if (byPrice !== 0) return byPrice;

    // 2. exact desired date wins
    const aExact = a.searchDate.displacementDays === 0 ? 0 : 1;
    const bExact = b.searchDate.displacementDays === 0 ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;

    // 3. smallest displacement
    const byDisplacement = compareNumbers(
      Math.abs(a.searchDate.displacementDays),
      Math.abs(b.searchDate.displacementDays),
    );
    if (byDisplacement !== 0) return byDisplacement;

    // 4. preferred departure proximity (only when supplied)
    if (preferred !== null) {
      const byTime = compareNumbers(
        departureProximityMinutes(a, preferred),
        departureProximityMinutes(b, preferred),
      );
      if (byTime !== 0) return byTime;
    }

    // 5. fewer transfers
    const byTransfers = compareNumbers(a.journey.transfers, b.journey.transfers);
    if (byTransfers !== 0) return byTransfers;

    // 6. shorter duration
    const byDuration = compareNumbers(a.journey.durationMinutes, b.journey.durationMinutes);
    if (byDuration !== 0) return byDuration;

    // 7. stronger flexibility
    const byFamily = compareNumbers(
      FARE_FAMILY_STRENGTH[b.fare.family],
      FARE_FAMILY_STRENGTH[a.fare.family],
    );
    if (byFamily !== 0) return byFamily;

    // 8. deterministic tiebreak
    const byId = a.journey.providerJourneyId.localeCompare(b.journey.providerJourneyId);
    if (byId !== 0) return byId;
    return a.fare.id.localeCompare(b.fare.id);
  };
}

export function rankCandidates(candidates: Candidate[], watch: Watch): Candidate[] {
  return [...candidates].sort(compareCandidates(watch));
}

export function rankOpportunities(opportunities: Opportunity[], watch: Watch): Opportunity[] {
  const cmp = compareCandidates(watch);
  return [...opportunities].sort((a, b) => cmp(a.candidate, b.candidate));
}
