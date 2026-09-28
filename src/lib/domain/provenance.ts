import { checkFare, type Rejection, type SanityContext } from "./fare-sanity";
import { formatUsdCompact } from "./money";
import type { RankedCandidate } from "./types";

/* Where a number came from, in a form a person can check.
 *
 * "We never invent a price" is the whole product, and until now it was a claim
 * the reader had to take on trust. Every other honesty measure here is
 * inward-facing: the sanity checks, the screening, the verifier around the
 * assistant. They protect the reader without ever showing them anything.
 *
 * This turns the promise into a receipt. For any fare on the board it says
 * what the provider literally reported, what arithmetic turned that into the
 * figure on screen, when it was seen, which request saw it, and which
 * plausibility checks it had to survive. A claim you can audit is a different
 * kind of claim from one you cannot.
 *
 * It states only what was recorded. Where something is unknown — a fare type
 * the source never gave, a party total we could not derive — it says so rather
 * than filling the gap, because a provenance trail that quietly rounds off its
 * own uncertainty is worth less than no trail at all.
 */

export interface ProvenanceStep {
  label: string;
  value: string;
  /** Why this step exists, when that is not obvious. */
  note?: string;
}

export interface FareProvenance {
  /** The derivation, from what the source said to what is on screen. */
  steps: ProvenanceStep[];
  /** Plausibility checks this fare had to survive to be shown at all. */
  checksRun: number;
  failures: Rejection[];
  source: string;
  requestId: string;
  observedAt: string;
  /** "14 minutes ago". Takes `now`, so it is pure and testable. */
  age: string;
  /** One line, for the collapsed state. */
  summary: string;
}

/**
 * How many independent checks a fare passes before the board will show it.
 *
 * Not a count of rejections — a count of the things that were looked at.
 * checkFare returns only what failed, so the number of checks it performs
 * lives here, next to the list it is derived from, and a test asserts the two
 * have not drifted apart.
 */
export const PLAUSIBILITY_CHECKS = [
  "price is present",
  "price is a number",
  "price is above the floor for one traveller",
  "price is below the ceiling for one traveller",
  "party total matches the per-traveller price",
  "arrival is after departure",
  "duration is not impossibly short",
  "duration is not impossibly long",
  "duration agrees with the timestamps",
  "origin is the station asked for",
  "destination is the station asked for",
  "date is the date asked for",
  "departure is not long before the search",
] as const;

export function fareProvenance(
  candidate: RankedCandidate,
  context: SanityContext,
  now: Date,
): FareProvenance {
  const { journey, fare } = candidate;
  const steps: ProvenanceStep[] = [];

  /* What the source actually said, before anything was done to it. This is the
     only line that is not ours, and it is first for that reason. */
  steps.push({
    label: "Reported by the source",
    value:
      fare.observedPriceCents !== null
        ? `${formatUsdCompact(fare.observedPriceCents)} ${semantics(fare.priceSemantics)}`
        : "no price",
    note:
      fare.priceSemantics === "UNKNOWN"
        ? "The source did not say whether this was per traveller or for the party."
        : undefined,
  });

  if (fare.pricePerTravelerCents !== null) {
    steps.push({
      label: "Per traveller",
      value: formatUsdCompact(fare.pricePerTravelerCents),
      note:
        fare.priceSemantics === "PARTY_TOTAL" && context.passengerCount > 1
          ? `Divided by ${context.passengerCount} travellers.`
          : undefined,
    });
  }

  steps.push({
    label: "Party total",
    value:
      fare.totalPartyPriceCents !== null
        ? formatUsdCompact(fare.totalPartyPriceCents)
        : "not derivable",
    note:
      fare.totalPartyPriceCents === null
        ? "Without a party total this fare is excluded from ranking rather than guessed at."
        : context.passengerCount > 1 && fare.priceSemantics === "PER_TRAVELER"
          ? `Multiplied by ${context.passengerCount} travellers.`
          : undefined,
  });

  steps.push({
    label: "Fare type",
    value: fare.fareFamilyRaw ?? (fare.fareFamily === "UNKNOWN" ? "not stated" : fare.fareFamily),
    note:
      fare.fareFamily === "UNKNOWN"
        ? "This source does not report a fare type. It may be non-refundable — check before switching."
        : undefined,
  });

  steps.push({
    label: "Seats",
    value: availability(fare.availability),
  });

  const failures = checkFare(journey, fare, context);

  return {
    steps,
    checksRun: PLAUSIBILITY_CHECKS.length,
    failures,
    source: sourceName(journey.provider.provider),
    requestId: journey.provider.requestId,
    observedAt: journey.provider.retrievedAt,
    age: ageOf(journey.provider.retrievedAt, now),
    summary:
      failures.length === 0
        ? `Seen ${ageOf(journey.provider.retrievedAt, now)} by ${sourceName(journey.provider.provider)}; passed ${PLAUSIBILITY_CHECKS.length} checks.`
        : `Seen ${ageOf(journey.provider.retrievedAt, now)} by ${sourceName(journey.provider.provider)}; ${failures.length} check${failures.length === 1 ? "" : "s"} failed.`,
  };
}

function semantics(value: string): string {
  if (value === "PER_TRAVELER") return "per traveller";
  if (value === "PARTY_TOTAL") return "for the whole party";
  return "with no stated basis";
}

function availability(value: string): string {
  if (value === "AVAILABLE") return "available when we looked";
  if (value === "SOLD_OUT") return "sold out when we looked";
  return "availability not stated";
}

function sourceName(provider: string): string {
  if (provider.startsWith("wanderu")) return "Wanderu";
  if (provider.startsWith("parse")) return "Parse";
  if (provider.startsWith("fixture")) return "a test fixture";
  return provider;
}

/**
 * Coarse on purpose.
 *
 * "14 minutes ago" is what matters about a fare's age; "14 minutes 22 seconds"
 * implies a precision the number does not have, since it was read off a page
 * that had itself been cached for an unknown while.
 */
export function ageOf(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "at an unknown time";
  const seconds = Math.round((now.getTime() - at.getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 90) return "moments ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
