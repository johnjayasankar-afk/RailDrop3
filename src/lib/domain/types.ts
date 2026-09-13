/**
 * The normalized RailDrop domain model.
 *
 * Provider JSON terminates at the adapter boundary — nothing in this file is
 * shaped by any external vendor, and no module under `src/lib/domain` may import
 * a provider type (enforced by ESLint).
 */

import type { CalendarDate } from './dates';
import type { Cents } from './money';

// ─── Enumerations ────────────────────────────────────────────────────────────

export const FARE_FAMILIES = ['FLEXIBLE', 'VALUE', 'SAVER', 'UNKNOWN'] as const;
export type FareFamily = (typeof FARE_FAMILIES)[number];

export const TRAVEL_CLASSES = ['COACH', 'BUSINESS', 'FIRST', 'SLEEPER', 'UNKNOWN'] as const;
export type TravelClass = (typeof TRAVEL_CLASSES)[number];

/** Distinct normalized transport concepts. Non-rail is never labelled rail. */
export const SERVICE_TYPES = ['DIRECT_RAIL', 'CONNECTING_RAIL', 'THRUWAY_BUS', 'UNKNOWN'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const AVAILABILITIES = ['AVAILABLE', 'LIMITED', 'SOLD_OUT', 'UNKNOWN'] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export type LegMode = 'RAIL' | 'BUS' | 'UNKNOWN';

/** Whether provider prices are per passenger or for the whole party. */
export type PricingBasis = 'PER_PASSENGER' | 'TOTAL_PARTY' | 'UNKNOWN';

/**
 * How much we trust a party total.
 * - CONFIRMED           basis was empirically verified
 * - UNAMBIGUOUS_SINGLE  basis unknown but party size is 1, so both bases agree
 * - AMBIGUOUS           basis unknown and party size > 1 → never alert on this
 */
export type PricingConfidence = 'CONFIRMED' | 'UNAMBIGUOUS_SINGLE' | 'AMBIGUOUS';

/** A provider call either produced inventory or genuinely produced none. */
export type ResultAvailability = 'HAS_AVAILABILITY' | 'NO_AVAILABILITY';

// ─── Core entities ───────────────────────────────────────────────────────────

export interface Station {
  /** 3-letter Amtrak station code, uppercase. */
  code: string;
  name: string;
  city: string;
  state: string;
  timezone: string | null;
}

export interface SearchDate {
  date: CalendarDate;
  /** Offset from the user's desired date: -1, 0, +1 … */
  displacementDays: number;
}

export interface FareSearchRequest {
  originCode: string;
  destinationCode: string;
  date: CalendarDate;
  passengers: number;
}

export interface Fare {
  /** Stable within a journey. */
  id: string;
  family: FareFamily;
  /** Vendor's own label, kept for display/debug only — never branched on. */
  familyRaw: string | null;
  travelClass: TravelClass;
  travelClassRaw: string | null;
  /** Amount exactly as the provider reported it. */
  amountCents: Cents;
  /** Amount for the whole party, derived via PricingBasis. */
  partyTotalCents: Cents;
  currency: string;
  pricingBasis: PricingBasis;
  pricingConfidence: PricingConfidence;
  availability: Availability;
  /** Value/Saver fares carry change or refund restrictions. */
  restricted: boolean;
  refundable: boolean | null;
  seatsRemaining: number | null;
}

export interface JourneyLeg {
  originCode: string;
  destinationCode: string;
  /** Local wall-clock ISO at the leg's origin: 'YYYY-MM-DDTHH:mm'. */
  departureLocal: string;
  arrivalLocal: string;
  mode: LegMode;
  serviceName: string | null;
  trainNumber: string | null;
  durationMinutes: number | null;
}

export interface Journey {
  providerJourneyId: string;
  serviceName: string | null;
  /** Primary train number (first rail leg) — display only. */
  trainNumber: string | null;
  originCode: string;
  destinationCode: string;
  /** Local wall-clock ISO. */
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number;
  transfers: number;
  travelDate: CalendarDate;
  serviceType: ServiceType;
  legs: JourneyLeg[];
  fares: Fare[];
  /** Only ever populated from a provider payload; validated before use. */
  bookingUrl: string | null;
}

export interface ProviderMetadata {
  providerId: string;
  /** Correlation id for this single external call. */
  requestId: string;
  fetchedAt: string;
  latencyMs: number;
  httpStatus: number | null;
  creditsCharged: number | null;
  creditsRemaining: number | null;
  rateLimitRemaining: number | null;
  /** Which field aliases the tolerant parser actually matched. */
  schemaAliases: string[];
  /** True when the response was served from the in-cycle dedupe cache. */
  deduplicated: boolean;
}

export interface FareSearchResult {
  request: FareSearchRequest;
  journeys: Journey[];
  /** Explicit: emptiness is a *result*, never inferred from an error. */
  availability: ResultAvailability;
  meta: ProviderMetadata;
}

// ─── Watch (the user's monitored purchase) ───────────────────────────────────

export type WatchStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'NEEDS_ATTENTION';

export interface WatchPreferences {
  /** 0, 1 (default) or 2 calendar days either side. */
  dateFlexibilityDays: 0 | 1 | 2;
  travelClass: TravelClass;
  /** Fare family the user actually paid for; the like-for-like comparison target. */
  benchmarkFareFamily: FareFamily;
  includeThruway: boolean;
  includeRestrictedFares: boolean;
  minimumSavingsCents: Cents;
  /** Optional per-trip target. Null means the material-drop rule alone applies. */
  targetPriceCents: Cents | null;
  /** Minutes since local midnight, or null. Ranking key #4 only. */
  preferredDepartureMinutes: number | null;
}

export interface Watch {
  id: string;
  userId: string;
  originCode: string;
  destinationCode: string;
  desiredDate: CalendarDate;
  passengers: number;
  /** Canonical benchmark: what the user actually paid, total for the party. */
  benchmarkCents: Cents;
  /** Bumped on every rebook; guards alerts against a benchmark change in flight. */
  benchmarkVersion: number;
  timezone: string;
  status: WatchStatus;
  monitoringStartsAt: string;
  monitoringEndsAt: string;
  preferences: WatchPreferences;
}

// ─── Candidates, opportunities, alerts ───────────────────────────────────────

export interface Candidate {
  journey: Journey;
  fare: Fare;
  searchDate: SearchDate;
}

export type IneligibleReason =
  | 'ROUTE_MISMATCH'
  | 'DATE_NOT_IN_WINDOW'
  | 'NOT_AVAILABLE'
  | 'SERVICE_TYPE_EXCLUDED'
  | 'CLASS_MISMATCH'
  | 'FARE_FAMILY_EXCLUDED'
  | 'NO_FARE'
  | 'PASSENGER_MISMATCH';

export interface EligibilityRejection {
  journeyId: string;
  fareId: string | null;
  reason: IneligibleReason;
}

export interface EligibilityOutcome {
  eligible: Candidate[];
  rejected: EligibilityRejection[];
}

export interface Opportunity {
  candidate: Candidate;
  /** benchmark − candidate party total. Always > 0 for a qualifying opportunity. */
  savingsCents: Cents;
  totalCents: Cents;
  displacementDays: number;
  convenienceScore: number;
  /** Stable identity of this option, used for alert dedupe. */
  signature: string;
  /** True when party pricing could not be trusted (pax > 1, basis UNKNOWN). */
  pricingAmbiguous: boolean;
}

export type AlertReason = 'FIRST_DROP' | 'PRICE_DROP' | 'BETTER_CONVENIENCE' | 'TARGET_REACHED';

export interface AlertState {
  lastAlertedAt: string | null;
  lastBestTotalCents: Cents | null;
  lastBestSignature: string | null;
  lastBestConvenienceScore: number | null;
}

export interface AlertDecision {
  shouldAlert: boolean;
  reason: AlertReason | null;
  /** Why we chose not to alert — always populated when shouldAlert is false. */
  suppressedReason: AlertSuppressedReason | null;
  dedupeKey: string | null;
  best: Opportunity | null;
}

export type AlertSuppressedReason =
  | 'NO_QUALIFYING_OPPORTUNITY'
  | 'NO_MATERIAL_CHANGE'
  | 'COOLDOWN'
  | 'AMBIGUOUS_PARTY_PRICING'
  | 'CYCLE_FAILED'
  | 'BENCHMARK_CHANGED';

// ─── Cycles ──────────────────────────────────────────────────────────────────

export const CYCLE_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'FAILED',
  'SKIPPED_BUDGET',
  'SKIPPED_EXPIRED',
] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const CHECK_TRIGGERS = ['INITIAL', 'MORNING', 'AFTERNOON', 'EVENING', 'MANUAL'] as const;
export type CheckTrigger = (typeof CHECK_TRIGGERS)[number];

/** Only these three consume a daily scheduled quota slot. */
export const SCHEDULED_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export type ScheduledSlot = (typeof SCHEDULED_SLOTS)[number];

// ─── Booking handoff ─────────────────────────────────────────────────────────

export type BookingConfidence = 'EXACT' | 'SEARCH_PREFILL' | 'GENERIC';

export interface BookingHandoff {
  url: string;
  confidence: BookingConfidence;
  /** Shown verbatim to the user — must never over-claim. */
  disclosure: string;
  tripDetails: {
    originCode: string;
    destinationCode: string;
    date: CalendarDate;
    trainNumber: string | null;
    serviceName: string | null;
    departureLocal: string;
    arrivalLocal: string;
    fareFamily: FareFamily;
    travelClass: TravelClass;
    passengers: number;
    observedTotalCents: Cents;
    observedAt: string;
  };
  /** Plain-text block behind the "Copy trip details" action. */
  copyText: string;
}
