/**
 * OpportunityEngine — benchmark vs. every eligible candidate on every valid date.
 *
 * Qualification rule (from the product spec):
 *     candidate_party_total  ≤  benchmark − minimum_savings
 */

import { calendarDateFromLocalIso } from './dates';
import type { Cents } from './money';
import { convenienceScore, rankOpportunities } from './ranking';
import type { Candidate, EligibilityOutcome, Opportunity, Watch } from './types';

/** Stable identity of an itinerary+fare, deliberately excluding price. */
export function opportunitySignature(candidate: Candidate): string {
  const { journey, fare } = candidate;
  const date = journey.travelDate || calendarDateFromLocalIso(journey.departureLocal);
  const train = journey.trainNumber ?? journey.providerJourneyId;
  return [date, train, journey.departureLocal, fare.family, fare.travelClass].join('|');
}

export interface OpportunityInput {
  watch: Watch;
  benchmarkCents: Cents;
  eligibility: EligibilityOutcome;
}

export interface OpportunityOutput {
  /** Qualifying options, ranked. */
  opportunities: Opportunity[];
  /** Every eligible candidate ranked, qualifying or not — powers the fare strip. */
  allRanked: Opportunity[];
  /** Cheapest total per travel date, for the three-day fare strip. */
  cheapestByDate: Map<string, Cents>;
  bestTotalCents: Cents | null;
}

function toOpportunity(candidate: Candidate, watch: Watch, benchmarkCents: Cents): Opportunity {
  const totalCents = candidate.fare.partyTotalCents;
  return {
    candidate,
    totalCents,
    savingsCents: benchmarkCents - totalCents,
    displacementDays: candidate.searchDate.displacementDays,
    convenienceScore: convenienceScore(candidate, watch),
    signature: opportunitySignature(candidate),
    pricingAmbiguous: candidate.fare.pricingConfidence === 'AMBIGUOUS',
  };
}

export function buildOpportunities({
  watch,
  benchmarkCents,
  eligibility,
}: OpportunityInput): OpportunityOutput {
  const all = eligibility.eligible.map((c) => toOpportunity(c, watch, benchmarkCents));
  const threshold = benchmarkCents - watch.preferences.minimumSavingsCents;

  const qualifying = all.filter((o) => o.totalCents <= threshold);

  const cheapestByDate = new Map<string, Cents>();
  for (const opp of all) {
    const date = opp.candidate.journey.travelDate;
    const current = cheapestByDate.get(date);
    if (current === undefined || opp.totalCents < current) cheapestByDate.set(date, opp.totalCents);
  }

  const ranked = rankOpportunities(qualifying, watch);
  const allRanked = rankOpportunities(all, watch);

  return {
    opportunities: ranked,
    allRanked,
    cheapestByDate,
    bestTotalCents: allRanked[0]?.totalCents ?? null,
  };
}
