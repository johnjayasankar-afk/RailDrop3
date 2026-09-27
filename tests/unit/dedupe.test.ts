import { describe, expect, it } from 'vitest';
import { displacementFor, planBatch, requestFromKey } from '@/lib/domain/dedupe';
import { planSearches } from '@/lib/domain/search-planner';
import { makeWatch } from '../helpers/factories';

const TODAY = '2026-09-01';

describe('global search deduplication', () => {
  it('collapses two overlapping windows to four calls, not six', () => {
    const a = planSearches(makeWatch({ id: 'a', desiredDate: '2026-09-20' }), TODAY);
    const b = planSearches(makeWatch({ id: 'b', desiredDate: '2026-09-21' }), TODAY);

    const batch = planBatch([a, b]);

    expect(batch.requestedCount).toBe(6);
    expect(batch.uniqueSearches).toHaveLength(4);
    expect(batch.savedCalls).toBe(2);
    expect(batch.uniqueSearches.map((s) => s.request.date)).toEqual([
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
    ]);
  });

  it('collapses identical watches completely', () => {
    const a = planSearches(makeWatch({ id: 'a' }), TODAY);
    const b = planSearches(makeWatch({ id: 'b' }), TODAY);
    const batch = planBatch([a, b]);
    expect(batch.uniqueSearches).toHaveLength(3);
    expect(batch.savedCalls).toBe(3);
  });

  it('does NOT collapse different passenger counts', () => {
    const a = planSearches(makeWatch({ id: 'a', passengers: 1 }), TODAY);
    const b = planSearches(makeWatch({ id: 'b', passengers: 2 }), TODAY);
    expect(planBatch([a, b]).uniqueSearches).toHaveLength(6);
  });

  it('does NOT collapse different routes', () => {
    const a = planSearches(makeWatch({ id: 'a' }), TODAY);
    const b = planSearches(makeWatch({ id: 'b', originCode: 'PHL' }), TODAY);
    expect(planBatch([a, b]).uniqueSearches).toHaveLength(6);
  });

  it('maps every watch back to the keys it needs', () => {
    const a = planSearches(makeWatch({ id: 'a', desiredDate: '2026-09-20' }), TODAY);
    const b = planSearches(makeWatch({ id: 'b', desiredDate: '2026-09-21' }), TODAY);
    const batch = planBatch([a, b]);

    expect(batch.assignments.get('a')).toEqual([
      'BOS|NYP|2026-09-19|1',
      'BOS|NYP|2026-09-20|1',
      'BOS|NYP|2026-09-21|1',
    ]);
    expect(batch.assignments.get('b')).toEqual([
      'BOS|NYP|2026-09-20|1',
      'BOS|NYP|2026-09-21|1',
      'BOS|NYP|2026-09-22|1',
    ]);
  });

  it('resolves displacement per watch, since a shared date means different things', () => {
    const a = planSearches(makeWatch({ id: 'a', desiredDate: '2026-09-20' }), TODAY);
    const b = planSearches(makeWatch({ id: 'b', desiredDate: '2026-09-21' }), TODAY);
    const shared = 'BOS|NYP|2026-09-20|1';
    expect(displacementFor(a, shared)).toBe(0); // watch A's exact date
    expect(displacementFor(b, shared)).toBe(-1); // watch B's day before
  });

  it('round-trips a canonical key', () => {
    expect(requestFromKey('BOS|NYP|2026-09-20|2')).toEqual({
      originCode: 'BOS',
      destinationCode: 'NYP',
      date: '2026-09-20',
      passengers: 2,
    });
    expect(() => requestFromKey('nonsense')).toThrow();
  });

  it('handles an empty batch', () => {
    const batch = planBatch([]);
    expect(batch.uniqueSearches).toHaveLength(0);
    expect(batch.savedCalls).toBe(0);
  });
});
