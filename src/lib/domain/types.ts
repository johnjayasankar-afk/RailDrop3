export const FARE_FAMILIES = ["FLEXIBLE", "VALUE", "SAVER", "PREMIUM", "OTHER", "UNKNOWN"] as const;
export type FareFamily = (typeof FARE_FAMILIES)[number];

export const TRAVEL_CLASSES = [
  "COACH",
  "BUSINESS",
  "FIRST",
  "SLEEPER",
  "OTHER",
  "UNKNOWN",
] as const;
export type TravelClass = (typeof TRAVEL_CLASSES)[number];

export const SERVICE_TYPES = [
  "DIRECT_RAIL",
  "CONNECTING_RAIL",
  "THRUWAY_OR_BUS",
  "UNKNOWN",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const AVAILABILITY_STATUSES = ["AVAILABLE", "LIMITED", "UNAVAILABLE", "UNKNOWN"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const PRICE_SEMANTICS = ["PER_TRAVELER", "PARTY_TOTAL", "UNKNOWN"] as const;
export type PriceSemantics = (typeof PRICE_SEMANTICS)[number];

export const WATCH_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED"] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];

export const CHECK_SLOTS = ["MORNING", "AFTERNOON", "EVENING"] as const;
export type CheckSlot = (typeof CHECK_SLOTS)[number];

export const CYCLE_TRIGGERS = ["INITIAL", "SCHEDULED", "MANUAL"] as const;
export type CycleTrigger = (typeof CYCLE_TRIGGERS)[number];

export const CYCLE_STATUSES = [
  "RUNNING",
  "SUCCESS",
  "PARTIAL_SUCCESS",
  "PROVIDER_ERROR",
  "NO_AVAILABLE_ITINERARIES",
] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const DATE_SEARCH_STATUSES = [
  "SUCCESS",
  "NO_INVENTORY",
  "PROVIDER_ERROR",
  "SKIPPED_PAST",
] as const;
export type DateSearchStatus = (typeof DATE_SEARCH_STATUSES)[number];

export const MONITOR_PRESETS = ["24h", "48h", "72h", "until_departure", "custom"] as const;
export type MonitorPreset = (typeof MONITOR_PRESETS)[number];

export type DateFlexibilityDays = 0 | 1 | 2;

export interface Station {
  code: string;
  name: string;
  city: string;
  state: string;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface PassengerConfiguration {
  adultCount: number;
}

export interface FareSearchRequest {
  originCode: string;
  destinationCode: string;
  travelDate: string;
  passengers: PassengerConfiguration;
}

export interface ProviderMetadata {
  provider: string;
  requestId: string;
  rawJourneyRef?: string | null;
  retrievedAt: string;
  latencyMs: number;
  creditsCharged: number | null;
}

export interface BookingHandoff {
  kind: "exact_itinerary" | "search_prefill" | "generic_fallback";
  url: string;
  label: string;
  prefilled: {
    origin?: string;
    destination?: string;
    travelDate?: string;
    trainNumber?: string;
    departureTime?: string;
  };
  copyText: string;
}

export interface JourneyLeg {
  originCode: string;
  destinationCode: string;
  departureAt: string;
  arrivalAt: string;
  serviceName: string | null;
  trainNumber: string | null;
  serviceType: ServiceType;
}

export interface FareOption {
  id: string;
  fareFamily: FareFamily;
  fareFamilyRaw: string | null;
  travelClass: TravelClass;
  travelClassRaw: string | null;
  availability: AvailabilityStatus;
  observedPriceCents: number | null;
  priceSemantics: PriceSemantics;
  pricePerTravelerCents: number | null;
  totalPartyPriceCents: number | null;
  priceFailureReason: string | null;
}

export interface JourneyOption {
  id: string;
  searchedTravelDate: string;
  serviceName: string | null;
  trainNumber: string | null;
  serviceType: ServiceType;
  originCode: string;
  destinationCode: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number | null;
  transferCount: number;
  legs: JourneyLeg[];
  fares: FareOption[];
  provider: ProviderMetadata;
}

export interface FareSearchResult {
  request: FareSearchRequest;
  status: DateSearchStatus;
  journeys: JourneyOption[];
  providerError?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metadata: ProviderMetadata;
}

export interface RankedCandidate {
  journey: JourneyOption;
  fare: FareOption;
  totalPartyPriceCents: number;
  savingsCents: number;
  dateOffsetDays: number;
  preferredTimeDeltaMinutes: number | null;
  rankScore: number;
}

export interface OpportunityFingerprint {
  bestJourneyKey: string;
  bestPriceCents: number;
  bestTravelDate: string;
  sameDayBestPriceCents: number | null;
  sameDayJourneyKey: string | null;
  qualifyingCount: number;
}

export type AlertDecision =
  | { notify: true; reason: "first_qualifying" | "better_price" | "better_convenience" }
  | { notify: false; reason: "unchanged" | "no_qualifying" | "below_threshold" };
