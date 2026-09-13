import { describe, expect, it } from 'vitest';
import { convenienceScore, departureProximityMinutes, rankCandidates } from '@/lib/domain/ranking';
import { makeCandidate, makeWatch } from '../helpers/factories';

const watch = makeWatch();

function candidate(opts: {
  id: string;
  cents: number;
  displacement?: number;
  date?: string;
  departure?: string;
  transfers?: number;
  duration?: number;
  family?: 'FLEXIBLE' | 'VALUE' | 'SAVER';
}) {
  const date = opts.date ?? '2026-09-20';
  return makeCandidate({
    displacementDays: opts.displacement ?? 0,
    journey: {
      providerJourneyId: opts.id,
      travelDate: date,
      departureLocal: opts.departure ?? `${date}T07:05`,
      arrivalLocal: `${date}T11:14`,
      transfers: opts.transfers ?? 0,
      durationMinutes: opts.duration ?? 249,
    },
    fare: {
      id: `${opts.id}-f`,
      amountCents: opts.cents,
      partyTotalCents: opts.cents,
      family: opts.family ?? 'FLEXIBLE',
    },
  });
}

describe('ranking', () => {
  it('puts the cheapest option first, even a day away from the desired date', () => {
    // The spec's headline case: $59 one day early must beat $120 on the exact day.
    const exact = candidate({ id: 'exact', cents: 12000, displacement: 0 });
    const early = candidate({ id: 'early', cents: 5900, displacement: -1, date: '2026-09-19' });

    const ranked = rankCandidates([exact, early], watch);
    expect(ranked[0]?.journey.providerJourneyId).toBe('early');
    expect(ranked[1]?.journey.providerJourneyId).toBe('exact');
  });

  it('prefers the desired date when prices tie', () => {
    const early = candidate({ id: 'early', cents: 7400, displacement: -1, date: '2026-09-19' });
    const exact = candidate({ id: 'exact', cents: 7400, displacement: 0 });
    expect(rankCandidates([early, exact], watch)[0]?.journey.providerJourneyId).toBe('exact');
  });

  it('prefers the smaller displacement when neither is the desired date', () => {
    const near = candidate({ id: 'near', cents: 7400, displacement: -1, date: '2026-09-19' });
    const far = candidate({ id: 'far', cents: 7400, displacement: 2, date: '2026-09-22' });
    expect(rankCandidates([far, near], watch)[0]?.journey.providerJourneyId).toBe('near');
  });

  it('uses preferred departure proximity only when the user supplied one', () => {
    const morning = candidate({ id: 'morning', cents: 7400, departure: '2026-09-20T07:00' });
    const evening = candidate({ id: 'evening', cents: 7400, departure: '2026-09-20T19:00' });

    // Without a preference, the later tiebreaks decide - not the time.
    const noPreference = rankCandidates([evening, morning], makeWatch());
    expect(noPreference.map((c) => c.journey.providerJourneyId)).toEqual(['evening', 'morning']);

    const prefersEvening = makeWatch({
      preferences: { preferredDepartureMinutes: 19 * 60 } as never,
    });
    expect(rankCandidates([morning, evening], prefersEvening)[0]?.journey.providerJourneyId).toBe(
      'evening',
    );
  });

  it('prefers fewer transfers, then shorter duration, then stronger fare family', () => {
    const direct = candidate({ id: 'direct', cents: 7400, transfers: 0 });
    const connecting = candidate({ id: 'connecting', cents: 7400, transfers: 1 });
    expect(rankCandidates([connecting, direct], watch)[0]?.journey.providerJourneyId).toBe(
      'direct',
    );

    const fast = candidate({ id: 'fast', cents: 7400, duration: 200 });
    const slow = candidate({ id: 'slow', cents: 7400, duration: 400 });
    expect(rankCandidates([slow, fast], watch)[0]?.journey.providerJourneyId).toBe('fast');

    const flexible = candidate({ id: 'flexible', cents: 7400, family: 'FLEXIBLE' });
    const saver = candidate({ id: 'saver', cents: 7400, family: 'SAVER' });
    expect(rankCandidates([saver, flexible], watch)[0]?.journey.providerJourneyId).toBe('flexible');
  });

  it('is deterministic when everything ties', () => {
    const a = candidate({ id: 'aaa', cents: 7400 });
    const b = candidate({ id: 'bbb', cents: 7400 });
    expect(rankCandidates([b, a], watch).map((c) => c.journey.providerJourneyId)).toEqual([
      'aaa',
      'bbb',
    ]);
    expect(rankCandidates([a, b], watch).map((c) => c.journey.providerJourneyId)).toEqual([
      'aaa',
      'bbb',
    ]);
  });

  it('scores the desired date as materially more convenient than a day away', () => {
    const exact = convenienceScore(candidate({ id: 'x', cents: 9000, displacement: 0 }), watch);
    const early = convenienceScore(
      candidate({ id: 'y', cents: 8900, displacement: -1, date: '2026-09-19' }),
      watch,
    );
    expect(exact - early).toBeGreaterThanOrEqual(15);
  });

  it('penalises transfers in the convenience score', () => {
    const direct = convenienceScore(candidate({ id: 'd', cents: 9000, transfers: 0 }), watch);
    const oneStop = convenienceScore(candidate({ id: 'c', cents: 9000, transfers: 1 }), watch);
    expect(direct).toBeGreaterThan(oneStop);
  });

  it('measures departure proximity safely', () => {
    const c = candidate({ id: 'p', cents: 7400, departure: '2026-09-20T07:05' });
    expect(departureProximityMinutes(c, 7 * 60)).toBe(5);
    expect(departureProximityMinutes(c, null)).toBe(0);
  });
});
