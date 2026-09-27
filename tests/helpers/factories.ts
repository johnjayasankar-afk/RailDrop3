import type {
  Availability,
  Candidate,
  Fare,
  FareFamily,
  FareSearchRequest,
  FareSearchResult,
  Journey,
  JourneyLeg,
  ServiceType,
  TravelClass,
  Watch,
  WatchPreferences,
} from '@/lib/domain/types';

export function makeWatch(overrides: Partial<Watch> = {}): Watch {
  const preferences: WatchPreferences = {
    dateFlexibilityDays: 1,
    travelClass: 'COACH',
    benchmarkFareFamily: 'FLEXIBLE',
    includeThruway: false,
    includeRestrictedFares: false,
    minimumSavingsCents: 500,
    targetPriceCents: null,
    preferredDepartureMinutes: null,
    ...(overrides.preferences ?? {}),
  };
  return {
    id: 'watch-1',
    userId: 'user-1',
    originCode: 'BOS',
    destinationCode: 'NYP',
    desiredDate: '2026-09-20',
    passengers: 1,
    benchmarkCents: 12800,
    benchmarkVersion: 1,
    timezone: 'America/New_York',
    status: 'ACTIVE',
    monitoringStartsAt: '2026-09-01T00:00:00.000Z',
    monitoringEndsAt: '2026-09-19T00:00:00.000Z',
    ...overrides,
    preferences,
  };
}

export function makeLeg(overrides: Partial<JourneyLeg> = {}): JourneyLeg {
  return {
    originCode: 'BOS',
    destinationCode: 'NYP',
    departureLocal: '2026-09-20T07:05',
    arrivalLocal: '2026-09-20T11:14',
    mode: 'RAIL',
    serviceName: 'Northeast Regional',
    trainNumber: '179',
    durationMinutes: 249,
    ...overrides,
  };
}

export function makeFare(overrides: Partial<Fare> = {}): Fare {
  const amountCents = overrides.amountCents ?? 7400;
  return {
    id: 'fare-1',
    family: 'FLEXIBLE' as FareFamily,
    familyRaw: 'FLX',
    travelClass: 'COACH' as TravelClass,
    travelClassRaw: 'Coach',
    amountCents,
    partyTotalCents: overrides.partyTotalCents ?? amountCents,
    currency: 'USD',
    pricingBasis: 'UNKNOWN',
    pricingConfidence: 'UNAMBIGUOUS_SINGLE',
    availability: 'AVAILABLE' as Availability,
    restricted: false,
    refundable: true,
    seatsRemaining: 20,
    ...overrides,
  };
}

export function makeJourney(overrides: Partial<Journey> = {}): Journey {
  const legs = overrides.legs ?? [makeLeg()];
  return {
    providerJourneyId: 'j-1',
    serviceName: 'Northeast Regional',
    trainNumber: '179',
    originCode: 'BOS',
    destinationCode: 'NYP',
    departureLocal: '2026-09-20T07:05',
    arrivalLocal: '2026-09-20T11:14',
    durationMinutes: 249,
    transfers: 0,
    travelDate: '2026-09-20',
    serviceType: 'DIRECT_RAIL' as ServiceType,
    fares: overrides.fares ?? [makeFare()],
    bookingUrl: null,
    ...overrides,
    legs,
  };
}

export function makeRequest(overrides: Partial<FareSearchRequest> = {}): FareSearchRequest {
  return {
    originCode: 'BOS',
    destinationCode: 'NYP',
    date: '2026-09-20',
    passengers: 1,
    ...overrides,
  };
}

export function makeResult(
  journeys: Journey[],
  overrides: Partial<FareSearchResult> = {},
): FareSearchResult {
  const request = overrides.request ?? makeRequest();
  return {
    request,
    journeys,
    availability: journeys.length > 0 ? 'HAS_AVAILABILITY' : 'NO_AVAILABILITY',
    meta: {
      providerId: 'test',
      requestId: 'req-1',
      fetchedAt: '2026-09-02T18:02:00.000Z',
      latencyMs: 120,
      httpStatus: 200,
      creditsCharged: 2,
      creditsRemaining: 998,
      rateLimitRemaining: 4,
      schemaAliases: [],
      deduplicated: false,
    },
    ...overrides,
  };
}

export function makeCandidate(
  overrides: {
    journey?: Partial<Journey>;
    fare?: Partial<Fare>;
    displacementDays?: number;
  } = {},
): Candidate {
  const displacement = overrides.displacementDays ?? 0;
  const journey = makeJourney(overrides.journey);
  return {
    journey,
    fare: makeFare(overrides.fare),
    searchDate: { date: journey.travelDate, displacementDays: displacement },
  };
}
