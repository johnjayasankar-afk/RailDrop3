import { dollarsToCents, partyTotalCents } from "@/lib/domain/money";
import { normalizeFareFamily, normalizeTravelClass } from "@/lib/domain/fare-family";
import { classifyServiceType } from "@/lib/domain/service-type";
import type {
  AvailabilityStatus,
  FareOption,
  FareSearchRequest,
  JourneyLeg,
  JourneyOption,
  PriceSemantics,
  ProviderMetadata,
  ServiceType,
} from "@/lib/domain/types";

const PRICE_FIELD_CONFIDENCE =
  "Parse search_trains sample documents accommodationFare.dollarsAmount.total as the fare amount shown for the searched party configuration. Amtrak.com search results display per-traveler prices; RailDrop treats this field as per-traveler unless a party-total companion field is present.";

export interface NormalizationResult {
  journeys: JourneyOption[];
  failures: string[];
}

export function normalizeParseSearch(
  raw: unknown,
  request: FareSearchRequest,
  metadata: ProviderMetadata,
): NormalizationResult {
  const root = unwrapParsePayload(raw);
  const options = collectJourneyOptions(root);
  const journeys: JourneyOption[] = [];
  const failures: string[] = [];

  options.forEach((option, index) => {
    try {
      journeys.push(normalizeJourneyOption(option, request, metadata, index));
    } catch (error) {
      failures.push(
        error instanceof Error ? error.message : "Unknown journey normalization failure",
      );
    }
  });

  return { journeys, failures };
}

export function unwrapParsePayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  if (record.data && typeof record.data === "object") {
    const data = record.data as Record<string, unknown>;
    if (data.data && typeof data.data === "object") return data.data;
    return record.data;
  }
  return raw;
}

function collectJourneyOptions(root: unknown): unknown[] {
  if (!root || typeof root !== "object") return [];
  const record = root as Record<string, unknown>;
  const solution =
    (record.journeySolutionOption as Record<string, unknown> | undefined) ??
    ((record.data as Record<string, unknown> | undefined)?.journeySolutionOption as
      Record<string, unknown> | undefined);

  const legs =
    (solution?.journeyLegs as unknown[]) ??
    (record.journey_legs as unknown[]) ??
    (record.journeyLegs as unknown[]) ??
    [];

  const options: unknown[] = [];
  for (const leg of legs) {
    if (!leg || typeof leg !== "object") continue;
    const inner = (leg as Record<string, unknown>).journeyLegOptions;
    if (Array.isArray(inner)) {
      options.push(...inner);
    } else {
      options.push(leg);
    }
  }
  return options;
}

function normalizeJourneyOption(
  raw: unknown,
  request: FareSearchRequest,
  metadata: ProviderMetadata,
  index: number,
): JourneyOption {
  const record = asRecord(raw);
  const origin = asRecord(record.origin);
  const destination = asRecord(record.destination);
  const originSchedule = asRecord(origin.schedule);
  const destinationSchedule = asRecord(destination.schedule);
  const travelLegs = Array.isArray(record.travelLegs) ? record.travelLegs : [];

  const originCode = String(origin.code ?? request.originCode).toUpperCase();
  const destinationCode = String(destination.code ?? request.destinationCode).toUpperCase();
  const departureAt = requiredDateTime(
    originSchedule.departureDateTime ?? record.departureDateTime,
    "departureDateTime",
  );
  const arrivalAt = requiredDateTime(
    destinationSchedule.arrivalDateTime ?? record.arrivalDateTime,
    "arrivalDateTime",
  );

  const legs = (travelLegs.length > 0 ? travelLegs : [record]).map((leg) =>
    normalizeLeg(leg, originCode, destinationCode, departureAt, arrivalAt),
  );

  const serviceNames = legs.map((leg) => leg.serviceName);
  const serviceType: ServiceType = classifyServiceType({
    legCount: legs.length,
    serviceNames,
    rawTypes: legs.map((leg) => leg.serviceType),
  });

  const firstLeg = legs[0];

  return {
    id: [
      request.travelDate,
      originCode,
      destinationCode,
      firstLeg?.trainNumber ?? "na",
      departureAt,
      String(index),
    ].join(":"),
    searchedTravelDate: request.travelDate,
    serviceName: uniqueJoin(serviceNames),
    trainNumber: firstLeg?.trainNumber ?? null,
    serviceType,
    originCode,
    destinationCode,
    departureAt,
    arrivalAt,
    durationMinutes:
      parseElapsedMinutes(record.elapsedTime) ?? minutesBetween(departureAt, arrivalAt),
    transferCount: Math.max(0, legs.length - 1),
    legs,
    fares: normalizeFares(record, request.passengers.adultCount, `${request.travelDate}:${index}`),
    provider: {
      ...metadata,
      rawJourneyRef: String(record.id ?? record.journeyLegOptionId ?? index),
    },
  };
}

function normalizeLeg(
  raw: unknown,
  fallbackOrigin: string,
  fallbackDestination: string,
  fallbackDeparture: string,
  fallbackArrival: string,
): JourneyLeg {
  const record = asRecord(raw);
  const travelService = asRecord(record.travelService);
  const origin = asRecord(record.origin);
  const destination = asRecord(record.destination);
  const name = stringOrNull(travelService.name ?? record.name);
  const number = stringOrNull(travelService.number ?? record.number ?? record.trainNumber);
  const rawType = stringOrNull(travelService.type ?? record.type);
  return {
    originCode: String(origin.code ?? fallbackOrigin).toUpperCase(),
    destinationCode: String(destination.code ?? fallbackDestination).toUpperCase(),
    departureAt: optionalDateTime(asRecord(origin.schedule).departureDateTime) ?? fallbackDeparture,
    arrivalAt: optionalDateTime(asRecord(destination.schedule).arrivalDateTime) ?? fallbackArrival,
    serviceName: name,
    trainNumber: number,
    serviceType: classifyServiceType({
      legCount: 1,
      serviceNames: [name],
      rawTypes: [rawType],
    }),
  };
}

function normalizeFares(
  journey: Record<string, unknown>,
  adultCount: number,
  prefix: string,
): FareOption[] {
  const accommodations = Array.isArray(journey.reservableAccommodations)
    ? journey.reservableAccommodations
    : Array.isArray(journey.fareOptions)
      ? journey.fareOptions
      : [];

  if (accommodations.length === 0) {
    return [
      {
        id: `${prefix}:missing-fare`,
        fareFamily: "UNKNOWN",
        fareFamilyRaw: null,
        travelClass: "UNKNOWN",
        travelClassRaw: null,
        availability: "UNKNOWN",
        observedPriceCents: null,
        priceSemantics: "UNKNOWN",
        pricePerTravelerCents: null,
        totalPartyPriceCents: null,
        priceFailureReason: "Provider returned a journey without fare accommodations",
      },
    ];
  }

  return accommodations.map((item, index) =>
    normalizeFare(asRecord(item), adultCount, `${prefix}:${index}`),
  );
}

function normalizeFare(raw: Record<string, unknown>, adultCount: number, id: string): FareOption {
  const fareFamilyRaw = stringOrNull(raw.fareFamily ?? raw.fare_family);
  const travelClassRaw = stringOrNull(raw.travelClass ?? raw.class ?? raw.travel_class);
  const extracted = extractPrice(raw, adultCount);
  return {
    id,
    fareFamily: normalizeFareFamily(fareFamilyRaw),
    fareFamilyRaw,
    travelClass: normalizeTravelClass(travelClassRaw),
    travelClassRaw,
    availability: availabilityFrom(raw),
    observedPriceCents: extracted.observedPriceCents,
    priceSemantics: extracted.priceSemantics,
    pricePerTravelerCents: extracted.pricePerTravelerCents,
    totalPartyPriceCents: extracted.totalPartyPriceCents,
    priceFailureReason: extracted.priceFailureReason,
  };
}

function extractPrice(
  raw: Record<string, unknown>,
  adultCount: number,
): {
  observedPriceCents: number | null;
  priceSemantics: PriceSemantics;
  pricePerTravelerCents: number | null;
  totalPartyPriceCents: number | null;
  priceFailureReason: string | null;
} {
  const fare = asRecord(raw.accommodationFare ?? raw.reservationFare ?? raw.fare);
  const dollars = asRecord(fare.dollarsAmount ?? fare.dollarAmount);
  const total = dollars.total ?? raw.price ?? raw.total ?? raw.amount;
  const perTraveler = dollars.perPassenger ?? dollars.perTraveler ?? raw.pricePerPassenger;
  const partyTotal = dollars.totalForAllPassengers ?? raw.totalForAllPassengers;

  const totalCents = total === undefined ? null : dollarsToCents(total as string | number);
  const perTravelerCents =
    perTraveler === undefined ? null : dollarsToCents(perTraveler as string | number);
  const partyTotalCentsValue =
    partyTotal === undefined ? null : dollarsToCents(partyTotal as string | number);

  if (perTravelerCents !== null && partyTotalCentsValue !== null) {
    return {
      observedPriceCents: partyTotalCentsValue,
      priceSemantics: "PARTY_TOTAL",
      pricePerTravelerCents: perTravelerCents,
      totalPartyPriceCents: partyTotalCentsValue,
      priceFailureReason: null,
    };
  }

  if (partyTotalCentsValue !== null) {
    return {
      observedPriceCents: partyTotalCentsValue,
      priceSemantics: "PARTY_TOTAL",
      pricePerTravelerCents: Math.round(partyTotalCentsValue / Math.max(adultCount, 1)),
      totalPartyPriceCents: partyTotalCentsValue,
      priceFailureReason: null,
    };
  }

  if (perTravelerCents !== null) {
    return {
      observedPriceCents: perTravelerCents,
      priceSemantics: "PER_TRAVELER",
      pricePerTravelerCents: perTravelerCents,
      totalPartyPriceCents: partyTotalCents(perTravelerCents, adultCount),
      priceFailureReason: null,
    };
  }

  if (totalCents !== null) {
    return {
      observedPriceCents: totalCents,
      priceSemantics: "PER_TRAVELER",
      pricePerTravelerCents: totalCents,
      totalPartyPriceCents: partyTotalCents(totalCents, adultCount),
      priceFailureReason: null,
    };
  }

  return {
    observedPriceCents: null,
    priceSemantics: "UNKNOWN",
    pricePerTravelerCents: null,
    totalPartyPriceCents: null,
    priceFailureReason: `Could not extract a fare amount. ${PRICE_FIELD_CONFIDENCE}`,
  };
}

function availabilityFrom(raw: Record<string, unknown>): AvailabilityStatus {
  const inventory = raw.seatAvailability ?? raw.availability ?? raw.inventory;
  if (typeof inventory === "string") {
    const value = inventory.toUpperCase();
    if (value.includes("SOLD") || value.includes("UNAVAILABLE")) return "UNAVAILABLE";
    if (value.includes("LIMITED") || value.includes("LOW")) return "LIMITED";
    if (value.includes("AVAIL")) return "AVAILABLE";
  }
  if (raw.soldOut === true) return "UNAVAILABLE";
  if (raw.available === false) return "UNAVAILABLE";
  return "AVAILABLE";
}

function parseElapsedMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?/.exec(value);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return days * 24 * 60 + hours * 60 + minutes;
}

function minutesBetween(start: string, end: string): number | null {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 60000);
}

function requiredDateTime(value: unknown, field: string): string {
  const parsed = optionalDateTime(value);
  if (!parsed) throw new Error(`Missing ${field} on journey option`);
  return parsed;
}

function optionalDateTime(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 8) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return value.length === 19 ? `${value}` : value;
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

function uniqueJoin(values: Array<string | null>): string | null {
  const unique = [...new Set(values.filter(Boolean))] as string[];
  return unique.length === 0 ? null : unique.join(" / ");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
