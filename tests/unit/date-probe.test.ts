import { describe, expect, it } from 'vitest';

import {
  PROBE_RADIUS_DAYS,
  PROBE_STALE_HOURS,
  planProbe,
  probeAge,
} from '@/lib/domain/date-probe';

describe('probe planning', () => {
  it('spans a week either side by default', () => {
    const plan = planProbe('2026-09-20', 1, '2026-09-01')!;
    expect(plan.span).toHaveLength(PROBE_RADIUS_DAYS * 2 + 1);
    expect(plan.span[0]).toBe('2026-09-13');
    expect(plan.span[plan.span.length - 1]).toBe('2026-09-27');
  });

  it('never pays again for a date the trip already monitors', () => {
    // Those prices arrive three times a day at no extra cost; buying them to
    // fill in a calendar would be paying twice for the same fact.
    const plan = planProbe('2026-09-20', 1, '2026-09-01')!;
    expect(plan.alreadyMonitored).toEqual(['2026-09-19', '2026-09-20', '2026-09-21']);
    expect(plan.toProbe).toHaveLength(12);
    expect(plan.toProbe).not.toContain('2026-09-20');
  });

  it('scales what it buys with the monitored flexibility', () => {
    expect(planProbe('2026-09-20', 0, '2026-09-01')!.toProbe).toHaveLength(14);
    expect(planProbe('2026-09-20', 2, '2026-09-01')!.toProbe).toHaveLength(10);
  });

  it('never searches a date that has already gone', () => {
    const plan = planProbe('2026-09-20', 1, '2026-09-18')!;
    expect(plan.droppedPastDates).toEqual([
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
    ]);
    for (const date of [...plan.span, ...plan.toProbe]) {
      expect(date >= '2026-09-18').toBe(true);
    }
  });

  it('returns an empty span when the whole radius is in the past', () => {
    const plan = planProbe('2026-09-01', 1, '2026-10-01')!;
    expect(plan.span).toEqual([]);
    expect(plan.toProbe).toEqual([]);
  });

  it('clamps a nonsense radius rather than planning hundreds of searches', () => {
    expect(planProbe('2026-09-20', 1, '2026-09-01', 9999)!.span.length).toBeLessThanOrEqual(61);
    expect(planProbe('2026-09-20', 1, '2026-09-01', -5)!.span).toEqual(['2026-09-20']);
  });

  it('clamps a monitored flexibility outside the schema range', () => {
    // The column allows 0, 1 or 2; anything else is bad data, not permission
    // to treat fifty dates as already paid for.
    expect(planProbe('2026-09-20', 99, '2026-09-01')!.alreadyMonitored).toHaveLength(5);
  });

  it('returns null for an unreadable date rather than throwing into the page', () => {
    expect(planProbe('', 1, '2026-09-01')).toBeNull();
    expect(planProbe('2026-09-20', 1, 'today')).toBeNull();
  });

  it('partitions the span exactly — every date is monitored or probed, never both', () => {
    const plan = planProbe('2026-09-20', 2, '2026-09-01')!;
    expect(plan.alreadyMonitored.length + plan.toProbe.length).toBe(plan.span.length);
    for (const date of plan.toProbe) expect(plan.alreadyMonitored).not.toContain(date);
  });
});

describe('probe age', () => {
  const at = (hoursAgo: number) => new Date(Date.UTC(2026, 8, 20, 12, 0, 0) - hoursAgo * 3_600_000).toISOString();
  const now = new Date(Date.UTC(2026, 8, 20, 12, 0, 0));

  it('words the age plainly rather than to the minute', () => {
    expect(probeAge(at(0.2), now)!.label).toBe('just now');
    expect(probeAge(at(1), now)!.label).toBe('1 hour ago');
    expect(probeAge(at(5), now)!.label).toBe('5 hours ago');
    expect(probeAge(at(30), now)!.label).toBe('1 day ago');
    expect(probeAge(at(72), now)!.label).toBe('3 days ago');
  });

  it('marks a probe stale once monitored dates have overtaken it', () => {
    // Monitored dates are re-priced three times a day; past twelve hours a
    // probe has fallen behind them and should not read as equally current.
    expect(probeAge(at(PROBE_STALE_HOURS - 1), now)!.stale).toBe(false);
    expect(probeAge(at(PROBE_STALE_HOURS), now)!.stale).toBe(true);
    expect(probeAge(at(48), now)!.stale).toBe(true);
  });

  it('never reports a negative age from a clock skew', () => {
    expect(probeAge(at(-5), now)!.hours).toBe(0);
    expect(probeAge(at(-5), now)!.label).toBe('just now');
  });

  it('returns null for an unusable timestamp rather than throwing', () => {
    expect(probeAge('not-a-date')).toBeNull();
    expect(probeAge('')).toBeNull();
  });
});
