import { describe, expect, it } from 'vitest';

import { realisedSavings, type BenchmarkEvent } from '@/lib/domain/savings';

const event = (watchId: string, benchmarkVersion: number, amountCents: number): BenchmarkEvent => ({
  watchId,
  benchmarkVersion,
  amountCents,
});

describe('realised savings', () => {
  it('is zero when nothing was ever rebooked', () => {
    expect(realisedSavings([event('a', 1, 12800)])).toEqual({
      totalCents: 0,
      trips: 0,
      rebookings: 0,
    });
  });

  it('counts the difference when a trip is rebooked cheaper', () => {
    const result = realisedSavings([event('a', 1, 12800), event('a', 2, 7400)]);
    expect(result).toEqual({ totalCents: 5400, trips: 1, rebookings: 1 });
  });

  it('sums each downward step of a trip rebooked repeatedly', () => {
    // 128 -> 99 -> 74 is $54 of real saving, not merely the last step.
    const result = realisedSavings([
      event('a', 1, 12800),
      event('a', 2, 9900),
      event('a', 3, 7400),
    ]);
    expect(result).toEqual({ totalCents: 5400, trips: 1, rebookings: 2 });
  });

  it('never counts an upward rebooking as a saving, and never nets it off', () => {
    // Moving to a pricier flexible fare is a real choice. It is worth zero
    // here — subtracting it would understate a genuine saving elsewhere.
    const result = realisedSavings([
      event('a', 1, 7400),
      event('a', 2, 12800),
      event('a', 3, 9900),
    ]);
    expect(result).toEqual({ totalCents: 2900, trips: 1, rebookings: 1 });
  });

  it('is unaffected by the order rows arrive in', () => {
    const ordered = realisedSavings([
      event('a', 1, 12800),
      event('a', 2, 9900),
      event('a', 3, 7400),
    ]);
    const shuffled = realisedSavings([
      event('a', 3, 7400),
      event('a', 1, 12800),
      event('a', 2, 9900),
    ]);
    expect(shuffled).toEqual(ordered);
  });

  it('keeps trips separate, so one trip cannot subsidise another', () => {
    const result = realisedSavings([
      event('a', 1, 12800),
      event('b', 1, 5000),
      event('a', 2, 7400),
      event('b', 2, 9000),
    ]);
    expect(result).toEqual({ totalCents: 5400, trips: 1, rebookings: 1 });
  });

  it('counts a trip once however many times it was rebooked down', () => {
    const result = realisedSavings([
      event('a', 1, 20000),
      event('a', 2, 18000),
      event('a', 3, 16000),
      event('b', 1, 9000),
      event('b', 2, 8000),
    ]);
    expect(result).toEqual({ totalCents: 5000, trips: 2, rebookings: 3 });
  });

  it('handles an empty ledger', () => {
    expect(realisedSavings([])).toEqual({ totalCents: 0, trips: 0, rebookings: 0 });
  });
});
