import { describe, expect, it } from 'vitest';

import {
  attributeOutcomes,
  describeOutcome,
  type AlertLike,
  type RebookingLike,
} from '@/lib/domain/alert-outcomes';

const alert = (id: string, createdAt: string, watchId = 'w1'): AlertLike => ({
  id,
  watchId,
  createdAt,
});

const rebook = (
  createdAt: string,
  fromCents: number,
  toCents: number,
  watchId = 'w1',
): RebookingLike => ({ watchId, createdAt, fromCents, toCents });

describe('alert outcomes', () => {
  it('reports nothing when no rebooking followed', () => {
    const out = attributeOutcomes([alert('a', '2026-09-01T10:00:00Z')], []);
    expect(out.get('a')).toEqual({ kind: 'NONE' });
  });

  it('attributes a rebooking to the alert that preceded it', () => {
    const out = attributeOutcomes(
      [alert('a', '2026-09-01T10:00:00Z')],
      [rebook('2026-09-01T14:00:00Z', 12800, 7400)],
    );
    expect(out.get('a')).toMatchObject({ kind: 'REBOOKED', dropCents: 5400, hoursAfter: 4 });
  });

  it('credits the latest alert before the rebooking, not the earliest', () => {
    // Crediting the first would misstate which price the user responded to.
    const out = attributeOutcomes(
      [
        alert('first', '2026-09-01T10:00:00Z'),
        alert('second', '2026-09-03T10:00:00Z'),
        alert('third', '2026-09-05T10:00:00Z'),
      ],
      [rebook('2026-09-05T12:00:00Z', 12800, 7400)],
    );
    expect(out.get('first')).toEqual({ kind: 'NONE' });
    expect(out.get('second')).toEqual({ kind: 'NONE' });
    expect(out.get('third')!.kind).toBe('REBOOKED');
  });

  it('ignores a rebooking that happened before any alert', () => {
    const out = attributeOutcomes(
      [alert('a', '2026-09-05T10:00:00Z')],
      [rebook('2026-09-01T10:00:00Z', 12800, 7400)],
    );
    expect(out.get('a')).toEqual({ kind: 'NONE' });
  });

  it('never reports an upward rebooking as an outcome', () => {
    // A dearer flexible fare is a real choice, not a saving.
    const out = attributeOutcomes(
      [alert('a', '2026-09-01T10:00:00Z')],
      [rebook('2026-09-02T10:00:00Z', 7400, 12800)],
    );
    expect(out.get('a')).toEqual({ kind: 'NONE' });
  });

  it('keeps trips separate', () => {
    const out = attributeOutcomes(
      [alert('a', '2026-09-01T10:00:00Z', 'w1'), alert('b', '2026-09-01T10:00:00Z', 'w2')],
      [rebook('2026-09-02T10:00:00Z', 12800, 7400, 'w2')],
    );
    expect(out.get('a')).toEqual({ kind: 'NONE' });
    expect(out.get('b')!.kind).toBe('REBOOKED');
  });

  it('keeps the first rebooking when several follow one alert', () => {
    const out = attributeOutcomes(
      [alert('a', '2026-09-01T10:00:00Z')],
      [rebook('2026-09-04T10:00:00Z', 9000, 8000), rebook('2026-09-02T10:00:00Z', 12800, 9000)],
    );
    expect(out.get('a')).toMatchObject({ kind: 'REBOOKED', dropCents: 3800 });
  });

  it('survives unparseable timestamps without throwing or inventing an outcome', () => {
    const out = attributeOutcomes(
      [alert('a', 'not-a-date')],
      [rebook('also-not-a-date', 12800, 7400)],
    );
    expect(out.get('a')).toEqual({ kind: 'NONE' });
  });

  it('describes sequence, never causation', () => {
    const phrases = [
      describeOutcome({ kind: 'REBOOKED', at: 'x', dropCents: 100, hoursAfter: 0.5 }),
      describeOutcome({ kind: 'REBOOKED', at: 'x', dropCents: 100, hoursAfter: 5 }),
      describeOutcome({ kind: 'REBOOKED', at: 'x', dropCents: 100, hoursAfter: 100 }),
    ]
      .join(' ')
      .toLowerCase();

    expect(phrases).toContain('rebooked');
    for (const causal of ['saved you', 'because', 'thanks to', 'earned you']) {
      expect(phrases, `outcome copy must not claim causation: "${causal}"`).not.toContain(causal);
    }
    expect(describeOutcome({ kind: 'NONE' })).toBeNull();
  });

  it('phrases the delay at a sensible scale', () => {
    expect(describeOutcome({ kind: 'REBOOKED', at: 'x', dropCents: 1, hoursAfter: 0.2 })).toBe(
      'Rebooked within the hour',
    );
    expect(describeOutcome({ kind: 'REBOOKED', at: 'x', dropCents: 1, hoursAfter: 6 })).toBe(
      'Rebooked 6 hours later',
    );
    expect(describeOutcome({ kind: 'REBOOKED', at: 'x', dropCents: 1, hoursAfter: 72 })).toBe(
      'Rebooked 3 days later',
    );
  });
});
