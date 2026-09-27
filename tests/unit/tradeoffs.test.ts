import { describe, expect, it } from 'vitest';

import { fasterAlternative, tradeoffs, type Comparable } from '@/lib/domain/tradeoffs';

const o = (totalCents: number, durationMinutes: number): Comparable => ({
  totalCents,
  durationMinutes,
});

describe('tradeoffs', () => {
  it('is inert on an empty list', () => {
    expect(tradeoffs([])).toEqual({ fastestIndex: -1, slowerByMinutes: [] });
  });

  it('finds the quickest journey and how far behind the rest are', () => {
    const result = tradeoffs([o(6205, 340), o(7282, 229), o(6832, 253)]);
    expect(result.fastestIndex).toBe(1);
    expect(result.slowerByMinutes).toEqual([111, 0, 24]);
  });

  it('keeps the first of equally quick journeys', () => {
    expect(tradeoffs([o(100, 120), o(200, 120)]).fastestIndex).toBe(0);
  });

  it('ignores a non-positive duration rather than treating it as instant', () => {
    const result = tradeoffs([o(100, 0), o(200, 180), o(300, -5)]);
    expect(result.fastestIndex).toBe(1);
    // Bad rows report no difference rather than a nonsense one.
    expect(result.slowerByMinutes[0]).toBe(0);
    expect(result.slowerByMinutes[2]).toBe(0);
  });
});

describe('faster alternative', () => {
  it('says nothing when the cheapest is already quick', () => {
    // The common case, and it must stay silent.
    expect(fasterAlternative([o(6205, 220), o(7282, 229), o(8000, 240)])).toBeNull();
  });

  it('says nothing with fewer than two options', () => {
    expect(fasterAlternative([])).toBeNull();
    expect(fasterAlternative([o(6205, 340)])).toBeNull();
  });

  it('surfaces the observed case: ten dollars for nearly two hours', () => {
    const result = fasterAlternative([o(6205, 340), o(6418, 269), o(7282, 229)]);
    expect(result).toEqual({ index: 1, extraCents: 213, minutesSaved: 71 });
  });

  it('offers the cheapest escape, not the quickest one', () => {
    // Both are meaningfully faster; the reader is being offered the least they
    // can pay to escape the slow option.
    const result = fasterAlternative([o(6000, 400), o(9000, 200), o(6500, 300)]);
    expect(result!.index).toBe(2);
    expect(result!.extraCents).toBe(500);
  });

  it('ignores a saving below the meaningful threshold', () => {
    expect(fasterAlternative([o(6000, 300), o(7000, 285)])).toBeNull();
    expect(fasterAlternative([o(6000, 300), o(7000, 269)])).not.toBeNull();
  });

  it('honours a custom threshold', () => {
    expect(fasterAlternative([o(6000, 300), o(7000, 285)], 10)).not.toBeNull();
  });

  it('stays silent when something is both cheaper and faster', () => {
    // The list is then not ranked the way this assumes; saying "pay more to go
    // faster" would be actively wrong.
    expect(fasterAlternative([o(9000, 400), o(6000, 200)])).toBeNull();
  });

  it('ignores options with unusable durations', () => {
    expect(fasterAlternative([o(6000, 400), o(7000, 0)])).toBeNull();
    expect(fasterAlternative([o(6000, 0), o(7000, 200)])).toBeNull();
  });
});
