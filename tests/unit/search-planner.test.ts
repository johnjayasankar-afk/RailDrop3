import { describe, expect, it } from 'vitest';
import {
  canonicalKey,
  isWindowExhausted,
  planSearches,
  PlannerError,
} from '@/lib/domain/search-planner';
import { makeWatch } from '../helpers/factories';

const dates = (watch: Parameters<typeof planSearches>[0], today: string) =>
  planSearches(watch, today).searches.map((s) => s.request.date);

describe('SearchPlanner', () => {
  it('plans the exact date only at flexibility 0', () => {
    const watch = makeWatch({ preferences: { dateFlexibilityDays: 0 } as never });
    expect(dates(watch, '2026-09-01')).toEqual(['2026-09-20']);
  });

  it('plans D-1, D, D+1 at the default flexibility of 1', () => {
    const watch = makeWatch();
    expect(dates(watch, '2026-09-01')).toEqual(['2026-09-19', '2026-09-20', '2026-09-21']);
  });

  it('plans five dates at flexibility 2', () => {
    const watch = makeWatch({ preferences: { dateFlexibilityDays: 2 } as never });
    expect(dates(watch, '2026-09-01')).toEqual([
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
    ]);
  });

  it('never searches a past date', () => {
    const watch = makeWatch();
    const plan = planSearches(watch, '2026-09-20');
    expect(plan.searches.map((s) => s.request.date)).toEqual(['2026-09-20', '2026-09-21']);
    expect(plan.droppedPastDates).toEqual(['2026-09-19']);
  });

  it('produces no searches once the whole window is in the past', () => {
    const watch = makeWatch();
    const plan = planSearches(watch, '2026-09-22');
    expect(plan.searches).toHaveLength(0);
    expect(plan.droppedPastDates).toHaveLength(3);
    expect(isWindowExhausted(watch, '2026-09-22')).toBe(true);
    expect(isWindowExhausted(watch, '2026-09-21')).toBe(false);
  });

  it('crosses a month boundary', () => {
    const watch = makeWatch({ desiredDate: '2026-09-01' });
    expect(dates(watch, '2026-08-01')).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('crosses a year boundary', () => {
    const watch = makeWatch({ desiredDate: '2027-01-01' });
    expect(dates(watch, '2026-12-01')).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('handles a leap day', () => {
    const watch = makeWatch({ desiredDate: '2028-02-29' });
    expect(dates(watch, '2028-01-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('emits each date exactly once, so a 3x3 fan-out is impossible', () => {
    const plan = planSearches(makeWatch(), '2026-09-01');
    const keys = plan.searches.map((s) => s.canonicalKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('propagates passenger count into every search and its key', () => {
    const plan = planSearches(makeWatch({ passengers: 3 }), '2026-09-01');
    expect(plan.searches.every((s) => s.request.passengers === 3)).toBe(true);
    expect(plan.searches[0]?.canonicalKey).toBe('BOS|NYP|2026-09-19|3');
  });

  it('records displacement per date', () => {
    const plan = planSearches(makeWatch(), '2026-09-01');
    expect(plan.searches.map((s) => s.searchDate.displacementDays)).toEqual([-1, 0, 1]);
  });

  it('rejects invalid inputs loudly', () => {
    expect(() => planSearches(makeWatch({ passengers: 0 }), '2026-09-01')).toThrow(PlannerError);
    expect(() =>
      planSearches(makeWatch({ originCode: 'BOS', destinationCode: 'bos' }), '2026-09-01'),
    ).toThrow(PlannerError);
    expect(() =>
      planSearches(makeWatch({ preferences: { dateFlexibilityDays: 5 } as never }), '2026-09-01'),
    ).toThrow(PlannerError);
  });

  it('builds a stable canonical key', () => {
    expect(
      canonicalKey({
        originCode: 'bos',
        destinationCode: 'nyp',
        date: '2026-09-20',
        passengers: 1,
      }),
    ).toBe('BOS|NYP|2026-09-20|1');
  });
});
