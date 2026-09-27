/**
 * Normalization for the Parse.bot `amtrak-com-api` `search_trains` response.
 *
 * Parse.bot documents the endpoint contract and error envelope but not a full
 * field-level response schema, so this adapter is deliberately TOLERANT about
 * field names and STRICT about failure:
 *
 *   - it walks an ordered list of candidate container paths and field aliases;
 *   - it records which aliases actually matched (ProviderMetadata.schemaAliases);
 *   - if it cannot recognise a journey container at all it raises
 *     ProviderSchemaError. An unparseable response is a provider FAILURE, never
 *     an empty "no cheaper fares" result.
 *
 * Run `npm run probe:provider` with a real key to pin the observed shape.
 */

import {
  assertCalendarDate,
  calendarDateFromLocalIso,
  type CalendarDate,
} from '@/lib/domain/dates';
import { multiplyCents, type Cents } from '@/lib/domain/money';
import type {
  Availability,
  Fare,
  FareFamily,
  FareSearchRequest,
  FareSearchResult,
  Journey,
  JourneyLeg,
  LegMode,
  PricingBasis,
  PricingConfidence,
  ProviderMetadata,
  ServiceType,
  TravelClass,
} from '@/lib/domain/types';
import { ProviderSchemaError } from '../fare-provider';

export type AmountUnit = 'dollars' | 'cents';

export interface NormalizeOptions {
  pricingBasis: PricingBasis;
  amountUnit: AmountUnit;
}

/** Amtrak tickets outside this range indicate a misread unit, not a real fare. */
const MIN_PLAUSIBLE_CENTS = 100; // $1
const MAX_PLAUSIBLE_CENTS = 1_000_000; // $10,000

type Json = unknown;
type JsonObject = Record<string, unknown>;

function isObject(value: Json): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Alias lookup that records which key matched, for schema fingerprinting. */
class AliasTracker {
  readonly matched = new Set<string>();

  pick(obj: JsonObject, aliases: readonly string[], label: string): unknown {
    for (const alias of aliases) {
      if (alias in obj && obj[alias] !== null && obj[alias] !== undefined) {
        this.matched.add(`${label}=${alias}`);
        return obj[alias];
      }
    }
    return undefined;
  }

  note(note: string): void {
    this.matched.add(note);
  }
}

// ─── Candidate containers ────────────────────────────────────────────────────

const ENVELOPE_KEYS = ['data', 'result', 'results', 'payload'] as const;

const JOURNEY_CONTAINER_KEYS = [
  'journeySolutionOption',
  'journeySolutionOptions',
  'journeySolutions',
  'journeyOptions',
  'journeys',
  'itineraries',
  'solutions',
  'trains',
  'options',
  'results',
] as const;

/** Fields that make an object look like a journey rather than something else. */
const JOURNEY_HINT_KEYS = [
  'departureDateTime',
  'departure_time',
  'departureTime',
  'departure',
  'travelLegs',
  'legs',
  'segments',
  'fares',
  'fareOptions',
  'trainNumber',
  'train_number',
];

function looksLikeJourney(value: Json): boolean {
  if (!isObject(value)) return false;
  return JOURNEY_HINT_KEYS.some((k) => k in value);
}

/** Unwrap `{ data: ... }` / `{ status: 'success', data: ... }` envelopes. */
export function unwrapEnvelope(payload: Json, tracker: AliasTracker): Json {
  let current = payload;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!isObject(current)) return current;
    if (Array.isArray(current)) return current;
    let advanced = false;
    for (const key of ENVELOPE_KEYS) {
      const next = current[key];
      if (Array.isArray(next) || isObject(next)) {
        // Only unwrap when the wrapper adds nothing that looks like a journey.
        if (!looksLikeJourney(current)) {
          tracker.note(`envelope=${key}`);
          current = next;
          advanced = true;
          break;
        }
      }
    }
    if (!advanced) return current;
  }
  return current;
}

/**
 * Locate the array of journey objects. Known paths first, then a bounded search
 * for the first array whose members look like journeys.
 */
export function findJourneyArray(payload: Json, tracker: AliasTracker): JsonObject[] {
  const root = unwrapEnvelope(payload, tracker);

  if (Array.isArray(root)) {
    tracker.note('container=root-array');
    return root.filter(isObject);
  }
  if (!isObject(root)) {
    throw new ProviderSchemaError('Provider response was not an object or array', {
      receivedType: typeof root,
    });
  }

  for (const key of JOURNEY_CONTAINER_KEYS) {
    const value = root[key];
    if (Array.isArray(value)) {
      tracker.note(`container=${key}`);
      return value.filter(isObject);
    }
    // Some payloads nest a single solution object rather than an array.
    if (isObject(value) && looksLikeJourney(value)) {
      tracker.note(`container=${key}(single)`);
      return [value];
    }
  }

  // Bounded breadth-first search for a journey-shaped array.
  const queue: Array<{ node: Json; depth: number }> = [{ node: root, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < 500) {
    const item = queue.shift();
    if (!item) break;
    visited += 1;
    const { node, depth } = item;
    if (depth > 5) continue;
    if (Array.isArray(node)) {
      const objects = node.filter(isObject);
      if (objects.length > 0 && objects.some(looksLikeJourney)) {
        tracker.note('container=discovered');
        return objects;
      }
      for (const child of node) queue.push({ node: child, depth: depth + 1 });
      continue;
    }
    if (isObject(node)) {
      for (const child of Object.values(node)) queue.push({ node: child, depth: depth + 1 });
    }
  }

  // An empty, well-formed body is legitimate: a route/date with no service.
  if (isEmptyResultShape(root)) {
    tracker.note('container=empty-ok');
    return [];
  }

  throw new ProviderSchemaError('Could not locate a journey container in the provider response', {
    topLevelKeys: Object.keys(root).slice(0, 25),
  });
}

/** Recognise an explicitly empty result rather than guessing. */
function isEmptyResultShape(root: JsonObject): boolean {
  for (const key of JOURNEY_CONTAINER_KEYS) {
    if (Array.isArray(root[key])) return true;
  }
  const keys = Object.keys(root);
  if (keys.length === 0) return true;
  // { status: 'success', data: [] } style
  if (Array.isArray(root.data) && (root.data as unknown[]).length === 0) return true;
  return false;
}

// ─── Scalar coercion ─────────────────────────────────────────────────────────

export function toCents(value: Json, unit: AmountUnit): Cents | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return unit === 'cents' ? Math.round(value) : Math.round(value * 100);
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.]/g, '');
    if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return unit === 'cents' ? Math.round(parsed) : Math.round(parsed * 100);
  }

  if (isObject(value)) {
    // { amount: 74.00, currency: 'USD' } and friends
    for (const key of ['amount', 'value', 'total', 'price', 'dollars']) {
      if (key in value) return toCents(value[key], unit);
    }
  }
  return null;
}

export function isPlausibleFare(cents: Cents | null): cents is Cents {
  return cents !== null && cents >= MIN_PLAUSIBLE_CENTS && cents <= MAX_PLAUSIBLE_CENTS;
}

function toStringOrNull(value: Json): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function toIntOrNull(value: Json): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^0-9-]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

/**
 * Normalise a date-time to local wall-clock ISO 'YYYY-MM-DDTHH:mm'.
 * Amtrak times are local to the station, so any trailing offset is discarded
 * rather than converted - converting would silently shift departure times.
 */
export function toLocalIso(value: Json, fallbackDate: CalendarDate): string | null {
  const raw = toStringOrNull(value);
  if (!raw) return null;

  const full = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(raw);
  if (full) return `${full[1]}T${full[2]}:${full[3]}`;

  const timeOnly = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(raw);
  if (timeOnly) {
    let hour = Number(timeOnly[1]);
    const minute = timeOnly[2] as string;
    const meridiem = timeOnly[3]?.toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    return `${fallbackDate}T${String(hour).padStart(2, '0')}:${minute}`;
  }
  return null;
}

// ─── Enum normalisation ──────────────────────────────────────────────────────

export function normalizeFareFamily(raw: string | null): FareFamily {
  if (!raw) return 'UNKNOWN';
  const v = raw.trim().toUpperCase();
  if (v === 'FLX' || v.includes('FLEX')) return 'FLEXIBLE';
  if (v === 'VLU' || v.includes('VALUE')) return 'VALUE';
  if (v === 'SVR' || v.includes('SAVER')) return 'SAVER';
  return 'UNKNOWN';
}

export function normalizeTravelClass(raw: string | null): TravelClass {
  if (!raw) return 'UNKNOWN';
  const v = raw.trim().toUpperCase();
  if (v.includes('BUSINESS')) return 'BUSINESS';
  if (v.includes('FIRST') || v.includes('ACELA FIRST')) return 'FIRST';
  if (v.includes('ROOMETTE') || v.includes('BEDROOM') || v.includes('SLEEP')) return 'SLEEPER';
  if (v.includes('COACH') || v === 'RESERVED COACH SEAT' || v === 'COA') return 'COACH';
  return 'UNKNOWN';
}

export function normalizeAvailability(raw: Json, seatsRemaining: number | null): Availability {
  if (typeof raw === 'boolean') return raw ? 'AVAILABLE' : 'SOLD_OUT';
  const v = toStringOrNull(raw)?.toUpperCase() ?? null;
  if (v) {
    if (v.includes('SOLD') || v.includes('UNAVAILABLE') || v === 'NONE' || v === 'N')
      return 'SOLD_OUT';
    if (v.includes('LIMITED') || v.includes('LOW')) return 'LIMITED';
    if (v.includes('AVAILABLE') || v === 'Y' || v === 'OK' || v === 'BOOKABLE') return 'AVAILABLE';
  }
  if (seatsRemaining !== null) {
    if (seatsRemaining <= 0) return 'SOLD_OUT';
    if (seatsRemaining <= 5) return 'LIMITED';
    return 'AVAILABLE';
  }
  return 'UNKNOWN';
}

export function normalizeLegMode(raw: string | null): LegMode {
  if (!raw) return 'UNKNOWN';
  const v = raw.trim().toUpperCase();
  // Non-rail must never be labelled rail.
  if (
    v.includes('BUS') ||
    v.includes('THRUWAY') ||
    v.includes('COACH SERVICE') ||
    v.includes('MOTORCOACH')
  ) {
    return 'BUS';
  }
  if (v.includes('TRAIN') || v.includes('RAIL') || v.includes('ACELA') || v.includes('REGIONAL')) {
    return 'RAIL';
  }
  return 'UNKNOWN';
}

export function deriveServiceType(legs: JourneyLeg[]): ServiceType {
  if (legs.length === 0) return 'UNKNOWN';
  if (legs.some((l) => l.mode === 'BUS')) return 'THRUWAY_BUS';
  if (legs.some((l) => l.mode === 'UNKNOWN')) return 'UNKNOWN';
  return legs.length === 1 ? 'DIRECT_RAIL' : 'CONNECTING_RAIL';
}

// ─── Journey / fare normalisation ────────────────────────────────────────────

const A = {
  journeyId: ['id', 'journeyId', 'solutionId', 'journeySolutionId', 'guid', 'uuid', 'key'],
  trainNumber: ['trainNumber', 'train_number', 'trainNo', 'number', 'trainId'],
  serviceName: ['serviceName', 'trainName', 'train_name', 'routeName', 'name', 'service', 'brand'],
  origin: [
    'origin',
    'originCode',
    'origin_code',
    'originStationCode',
    'fromStation',
    'from',
    'departureStation',
  ],
  destination: [
    'destination',
    'destinationCode',
    'destination_code',
    'destinationStationCode',
    'toStation',
    'to',
    'arrivalStation',
  ],
  departure: [
    'departureDateTime',
    'departure_time',
    'departureTime',
    'departure',
    'origDepartureDateTime',
    'scheduledDeparture',
    'departsAt',
  ],
  arrival: [
    'arrivalDateTime',
    'arrival_time',
    'arrivalTime',
    'arrival',
    'destArrivalDateTime',
    'scheduledArrival',
    'arrivesAt',
  ],
  duration: ['durationMinutes', 'duration', 'travelTime', 'elapsedTime', 'journeyDuration'],
  transfers: ['transfers', 'numberOfTransfers', 'changes', 'numTransfers', 'connectionCount'],
  legs: ['legs', 'travelLegs', 'segments', 'journeyLegs', 'travelSegments'],
  fares: [
    'fares',
    'fareOptions',
    'prices',
    'fareFamilies',
    'reservableAccommodations',
    'accommodations',
  ],
  mode: ['mode', 'travelMode', 'serviceType', 'transportMode', 'equipmentType', 'type'],
  bookingUrl: ['bookingUrl', 'booking_url', 'deepLink', 'bookingLink', 'url', 'link'],
  fareFamily: [
    'fareFamily',
    'fare_family',
    'fareFamilyCode',
    'fareCode',
    'familyCode',
    'code',
    'name',
    'type',
  ],
  amount: [
    'price',
    'amount',
    'total',
    'totalPrice',
    'fare',
    'priceAmount',
    'totalFare',
    'dollarsAmount',
  ],
  currency: ['currency', 'currencyCode', 'priceCurrency'],
  travelClass: [
    'travelClass',
    'class',
    'serviceClass',
    'accommodationType',
    'cabinClass',
    'accommodation',
  ],
  availability: ['availability', 'seatAvailability', 'status', 'available', 'inventoryStatus'],
  seats: [
    'seatsRemaining',
    'seatsAvailable',
    'seatAvailabilityInventory',
    'inventory',
    'remainingSeats',
  ],
  refundable: ['refundable', 'isRefundable', 'fullyRefundable'],
} as const;

function parseDurationMinutes(value: Json): number | null {
  const n = toIntOrNull(value);
  if (n !== null && typeof value === 'number') return n;
  const raw = toStringOrNull(value);
  if (!raw) return n;
  // 'PT4H09M'
  const iso = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?/i.exec(raw);
  if (iso) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0);
  // '4h 9m' / '4:09'
  const hm = /^(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/i.exec(raw);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const colon = /^(\d+):(\d{2})$/.exec(raw);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  return n;
}

function minutesBetweenLocalIso(from: string, to: string): number | null {
  const a = Date.parse(`${from}:00Z`);
  const b = Date.parse(`${to}:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const diff = Math.round((b - a) / 60000);
  return diff >= 0 ? diff : null;
}

function stationCode(value: Json): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    return /^[A-Z]{3}$/.test(trimmed) ? trimmed : trimmed || null;
  }
  if (isObject(value)) {
    for (const key of ['code', 'stationCode', 'id']) {
      const v = toStringOrNull(value[key]);
      if (v) return v.toUpperCase();
    }
  }
  return null;
}

function normalizeLegs(
  raw: Json,
  travelDate: CalendarDate,
  tracker: AliasTracker,
  fallback: {
    origin: string;
    destination: string;
    departure: string | null;
    arrival: string | null;
    trainNumber: string | null;
    serviceName: string | null;
  },
): JourneyLeg[] {
  const list = Array.isArray(raw) ? raw.filter(isObject) : [];
  if (list.length === 0) {
    if (!fallback.departure || !fallback.arrival) return [];
    // A single-leg journey that did not enumerate its legs.
    tracker.note('legs=synthesised');
    return [
      {
        originCode: fallback.origin,
        destinationCode: fallback.destination,
        departureLocal: fallback.departure,
        arrivalLocal: fallback.arrival,
        mode: normalizeLegMode(fallback.serviceName),
        serviceName: fallback.serviceName,
        trainNumber: fallback.trainNumber,
        durationMinutes: minutesBetweenLocalIso(fallback.departure, fallback.arrival),
      },
    ];
  }

  const legs: JourneyLeg[] = [];
  for (const item of list) {
    const departure = toLocalIso(tracker.pick(item, A.departure, 'leg.departure'), travelDate);
    const arrival = toLocalIso(tracker.pick(item, A.arrival, 'leg.arrival'), travelDate);
    const serviceName = toStringOrNull(tracker.pick(item, A.serviceName, 'leg.serviceName'));
    const modeRaw = toStringOrNull(tracker.pick(item, A.mode, 'leg.mode'));
    const mode = modeRaw ? normalizeLegMode(modeRaw) : normalizeLegMode(serviceName);
    legs.push({
      originCode: stationCode(tracker.pick(item, A.origin, 'leg.origin')) ?? fallback.origin,
      destinationCode:
        stationCode(tracker.pick(item, A.destination, 'leg.destination')) ?? fallback.destination,
      departureLocal: departure ?? fallback.departure ?? `${travelDate}T00:00`,
      arrivalLocal: arrival ?? fallback.arrival ?? `${travelDate}T00:00`,
      mode,
      serviceName,
      trainNumber: toStringOrNull(tracker.pick(item, A.trainNumber, 'leg.trainNumber')),
      durationMinutes:
        parseDurationMinutes(tracker.pick(item, A.duration, 'leg.duration')) ??
        (departure && arrival ? minutesBetweenLocalIso(departure, arrival) : null),
    });
  }
  return legs;
}

function normalizeFares(
  raw: Json,
  journeyId: string,
  passengers: number,
  opts: NormalizeOptions,
  tracker: AliasTracker,
): Fare[] {
  const list = Array.isArray(raw) ? raw.filter(isObject) : isObject(raw) ? [raw] : [];
  const fares: Fare[] = [];

  list.forEach((item, index) => {
    const amountRaw = tracker.pick(item, A.amount, 'fare.amount');
    const amountCents = toCents(amountRaw, opts.amountUnit);

    // A fare we cannot price is dropped entirely. It is never treated as free.
    if (!isPlausibleFare(amountCents)) {
      tracker.note('fare=unpriced-skipped');
      return;
    }

    const familyRaw = toStringOrNull(tracker.pick(item, A.fareFamily, 'fare.family'));
    const classRaw = toStringOrNull(tracker.pick(item, A.travelClass, 'fare.class'));
    const seats = toIntOrNull(tracker.pick(item, A.seats, 'fare.seats'));
    const availability = normalizeAvailability(
      tracker.pick(item, A.availability, 'fare.availability'),
      seats,
    );
    const family = normalizeFareFamily(familyRaw);
    const refundableRaw = tracker.pick(item, A.refundable, 'fare.refundable');

    const { partyTotalCents, pricingConfidence } = derivePartyTotal(
      amountCents,
      passengers,
      opts.pricingBasis,
    );

    fares.push({
      id: `${journeyId}:${family}:${index}`,
      family,
      familyRaw,
      travelClass: normalizeTravelClass(classRaw),
      travelClassRaw: classRaw,
      amountCents,
      partyTotalCents,
      currency: toStringOrNull(tracker.pick(item, A.currency, 'fare.currency')) ?? 'USD',
      pricingBasis: opts.pricingBasis,
      pricingConfidence,
      availability,
      restricted: family === 'VALUE' || family === 'SAVER',
      refundable:
        typeof refundableRaw === 'boolean' ? refundableRaw : family === 'FLEXIBLE' ? true : null,
      seatsRemaining: seats,
    });
  });

  return fares;
}

/**
 * Convert a provider amount into a party total, and say how much we trust it.
 * With an UNKNOWN basis and a single passenger the two interpretations are
 * arithmetically identical, so the number is safe to alert on.
 */
export function derivePartyTotal(
  amountCents: Cents,
  passengers: number,
  basis: PricingBasis,
): { partyTotalCents: Cents; pricingConfidence: PricingConfidence } {
  if (basis === 'TOTAL_PARTY') {
    return { partyTotalCents: amountCents, pricingConfidence: 'CONFIRMED' };
  }
  if (basis === 'PER_PASSENGER') {
    return {
      partyTotalCents: multiplyCents(amountCents, passengers),
      pricingConfidence: 'CONFIRMED',
    };
  }
  if (passengers === 1) {
    return { partyTotalCents: amountCents, pricingConfidence: 'UNAMBIGUOUS_SINGLE' };
  }
  // Unknown basis with a party: show it, badge it, never alert on it.
  return {
    partyTotalCents: multiplyCents(amountCents, passengers),
    pricingConfidence: 'AMBIGUOUS',
  };
}

export function normalizeJourney(
  raw: JsonObject,
  request: FareSearchRequest,
  index: number,
  opts: NormalizeOptions,
  tracker: AliasTracker,
): Journey | null {
  const travelDate = assertCalendarDate(request.date);

  const departureRaw = tracker.pick(raw, A.departure, 'journey.departure');
  const arrivalRaw = tracker.pick(raw, A.arrival, 'journey.arrival');
  const departureLocal = toLocalIso(departureRaw, travelDate);
  const arrivalLocal = toLocalIso(arrivalRaw, travelDate);

  const providerJourneyId =
    toStringOrNull(tracker.pick(raw, A.journeyId, 'journey.id')) ??
    `${request.originCode}-${request.destinationCode}-${travelDate}-${index}`;

  const trainNumber = toStringOrNull(tracker.pick(raw, A.trainNumber, 'journey.trainNumber'));
  const serviceName = toStringOrNull(tracker.pick(raw, A.serviceName, 'journey.serviceName'));
  const originCode =
    stationCode(tracker.pick(raw, A.origin, 'journey.origin')) ?? request.originCode.toUpperCase();
  const destinationCode =
    stationCode(tracker.pick(raw, A.destination, 'journey.destination')) ??
    request.destinationCode.toUpperCase();

  const legs = normalizeLegs(tracker.pick(raw, A.legs, 'journey.legs'), travelDate, tracker, {
    origin: originCode,
    destination: destinationCode,
    departure: departureLocal,
    arrival: arrivalLocal,
    trainNumber,
    serviceName,
  });

  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];
  const effectiveDeparture = departureLocal ?? firstLeg?.departureLocal ?? null;
  const effectiveArrival = arrivalLocal ?? lastLeg?.arrivalLocal ?? null;

  // Without a departure time we cannot rank, display, or hand off. Drop it.
  if (!effectiveDeparture || !effectiveArrival) {
    tracker.note('journey=missing-times-skipped');
    return null;
  }

  const declaredTransfers = toIntOrNull(tracker.pick(raw, A.transfers, 'journey.transfers'));
  const transfers = declaredTransfers ?? Math.max(0, legs.length - 1);

  const durationMinutes =
    parseDurationMinutes(tracker.pick(raw, A.duration, 'journey.duration')) ??
    minutesBetweenLocalIso(effectiveDeparture, effectiveArrival) ??
    0;

  const fares = normalizeFares(
    tracker.pick(raw, A.fares, 'journey.fares'),
    providerJourneyId,
    request.passengers,
    opts,
    tracker,
  );

  const bookingUrlRaw = toStringOrNull(tracker.pick(raw, A.bookingUrl, 'journey.bookingUrl'));

  return {
    providerJourneyId,
    serviceName,
    trainNumber: trainNumber ?? firstLeg?.trainNumber ?? null,
    originCode,
    destinationCode,
    departureLocal: effectiveDeparture,
    arrivalLocal: effectiveArrival,
    durationMinutes,
    transfers,
    travelDate: calendarDateFromLocalIso(effectiveDeparture),
    serviceType: deriveServiceType(legs),
    legs,
    fares,
    bookingUrl: bookingUrlRaw,
  };
}

export function normalizeSearchTrains(
  payload: Json,
  request: FareSearchRequest,
  meta: Omit<ProviderMetadata, 'schemaAliases'>,
  opts: NormalizeOptions,
): FareSearchResult {
  const tracker = new AliasTracker();
  const rawJourneys = findJourneyArray(payload, tracker);

  const journeys: Journey[] = [];
  rawJourneys.forEach((raw, index) => {
    const journey = normalizeJourney(raw, request, index, opts, tracker);
    if (journey) journeys.push(journey);
  });

  return {
    request,
    journeys,
    // Emptiness is a RESULT here, reached only via a well-formed 200 response.
    availability: journeys.length > 0 ? 'HAS_AVAILABILITY' : 'NO_AVAILABILITY',
    meta: { ...meta, schemaAliases: [...tracker.matched].sort() },
  };
}

export { AliasTracker };
