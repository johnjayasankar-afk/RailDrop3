/**
 * Eligibility — which returned journeys/fares may legitimately be compared
 * against the user's benchmark.
 *
 * Every rejection records a reason, so "no cheaper option" is always explainable
 * and never a silent shrug.
 */

import type {
  Candidate,
  EligibilityOutcome,
  EligibilityRejection,
  FareSearchResult,
  IneligibleReason,
  Journey,
  SearchDate,
  ServiceType,
  Watch,
} from './types';

export interface DatedResult {
  result: FareSearchResult;
  searchDate: SearchDate;
}

export function allowedServiceTypes(watch: Watch): ServiceType[] {
  const allowed: ServiceType[] = ['DIRECT_RAIL', 'CONNECTING_RAIL'];
  if (watch.preferences.includeThruway) allowed.push('THRUWAY_BUS');
  // UNKNOWN is never allowed: we do not assert a mode we could not determine.
  return allowed;
}

function routeMatches(watch: Watch, journey: Journey): boolean {
  return (
    journey.originCode.toUpperCase() === watch.originCode.toUpperCase() &&
    journey.destinationCode.toUpperCase() === watch.destinationCode.toUpperCase()
  );
}

export function evaluateEligibility(watch: Watch, dated: DatedResult[]): EligibilityOutcome {
  const eligible: Candidate[] = [];
  const rejected: EligibilityRejection[] = [];
  const serviceScope = new Set(allowedServiceTypes(watch));

  const reject = (journeyId: string, fareId: string | null, reason: IneligibleReason): void => {
    rejected.push({ journeyId, fareId, reason });
  };

  for (const { result, searchDate } of dated) {
    if (result.request.passengers !== watch.passengers) {
      for (const j of result.journeys) reject(j.providerJourneyId, null, 'PASSENGER_MISMATCH');
      continue;
    }

    for (const journey of result.journeys) {
      if (!routeMatches(watch, journey)) {
        reject(journey.providerJourneyId, null, 'ROUTE_MISMATCH');
        continue;
      }
      // Against the date actually searched, NOT the union of all searched dates.
      // The adapter derives travelDate from the provider's departure timestamp,
      // so a late-evening service returned by the Sep 20 search can have
      // travelDate Sep 21. Checking the union admits it while still tagging it
      // with Sep 20's displacement - which then wins the "exact desired date"
      // tiebreak and is labelled "Same day" for a train that leaves tomorrow.
      if (journey.travelDate !== searchDate.date) {
        reject(journey.providerJourneyId, null, 'DATE_NOT_IN_WINDOW');
        continue;
      }
      if (!serviceScope.has(journey.serviceType)) {
        reject(journey.providerJourneyId, null, 'SERVICE_TYPE_EXCLUDED');
        continue;
      }
      if (journey.fares.length === 0) {
        // A journey with no priced fare is kept out of comparison entirely.
        // It is never treated as costing zero.
        reject(journey.providerJourneyId, null, 'NO_FARE');
        continue;
      }

      for (const fare of journey.fares) {
        if (fare.travelClass !== watch.preferences.travelClass) {
          reject(journey.providerJourneyId, fare.id, 'CLASS_MISMATCH');
          continue;
        }
        if (!isFareFamilyAllowed(watch, fare.family)) {
          reject(journey.providerJourneyId, fare.id, 'FARE_FAMILY_EXCLUDED');
          continue;
        }
        if (fare.availability === 'SOLD_OUT' || fare.availability === 'UNKNOWN') {
          // Unknown availability is not assumed bookable.
          reject(journey.providerJourneyId, fare.id, 'NOT_AVAILABLE');
          continue;
        }
        eligible.push({ journey, fare, searchDate });
      }
    }
  }

  return { eligible, rejected };
}

export function isFareFamilyAllowed(watch: Watch, family: Candidate['fare']['family']): boolean {
  if (family === 'UNKNOWN') return false;
  if (watch.preferences.includeRestrictedFares) {
    // Like-for-like plus cheaper restricted fares, which the UI labels clearly.
    return family === 'FLEXIBLE' || family === 'VALUE' || family === 'SAVER';
  }
  return family === watch.preferences.benchmarkFareFamily;
}

/** Value and Saver carry change/refund restrictions relative to Flexible. */
export function isRestrictedFamily(family: Candidate['fare']['family']): boolean {
  return family === 'VALUE' || family === 'SAVER';
}
