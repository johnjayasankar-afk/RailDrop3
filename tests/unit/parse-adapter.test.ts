import { describe, expect, it } from 'vitest';
import {
  AliasTracker,
  deriveServiceType,
  findJourneyArray,
  isPlausibleFare,
  normalizeAvailability,
  normalizeFareFamily,
  normalizeLegMode,
  normalizeSearchTrains,
  normalizeTravelClass,
  toCents,
  toLocalIso,
  type NormalizeOptions,
} from '@/lib/providers/parse/adapter';
import { ProviderSchemaError } from '@/lib/providers/fare-provider';
import type { ProviderMetadata } from '@/lib/domain/types';
import { makeRequest } from '../helpers/factories';

const META: Omit<ProviderMetadata, 'schemaAliases'> = {
  providerId: 'parse',
  requestId: 'r1',
  fetchedAt: '2026-09-02T18:02:00.000Z',
  latencyMs: 200,
  httpStatus: 200,
  creditsCharged: 2,
  creditsRemaining: 100,
  rateLimitRemaining: 4,
  deduplicated: false,
};

const OPTS: NormalizeOptions = { pricingBasis: 'UNKNOWN', amountUnit: 'dollars' };

/** Shaped after the documented `journeySolutionOption` / fare-family response. */
function realisticPayload() {
  return {
    status: 'success',
    data: {
      journeySolutionOption: [
        {
          id: 'sol-1',
          train_number: '179',
          train_name: 'Northeast Regional',
          origin: 'BOS',
          destination: 'NYP',
          departure_time: '2026-09-20T07:05:00',
          arrival_time: '2026-09-20T11:14:00',
          duration: 249,
          transfers: 0,
          travelLegs: [
            {
              origin: 'BOS',
              destination: 'NYP',
              departure_time: '2026-09-20T07:05:00',
              arrival_time: '2026-09-20T11:14:00',
              mode: 'TRAIN',
              train_name: 'Northeast Regional',
              train_number: '179',
            },
          ],
          fares: [
            {
              fare_family: 'FLX',
              travelClass: 'Coach',
              price: 74,
              currency: 'USD',
              availability: 'AVAILABLE',
              seatsRemaining: 24,
            },
            {
              fare_family: 'VLU',
              travelClass: 'Coach',
              price: 61.5,
              currency: 'USD',
              availability: 'AVAILABLE',
              seatsRemaining: 24,
            },
            {
              fare_family: 'SVR',
              travelClass: 'Coach',
              price: 52,
              currency: 'USD',
              availability: 'SOLD_OUT',
              seatsRemaining: 0,
            },
          ],
        },
      ],
    },
  };
}

describe('parse adapter — normalization', () => {
  it('normalizes a realistic search_trains payload', () => {
    const result = normalizeSearchTrains(realisticPayload(), makeRequest(), META, OPTS);

    expect(result.availability).toBe('HAS_AVAILABILITY');
    expect(result.journeys).toHaveLength(1);

    const journey = result.journeys[0]!;
    expect(journey.providerJourneyId).toBe('sol-1');
    expect(journey.trainNumber).toBe('179');
    expect(journey.serviceName).toBe('Northeast Regional');
    expect(journey.originCode).toBe('BOS');
    expect(journey.destinationCode).toBe('NYP');
    expect(journey.departureLocal).toBe('2026-09-20T07:05');
    expect(journey.arrivalLocal).toBe('2026-09-20T11:14');
    expect(journey.durationMinutes).toBe(249);
    expect(journey.transfers).toBe(0);
    expect(journey.travelDate).toBe('2026-09-20');
    expect(journey.serviceType).toBe('DIRECT_RAIL');

    expect(journey.fares.map((f) => f.family)).toEqual(['FLEXIBLE', 'VALUE', 'SAVER']);
    expect(journey.fares[0]!.amountCents).toBe(7400);
    expect(journey.fares[1]!.amountCents).toBe(6150);
    expect(journey.fares[0]!.travelClass).toBe('COACH');
    expect(journey.fares[2]!.availability).toBe('SOLD_OUT');
    expect(journey.fares[1]!.restricted).toBe(true);
    expect(journey.fares[0]!.restricted).toBe(false);
  });

  it('records which field aliases it matched, for schema fingerprinting', () => {
    const result = normalizeSearchTrains(realisticPayload(), makeRequest(), META, OPTS);
    expect(result.meta.schemaAliases).toContain('container=journeySolutionOption');
    expect(result.meta.schemaAliases).toContain('journey.departure=departure_time');
    expect(result.meta.schemaAliases).toContain('fare.amount=price');
  });

  it('treats an empty journey list as a SUCCESSFUL no-availability result', () => {
    const result = normalizeSearchTrains(
      { status: 'success', data: { journeySolutionOption: [] } },
      makeRequest(),
      META,
      OPTS,
    );
    expect(result.availability).toBe('NO_AVAILABILITY');
    expect(result.journeys).toEqual([]);
  });

  it('raises a schema error rather than pretending there is no availability', () => {
    expect(() =>
      normalizeSearchTrains({ unexpected: 'shape', foo: 42 }, makeRequest(), META, OPTS),
    ).toThrow(ProviderSchemaError);
    expect(() => normalizeSearchTrains('not-json-object', makeRequest(), META, OPTS)).toThrow(
      ProviderSchemaError,
    );
  });

  it('marks a bus leg as Thruway, never as rail', () => {
    const payload = realisticPayload();
    payload.data.journeySolutionOption[0]!.travelLegs[0]!.mode = 'BUS';
    payload.data.journeySolutionOption[0]!.train_name = 'Thruway Bus';
    const result = normalizeSearchTrains(payload, makeRequest(), META, OPTS);
    expect(result.journeys[0]!.serviceType).toBe('THRUWAY_BUS');
    expect(result.journeys[0]!.legs[0]!.mode).toBe('BUS');
  });

  it('derives connecting rail from multiple legs', () => {
    const payload = realisticPayload();
    const solution = payload.data.journeySolutionOption[0]!;
    solution.travelLegs = [
      { ...solution.travelLegs[0]!, destination: 'PVD', arrival_time: '2026-09-20T08:15:00' },
      { ...solution.travelLegs[0]!, origin: 'PVD', departure_time: '2026-09-20T08:45:00' },
    ];
    delete (solution as { transfers?: number }).transfers;
    const result = normalizeSearchTrains(payload, makeRequest(), META, OPTS);
    expect(result.journeys[0]!.serviceType).toBe('CONNECTING_RAIL');
    expect(result.journeys[0]!.transfers).toBe(1);
  });

  it('drops an unpriceable fare instead of treating it as free', () => {
    const payload = realisticPayload();
    payload.data.journeySolutionOption[0]!.fares = [
      {
        fare_family: 'FLX',
        travelClass: 'Coach',
        price: null as never,
        currency: 'USD',
        availability: 'AVAILABLE',
        seatsRemaining: 3,
      },
    ];
    const result = normalizeSearchTrains(payload, makeRequest(), META, OPTS);
    expect(result.journeys[0]!.fares).toHaveLength(0);
    expect(result.meta.schemaAliases).toContain('fare=unpriced-skipped');
  });

  it('drops a journey with no usable departure time', () => {
    const payload = realisticPayload();
    const solution = payload.data.journeySolutionOption[0]!;
    solution.departure_time = '' as never;
    solution.arrival_time = '' as never;
    solution.travelLegs = [];
    const result = normalizeSearchTrains(payload, makeRequest(), META, OPTS);
    expect(result.journeys).toHaveLength(0);
    expect(result.availability).toBe('NO_AVAILABILITY');
  });

  it('multiplies to a party total only when the basis says to', () => {
    const request = makeRequest({ passengers: 2 });
    const perPax = normalizeSearchTrains(realisticPayload(), request, META, {
      pricingBasis: 'PER_PASSENGER',
      amountUnit: 'dollars',
    });
    expect(perPax.journeys[0]!.fares[0]!.partyTotalCents).toBe(14800);
    expect(perPax.journeys[0]!.fares[0]!.pricingConfidence).toBe('CONFIRMED');

    const total = normalizeSearchTrains(realisticPayload(), request, META, {
      pricingBasis: 'TOTAL_PARTY',
      amountUnit: 'dollars',
    });
    expect(total.journeys[0]!.fares[0]!.partyTotalCents).toBe(7400);
  });

  it('finds journeys under several container shapes', () => {
    const shapes: unknown[] = [
      {
        journeys: [
          { departure_time: '2026-09-20T07:05:00', arrival_time: '2026-09-20T11:14:00', fares: [] },
        ],
      },
      {
        data: {
          journeySolutions: [
            { departure_time: '2026-09-20T07:05:00', arrival_time: '2026-09-20T11:14:00' },
          ],
        },
      },
      { results: [{ departureTime: '2026-09-20T07:05:00', arrivalTime: '2026-09-20T11:14:00' }] },
      [{ departure: '2026-09-20T07:05:00', arrival: '2026-09-20T11:14:00' }],
    ];
    for (const shape of shapes) {
      const result = normalizeSearchTrains(shape, makeRequest(), META, OPTS);
      expect(result.journeys).toHaveLength(1);
    }
  });

  it('discovers a nested journey array it does not have a name for', () => {
    const tracker = new AliasTracker();
    const found = findJourneyArray(
      { payload: { deeply: { nested: [{ departure_time: '2026-09-20T07:05:00', fares: [] }] } } },
      tracker,
    );
    expect(found).toHaveLength(1);
  });
});

describe('parse adapter — scalar coercion', () => {
  it('converts amounts from dollars by default', () => {
    expect(toCents(74, 'dollars')).toBe(7400);
    expect(toCents(61.5, 'dollars')).toBe(6150);
    expect(toCents('74.00', 'dollars')).toBe(7400);
    expect(toCents('$1,284.50', 'dollars')).toBe(128450);
    expect(toCents({ amount: 74, currency: 'USD' }, 'dollars')).toBe(7400);
  });

  it('honours a cents-configured provider', () => {
    expect(toCents(7400, 'cents')).toBe(7400);
  });

  it('returns null for values it cannot price', () => {
    for (const bad of [null, undefined, '', 'free', true, [], {}]) {
      expect(toCents(bad, 'dollars')).toBeNull();
    }
  });

  it('rejects implausible fares so a unit misread cannot invent savings', () => {
    expect(isPlausibleFare(7400)).toBe(true);
    expect(isPlausibleFare(50)).toBe(false); // $0.50
    expect(isPlausibleFare(2_000_000)).toBe(false); // $20,000
    expect(isPlausibleFare(null)).toBe(false);
  });

  it('normalizes date-times to local wall clock without shifting them', () => {
    expect(toLocalIso('2026-09-20T07:05:00', '2026-09-20')).toBe('2026-09-20T07:05');
    expect(toLocalIso('2026-09-20 07:05', '2026-09-20')).toBe('2026-09-20T07:05');
    // A trailing offset is discarded, not converted - Amtrak times are station-local.
    expect(toLocalIso('2026-09-20T07:05:00-04:00', '2026-09-20')).toBe('2026-09-20T07:05');
    expect(toLocalIso('7:05 AM', '2026-09-20')).toBe('2026-09-20T07:05');
    expect(toLocalIso('7:05 PM', '2026-09-20')).toBe('2026-09-20T19:05');
    expect(toLocalIso('12:30 AM', '2026-09-20')).toBe('2026-09-20T00:30');
    expect(toLocalIso('nonsense', '2026-09-20')).toBeNull();
  });

  it('maps fare families including the documented codes', () => {
    expect(normalizeFareFamily('FLX')).toBe('FLEXIBLE');
    expect(normalizeFareFamily('VLU')).toBe('VALUE');
    expect(normalizeFareFamily('SVR')).toBe('SAVER');
    expect(normalizeFareFamily('Flexible')).toBe('FLEXIBLE');
    expect(normalizeFareFamily('Something New')).toBe('UNKNOWN');
    expect(normalizeFareFamily(null)).toBe('UNKNOWN');
  });

  it('maps travel classes', () => {
    expect(normalizeTravelClass('Coach')).toBe('COACH');
    expect(normalizeTravelClass('Reserved Coach Seat')).toBe('COACH');
    expect(normalizeTravelClass('Business')).toBe('BUSINESS');
    expect(normalizeTravelClass('Acela First')).toBe('FIRST');
    expect(normalizeTravelClass('Roomette')).toBe('SLEEPER');
    expect(normalizeTravelClass('Mystery')).toBe('UNKNOWN');
  });

  it('maps availability, falling back to seat counts', () => {
    expect(normalizeAvailability('AVAILABLE', null)).toBe('AVAILABLE');
    expect(normalizeAvailability('Sold Out', null)).toBe('SOLD_OUT');
    expect(normalizeAvailability('Limited', null)).toBe('LIMITED');
    expect(normalizeAvailability(true, null)).toBe('AVAILABLE');
    expect(normalizeAvailability(false, null)).toBe('SOLD_OUT');
    expect(normalizeAvailability(null, 0)).toBe('SOLD_OUT');
    expect(normalizeAvailability(null, 3)).toBe('LIMITED');
    expect(normalizeAvailability(null, 30)).toBe('AVAILABLE');
    expect(normalizeAvailability(null, null)).toBe('UNKNOWN');
  });

  it('never labels a bus as rail', () => {
    expect(normalizeLegMode('Thruway Bus')).toBe('BUS');
    expect(normalizeLegMode('MOTORCOACH')).toBe('BUS');
    expect(normalizeLegMode('TRAIN')).toBe('RAIL');
    expect(normalizeLegMode('Acela')).toBe('RAIL');
    expect(normalizeLegMode('ferry')).toBe('UNKNOWN');
  });

  it('derives service type from leg modes', () => {
    const leg = (mode: 'RAIL' | 'BUS' | 'UNKNOWN') => ({
      originCode: 'BOS',
      destinationCode: 'NYP',
      departureLocal: '2026-09-20T07:05',
      arrivalLocal: '2026-09-20T11:14',
      mode,
      serviceName: null,
      trainNumber: null,
      durationMinutes: 249,
    });
    expect(deriveServiceType([leg('RAIL')])).toBe('DIRECT_RAIL');
    expect(deriveServiceType([leg('RAIL'), leg('RAIL')])).toBe('CONNECTING_RAIL');
    expect(deriveServiceType([leg('RAIL'), leg('BUS')])).toBe('THRUWAY_BUS');
    expect(deriveServiceType([leg('UNKNOWN')])).toBe('UNKNOWN');
    expect(deriveServiceType([])).toBe('UNKNOWN');
  });
});
