import { describe, expect, it } from 'vitest';

import {
  MIN_OBSERVATIONS,
  describeVerdict,
  lastChange,
  priceStats,
} from '@/lib/domain/price-stats';

describe('price statistics', () => {
  it('says nothing at all with no history', () => {
    const stats = priceStats([], 7400);
    expect(stats.observations).toBe(0);
    expect(stats.verdict).toBe('UNKNOWN');
    expect(stats.lowestCents).toBeNull();
  });

  it('refuses a verdict below the confidence floor', () => {
    // Three checks is one day. Calling that "a good price" would dress noise
    // up as a judgement.
    const stats = priceStats([9000, 8500, 8000], 7400);
    expect(stats.observations).toBe(3);
    expect(stats.confident).toBe(false);
    expect(stats.verdict).toBe('UNKNOWN');
    // The descriptive figures are still real and still reported.
    expect(stats.lowestCents).toBe(8000);
    expect(stats.highestCents).toBe(9000);
  });

  it('gives a verdict once there are enough observations', () => {
    const stats = priceStats([9000, 8800, 8600, 8400, 8200], 8000);
    expect(stats.confident).toBe(true);
    expect(stats.verdict).toBe('BEST_YET');
  });

  it('calls the lowest price yet exactly that, including a tie with the lowest', () => {
    expect(priceStats([9000, 8000, 8500, 8200, 8100], 8000).verdict).toBe('BEST_YET');
    expect(priceStats([9000, 8000, 8500, 8200, 8100], 7900).verdict).toBe('BEST_YET');
  });

  it('grades a price by how much of the observed range it beats', () => {
    const history = [10000, 9500, 9000, 8500, 8000, 7500, 7000, 6500, 6000, 5500];
    // Beats 9 of 10.
    expect(priceStats(history, 5800).verdict).toBe('GOOD');
    // Beats 5 of 10.
    expect(priceStats(history, 7800).verdict).toBe('TYPICAL');
    // Beats 1 of 10.
    expect(priceStats(history, 9800).verdict).toBe('HIGH');
  });

  it('excludes failed checks rather than letting an outage thin the sample', () => {
    const stats = priceStats([9000, null, 8500, null, 8000, 8200, 8100], 8000);
    expect(stats.observations).toBe(5);
    expect(stats.lowestCents).toBe(8000);
    expect(stats.confident).toBe(true);
  });

  it('is not confident when failures leave too few real prices', () => {
    const stats = priceStats([9000, null, null, null, 8000], 8000);
    expect(stats.observations).toBe(2);
    expect(stats.confident).toBe(false);
    expect(stats.verdict).toBe('UNKNOWN');
  });

  it('computes the median for odd and even counts', () => {
    expect(priceStats([100, 300, 200], null).medianCents).toBe(200);
    expect(priceStats([100, 400, 200, 300], null).medianCents).toBe(250);
  });

  it('rounds an even-count median to whole cents', () => {
    // 101 and 102 average to 101.5, which is not money.
    expect(priceStats([101, 102], null).medianCents).toBe(102);
    expect(Number.isInteger(priceStats([101, 102], null).medianCents)).toBe(true);
  });

  it('reports the range but no verdict when there is no current price', () => {
    const stats = priceStats([9000, 8000, 8500, 8200, 8100], null);
    expect(stats.lowestCents).toBe(8000);
    expect(stats.highestCents).toBe(9000);
    expect(stats.betterThan).toBeNull();
    expect(stats.verdict).toBe('UNKNOWN');
  });

  it('handles a completely flat history without dividing by zero', () => {
    const stats = priceStats([8000, 8000, 8000, 8000, 8000], 8000);
    expect(stats.betterThan).toBe(0);
    expect(stats.verdict).toBe('BEST_YET');
    expect(stats.medianCents).toBe(8000);
  });

  it('ignores negative sentinels rather than treating them as free travel', () => {
    const stats = priceStats([-1, 9000, 8000, 8500, 8200, 8100], 8000);
    expect(stats.observations).toBe(5);
    expect(stats.lowestCents).toBe(8000);
  });

  it('never claims a direction the data cannot support', () => {
    const words = Object.values(
      (['BEST_YET', 'GOOD', 'TYPICAL', 'HIGH', 'UNKNOWN'] as const).map((verdict) => {
        const history = [9000, 8800, 8600, 8400, 8200];
        const current =
          verdict === 'BEST_YET'
            ? 8000
            : verdict === 'HIGH'
              ? 8900
              : verdict === 'GOOD'
                ? 8300
                : 8500;
        return describeVerdict(
          verdict === 'UNKNOWN' ? priceStats([9000], 9000) : priceStats(history, current),
        );
      }),
    )
      .map((d) => `${d.label} ${d.detail}`)
      .join(' ')
      .toLowerCase();

    // Descriptive, never predictive: no claim about what happens next.
    for (const forbidden of ['will ', 'expect', 'predict', 'forecast', 'likely', 'should drop']) {
      expect(words, `verdict copy must not say "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('explains itself honestly while below the confidence floor', () => {
    const description = describeVerdict(priceStats([9000, 8000], 8000));
    expect(description.label).toBe('Not enough history');
    expect(description.detail).toContain(String(MIN_OBSERVATIONS));
    expect(description.detail).toContain('2 so far');
  });
});

describe('last change', () => {
  it('is null with nothing to compare — one price is not a movement', () => {
    expect(lastChange([])).toBeNull();
    expect(lastChange([8000])).toBeNull();
    expect(lastChange([null, 8000, null])).toBeNull();
  });

  it('reports a drop as a positive number and a rise as a negative one', () => {
    expect(lastChange([9000, 8000])).toEqual({ dropCents: 1000, fromCents: 9000, toCents: 8000 });
    expect(lastChange([8000, 9000])).toEqual({ dropCents: -1000, fromCents: 8000, toCents: 9000 });
  });

  it('skips failed checks rather than inventing a swing across an outage', () => {
    // Two identical prices either side of an outage is no change, not a jump.
    expect(lastChange([8000, null, null, 8000])?.dropCents).toBe(0);
    expect(lastChange([9000, null, 8000])).toEqual({
      dropCents: 1000,
      fromCents: 9000,
      toCents: 8000,
    });
  });

  it('compares only the two most recent observations', () => {
    expect(lastChange([10000, 9000, 8000])?.fromCents).toBe(9000);
  });
});
