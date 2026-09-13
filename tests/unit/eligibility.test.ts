import { describe, expect, it } from 'vitest';
import {
  allowedServiceTypes,
  evaluateEligibility,
  isRestrictedFamily,
} from '@/lib/domain/eligibility';
import { makeFare, makeJourney, makeRequest, makeResult, makeWatch } from '../helpers/factories';

const searchDate = { date: '2026-09-20', displacementDays: 0 };

function evaluate(journeys: Parameters<typeof makeResult>[0], watch = makeWatch()) {
  return evaluateEligibility(watch, [{ result: makeResult(journeys), searchDate }]);
}

describe('eligibility', () => {
  it('accepts a Flexible Coach fare against a Flexible Coach benchmark', () => {
    const outcome = evaluate([makeJourney()]);
    expect(outcome.eligible).toHaveLength(1);
    expect(outcome.rejected).toHaveLength(0);
  });

  it('excludes restricted fares by default and includes them when asked', () => {
    const journey = makeJourney({
      fares: [
        makeFare({ id: 'flx', family: 'FLEXIBLE', amountCents: 9000, partyTotalCents: 9000 }),
        makeFare({
          id: 'vlu',
          family: 'VALUE',
          amountCents: 7000,
          partyTotalCents: 7000,
          restricted: true,
        }),
      ],
    });

    const strict = evaluate([journey]);
    expect(strict.eligible.map((c) => c.fare.family)).toEqual(['FLEXIBLE']);
    expect(strict.rejected.some((r) => r.reason === 'FARE_FAMILY_EXCLUDED')).toBe(true);

    const permissive = evaluate(
      [journey],
      makeWatch({ preferences: { includeRestrictedFares: true } as never }),
    );
    expect(permissive.eligible.map((c) => c.fare.family).sort()).toEqual(['FLEXIBLE', 'VALUE']);
  });

  it('rejects unavailable inventory, and does not assume unknown means bookable', () => {
    const soldOut = evaluate([makeJourney({ fares: [makeFare({ availability: 'SOLD_OUT' })] })]);
    expect(soldOut.eligible).toHaveLength(0);
    expect(soldOut.rejected[0]?.reason).toBe('NOT_AVAILABLE');

    const unknown = evaluate([makeJourney({ fares: [makeFare({ availability: 'UNKNOWN' })] })]);
    expect(unknown.eligible).toHaveLength(0);
    expect(unknown.rejected[0]?.reason).toBe('NOT_AVAILABLE');

    const limited = evaluate([makeJourney({ fares: [makeFare({ availability: 'LIMITED' })] })]);
    expect(limited.eligible).toHaveLength(1);
  });

  it('rejects a travel class mismatch', () => {
    const outcome = evaluate([makeJourney({ fares: [makeFare({ travelClass: 'BUSINESS' })] })]);
    expect(outcome.eligible).toHaveLength(0);
    expect(outcome.rejected[0]?.reason).toBe('CLASS_MISMATCH');
  });

  it('excludes Thruway bus by default, includes it when toggled, and never calls it rail', () => {
    const bus = makeJourney({ providerJourneyId: 'bus', serviceType: 'THRUWAY_BUS' });

    expect(evaluate([bus]).eligible).toHaveLength(0);
    expect(evaluate([bus]).rejected[0]?.reason).toBe('SERVICE_TYPE_EXCLUDED');

    const withBus = makeWatch({ preferences: { includeThruway: true } as never });
    const permitted = evaluate([bus], withBus);
    expect(permitted.eligible).toHaveLength(1);
    // Crucially the service type is preserved, not laundered into rail.
    expect(permitted.eligible[0]?.journey.serviceType).toBe('THRUWAY_BUS');

    expect(allowedServiceTypes(makeWatch())).toEqual(['DIRECT_RAIL', 'CONNECTING_RAIL']);
    expect(allowedServiceTypes(withBus)).toContain('THRUWAY_BUS');
  });

  it('never admits an UNKNOWN service type', () => {
    const unknown = makeJourney({ serviceType: 'UNKNOWN' });
    const withBus = makeWatch({ preferences: { includeThruway: true } as never });
    expect(evaluate([unknown], withBus).eligible).toHaveLength(0);
  });

  it('accepts connecting rail', () => {
    const outcome = evaluate([makeJourney({ serviceType: 'CONNECTING_RAIL', transfers: 1 })]);
    expect(outcome.eligible).toHaveLength(1);
  });

  it('rejects a journey with no fare instead of pricing it at zero', () => {
    const outcome = evaluate([makeJourney({ fares: [] })]);
    expect(outcome.eligible).toHaveLength(0);
    expect(outcome.rejected[0]?.reason).toBe('NO_FARE');
  });

  it('rejects a route mismatch', () => {
    const outcome = evaluate([makeJourney({ destinationCode: 'PHL' })]);
    expect(outcome.rejected[0]?.reason).toBe('ROUTE_MISMATCH');
  });

  it('rejects a date outside the search window', () => {
    const outcome = evaluate([makeJourney({ travelDate: '2026-10-01' })]);
    expect(outcome.rejected[0]?.reason).toBe('DATE_NOT_IN_WINDOW');
  });

  it('rejects results fetched for the wrong passenger count', () => {
    const watch = makeWatch({ passengers: 2 });
    const outcome = evaluateEligibility(watch, [
      {
        result: makeResult([makeJourney()], { request: makeRequest({ passengers: 1 }) }),
        searchDate,
      },
    ]);
    expect(outcome.eligible).toHaveLength(0);
    expect(outcome.rejected[0]?.reason).toBe('PASSENGER_MISMATCH');
  });

  it('knows which families carry restrictions', () => {
    expect(isRestrictedFamily('VALUE')).toBe(true);
    expect(isRestrictedFamily('SAVER')).toBe(true);
    expect(isRestrictedFamily('FLEXIBLE')).toBe(false);
  });
});

describe('permanent vs transient provider failure', () => {
  it('treats only bad-input errors as permanently unroutable', async () => {
    const { isPermanentlyUnroutable } = await import('@/lib/services/batch-runner');
    expect(isPermanentlyUnroutable(['STALE_INPUT', 'STALE_INPUT', 'STALE_INPUT'])).toBe(true);
    expect(isPermanentlyUnroutable(['BAD_REQUEST', 'NOT_FOUND'])).toBe(true);
    // A single transient failure among them means the route may be fine.
    expect(isPermanentlyUnroutable(['STALE_INPUT', 'UPSTREAM', 'STALE_INPUT'])).toBe(false);
    expect(isPermanentlyUnroutable(['TIMEOUT'])).toBe(false);
    expect(isPermanentlyUnroutable(['RATE_LIMIT'])).toBe(false);
    expect(isPermanentlyUnroutable([])).toBe(false);
  });
});

describe('journey dates are validated against the date actually searched', () => {
  it('rejects an overnight journey whose travel date rolled past the searched date', () => {
    // The Sep 20 search returns a service departing 00:20 on Sep 21. Validating
    // against the union of searched dates would admit it and then tag it with
    // Sep 20's displacement of 0 - winning the "exact desired date" tiebreak and
    // being labelled "Same day" for a train that leaves the following day.
    const overnight = makeJourney({
      providerJourneyId: 'overnight',
      travelDate: '2026-09-21',
      departureLocal: '2026-09-21T00:20',
      arrivalLocal: '2026-09-21T05:10',
    });

    const outcome = evaluateEligibility(makeWatch(), [
      {
        result: makeResult([overnight], { request: makeRequest({ date: '2026-09-20' }) }),
        searchDate: { date: '2026-09-20', displacementDays: 0 },
      },
    ]);

    expect(outcome.eligible).toHaveLength(0);
    expect(outcome.rejected[0]?.reason).toBe('DATE_NOT_IN_WINDOW');
  });

  it('admits it under the date it genuinely belongs to', () => {
    const overnight = makeJourney({
      providerJourneyId: 'overnight',
      travelDate: '2026-09-21',
      departureLocal: '2026-09-21T00:20',
      arrivalLocal: '2026-09-21T05:10',
    });

    const outcome = evaluateEligibility(makeWatch(), [
      {
        result: makeResult([overnight], { request: makeRequest({ date: '2026-09-21' }) }),
        searchDate: { date: '2026-09-21', displacementDays: 1 },
      },
    ]);

    expect(outcome.eligible).toHaveLength(1);
    expect(outcome.eligible[0]?.searchDate.displacementDays).toBe(1);
  });

  it('cannot admit the same journey twice under two different dates', () => {
    const journey = makeJourney({ providerJourneyId: 'dup', travelDate: '2026-09-20' });
    const outcome = evaluateEligibility(makeWatch(), [
      {
        result: makeResult([journey], { request: makeRequest({ date: '2026-09-19' }) }),
        searchDate: { date: '2026-09-19', displacementDays: -1 },
      },
      {
        result: makeResult([journey], { request: makeRequest({ date: '2026-09-20' }) }),
        searchDate: { date: '2026-09-20', displacementDays: 0 },
      },
    ]);

    expect(outcome.eligible).toHaveLength(1);
    expect(outcome.eligible[0]?.searchDate.date).toBe('2026-09-20');
  });
});
