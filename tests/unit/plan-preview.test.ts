import { describe, expect, it } from 'vitest';

import { describeDuration, planPreview, type PlanInput } from '@/lib/domain/plan-preview';

const base: PlanInput = {
  desiredDate: '2026-09-20',
  dateFlexibilityDays: 1,
  monitoringHours: 48,
  today: '2026-09-10',
  benchmarkCents: 12800,
  minimumSavingsCents: 500,
  passengers: 1,
};

describe('plan preview', () => {
  it('spans the desired date plus the flexibility either side', () => {
    expect(planPreview(base)!.dates).toEqual(['2026-09-19', '2026-09-20', '2026-09-21']);
    expect(planPreview({ ...base, dateFlexibilityDays: 0 })!.dates).toEqual(['2026-09-20']);
    expect(planPreview({ ...base, dateFlexibilityDays: 2 })!.dates).toHaveLength(5);
  });

  it('drops dates that have already gone, and says which', () => {
    // A past date cannot be booked, so searching it spends a credit on nothing.
    const preview = planPreview({ ...base, desiredDate: '2026-09-10', today: '2026-09-10' })!;
    expect(preview.dates).toEqual(['2026-09-10', '2026-09-11']);
    expect(preview.droppedPastDates).toEqual(['2026-09-09']);
  });

  it('counts searches as dates times checks times legs', () => {
    const oneWay = planPreview(base)!;
    expect(oneWay.checksPerDay).toBe(3);
    expect(oneWay.searchesPerDay).toBe(9);
    expect(oneWay.legs).toBe(1);

    const roundTrip = planPreview({ ...base, returnDate: '2026-09-24' })!;
    expect(roundTrip.legs).toBe(2);
    expect(roundTrip.searchesPerDay).toBe(18);
  });

  it('totals searches across the window', () => {
    expect(planPreview(base)!.searchesTotal).toBe(18); // 2 days x 9
    expect(planPreview({ ...base, monitoringHours: 24 })!.searchesTotal).toBe(9);
  });

  it('caps the window at the journey, because there is nothing to find after it', () => {
    const preview = planPreview({ ...base, today: '2026-09-19', monitoringHours: 240 })!;
    expect(preview.cappedByDeparture).toBe(true);
    // Only up to the last date in the window (Sep 21).
    expect(preview.monitoringDays).toBeLessThanOrEqual(3);
  });

  it('does not claim a cap when the window fits', () => {
    expect(planPreview(base)!.cappedByDeparture).toBe(false);
  });

  it('reports the real check times, in chronological order', () => {
    // Formatted clock strings do not sort lexically — "2:00 PM" < "8:00 AM" —
    // so ordering is asserted on the minutes they represent.
    const times = planPreview(base)!.checkTimes;
    expect(times).toEqual(['8:00 AM', '2:00 PM', '8:00 PM']);

    const minutes = times.map((label) => {
      const [, h, m, meridiem] = /^(\d+):(\d+)\s?(AM|PM)$/.exec(label)!;
      const hour = (Number(h) % 12) + (meridiem === 'PM' ? 12 : 0);
      return hour * 60 + Number(m);
    });
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
  });

  it('clamps a nonsense flexibility instead of generating a huge span', () => {
    expect(planPreview({ ...base, dateFlexibilityDays: 99 })!.dates).toHaveLength(5);
    expect(planPreview({ ...base, dateFlexibilityDays: -4 })!.dates).toHaveLength(1);
  });

  it('returns null for an unreadable date rather than throwing into the form', () => {
    expect(planPreview({ ...base, desiredDate: '' })).toBeNull();
    expect(planPreview({ ...base, desiredDate: 'tomorrow' })).toBeNull();
  });

  it('handles a window that has already fully closed', () => {
    const preview = planPreview({ ...base, desiredDate: '2026-09-01', today: '2026-09-10' })!;
    expect(preview.dates).toEqual([]);
    expect(preview.searchesPerDay).toBe(0);
    expect(preview.searchesTotal).toBe(0);
  });
});

describe('duration wording', () => {
  it('stays in hours below two days and switches to days above', () => {
    expect(describeDuration(24)).toBe('24 hours');
    expect(describeDuration(47)).toBe('47 hours');
    expect(describeDuration(48)).toBe('2 days');
    expect(describeDuration(168)).toBe('7 days');
  });

  it('does not print a misleading whole number for a part day', () => {
    expect(describeDuration(60)).toBe('2.5 days');
  });
});
