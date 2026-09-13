import { isRestrictedFare } from "./fare-family";
import { isRailEligible } from "./service-type";
import type { FareOption, JourneyOption, TravelClass } from "./types";

export interface EligibilityRules {
  includeRestrictedFares: boolean;
  includeThruway: boolean;
  travelClass: TravelClass;
  requireAvailable: boolean;
}

export interface EligibleFare {
  journey: JourneyOption;
  fare: FareOption;
  reasonExcluded?: never;
}

export function isFareEligible(
  journey: JourneyOption,
  fare: FareOption,
  rules: EligibilityRules,
): boolean {
  if (!isRailEligible(journey.serviceType, rules.includeThruway)) {
    return false;
  }
  if (rules.requireAvailable && fare.availability === "UNAVAILABLE") {
    return false;
  }
  if (fare.priceSemantics === "UNKNOWN" || fare.totalPartyPriceCents === null) {
    return false;
  }
  if (rules.travelClass !== "UNKNOWN" && fare.travelClass !== rules.travelClass) {
    if (!(rules.travelClass === "COACH" && fare.travelClass === "UNKNOWN")) {
      return false;
    }
  }
  if (!rules.includeRestrictedFares && isRestrictedFare(fare.fareFamily)) {
    return false;
  }
  if (!rules.includeRestrictedFares && fare.fareFamily !== "FLEXIBLE") {
    return false;
  }
  return true;
}

export function collectEligibleFares(
  journeys: JourneyOption[],
  rules: EligibilityRules,
): EligibleFare[] {
  const eligible: EligibleFare[] = [];
  for (const journey of journeys) {
    for (const fare of journey.fares) {
      if (isFareEligible(journey, fare, rules)) {
        eligible.push({ journey, fare });
      }
    }
  }
  return eligible;
}
