import { describe, expect, it } from 'vitest';

import { groupTrips, legsOf, type Leggable } from '@/lib/domain/trip-grouping';

const leg = (id: string, linkedWatchId: string | null = null): Leggable => ({ id, linkedWatchId });

describe('trip grouping', () => {
  it('leaves unlinked trips alone', () => {
    const groups = groupTrips([leg('a'), leg('b')]);
    expect(groups.map((g) => g.kind)).toEqual(['single', 'single']);
  });

  it('collapses a reciprocated pair into one group', () => {
    const groups = groupTrips([leg('a', 'b'), leg('b', 'a')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('pair');
    expect(legsOf(groups[0]!).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('places the pair where its first leg was, so the caller sort still decides order', () => {
    const groups = groupTrips([leg('x'), leg('a', 'b'), leg('y'), leg('b', 'a')]);
    expect(groups.map((g) => (g.kind === 'pair' ? 'pair' : g.leg.id))).toEqual(['x', 'pair', 'y']);
  });

  it('does not pair a one-sided link — the two rows disagree about being a journey', () => {
    const groups = groupTrips([leg('a', 'b'), leg('b', null)]);
    expect(groups.map((g) => g.kind)).toEqual(['single', 'single']);
  });

  it('does not pair rows that point at different partners', () => {
    const groups = groupTrips([leg('a', 'b'), leg('b', 'c')]);
    expect(groups.map((g) => g.kind)).toEqual(['single', 'single']);
  });

  it('keeps a leg whose partner is missing from the list', () => {
    // Filtered out, soft-deleted, or never created. A trip disappearing from
    // the dashboard is far worse than one shown without its return.
    const groups = groupTrips([leg('a', 'gone')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('single');
  });

  it('refuses to pair a row with itself', () => {
    const groups = groupTrips([leg('a', 'a')]);
    expect(groups.map((g) => g.kind)).toEqual(['single']);
  });

  it('never loses or duplicates a leg', () => {
    const input = [leg('a', 'b'), leg('b', 'a'), leg('c'), leg('d', 'missing'), leg('e', 'f')];
    const out = groupTrips(input).flatMap(legsOf);
    expect(out.map((l) => l.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(new Set(out.map((l) => l.id)).size).toBe(out.length);
  });

  it('handles an empty list', () => {
    expect(groupTrips([])).toEqual([]);
  });
});
