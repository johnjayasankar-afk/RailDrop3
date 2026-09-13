import { describe, expect, it } from 'vitest';

import {
  NO_FILTERS,
  departurePart,
  filterCounts,
  filterOptions,
  isFiltered,
  type FilterableOption,
} from '@/lib/domain/option-filters';

const option = (over: Partial<FilterableOption> = {}): FilterableOption => ({
  travelDate: '2026-09-20',
  departureLocal: '2026-09-20T09:15',
  transfers: 0,
  serviceType: 'TRAIN',
  restricted: false,
  ...over,
});

describe('departure part', () => {
  it('splits the day at noon and 5pm', () => {
    expect(departurePart('2026-09-20T00:00')).toBe('morning');
    expect(departurePart('2026-09-20T11:59')).toBe('morning');
    expect(departurePart('2026-09-20T12:00')).toBe('afternoon');
    expect(departurePart('2026-09-20T16:59')).toBe('afternoon');
    expect(departurePart('2026-09-20T17:00')).toBe('evening');
    expect(departurePart('2026-09-20T23:59')).toBe('evening');
  });

  it('is null for an unreadable time rather than throwing', () => {
    expect(departurePart('not-a-time')).toBeNull();
  });
});

describe('filtering options', () => {
  it('returns everything when nothing is set', () => {
    const options = [option(), option({ transfers: 2 })];
    expect(filterOptions(options, NO_FILTERS)).toHaveLength(2);
    expect(isFiltered(NO_FILTERS)).toBe(false);
  });

  it('excludes connections, buses and restricted fares independently', () => {
    const options = [
      option(),
      option({ transfers: 1 }),
      option({ serviceType: 'THRUWAY_BUS' }),
      option({ restricted: true }),
    ];
    expect(filterOptions(options, { ...NO_FILTERS, directOnly: true })).toHaveLength(3);
    expect(filterOptions(options, { ...NO_FILTERS, railOnly: true })).toHaveLength(3);
    expect(filterOptions(options, { ...NO_FILTERS, noRestricted: true })).toHaveLength(3);
  });

  it('combines filters', () => {
    const options = [
      option(),
      option({ transfers: 1, restricted: true }),
      option({ restricted: true }),
    ];
    expect(
      filterOptions(options, { ...NO_FILTERS, directOnly: true, noRestricted: true }),
    ).toHaveLength(1);
  });

  it('narrows to one part of the day', () => {
    const options = [
      option({ departureLocal: '2026-09-20T07:05' }),
      option({ departureLocal: '2026-09-20T14:20' }),
      option({ departureLocal: '2026-09-20T19:40' }),
    ];
    expect(filterOptions(options, { ...NO_FILTERS, departure: 'morning' })).toHaveLength(1);
    expect(filterOptions(options, { ...NO_FILTERS, departure: 'evening' })).toHaveLength(1);
  });

  it('keeps an option whose departure time cannot be read', () => {
    // Hiding a real, possibly cheapest fare because its timestamp was
    // malformed would be a silent false negative.
    const options = [option({ departureLocal: 'garbage' })];
    expect(filterOptions(options, { ...NO_FILTERS, departure: 'evening' })).toHaveLength(1);
  });

  it('narrows to one travel date', () => {
    const options = [option({ travelDate: '2026-09-19' }), option({ travelDate: '2026-09-20' })];
    expect(filterOptions(options, { ...NO_FILTERS, travelDate: '2026-09-20' })).toHaveLength(1);
  });

  it('can legitimately return nothing', () => {
    expect(filterOptions([option()], { ...NO_FILTERS, railOnly: true, directOnly: true })).toEqual([
      option(),
    ]);
    expect(filterOptions([option({ transfers: 3 })], { ...NO_FILTERS, directOnly: true })).toEqual(
      [],
    );
  });
});

describe('filter counts', () => {
  const options = [
    option({ departureLocal: '2026-09-20T07:05', travelDate: '2026-09-20' }),
    option({ departureLocal: '2026-09-20T14:20', travelDate: '2026-09-20', transfers: 1 }),
    option({ departureLocal: '2026-09-21T19:40', travelDate: '2026-09-21', restricted: true }),
  ];

  it('reports what each control would leave', () => {
    const counts = filterCounts(options, NO_FILTERS);
    expect(counts.directOnly).toBe(2);
    expect(counts.noRestricted).toBe(2);
    expect(counts.departure.morning).toBe(1);
    expect(counts.byDate['2026-09-20']).toBe(2);
    expect(counts.byDate['2026-09-21']).toBe(1);
  });

  it('counts against the other active filters, so a control can disable itself', () => {
    // With "direct only" already on, the restricted evening train is the one
    // that would be left by an evening filter — but it has no transfers, so
    // it survives. Counts must reflect the combination, not each in isolation.
    const counts = filterCounts(options, { ...NO_FILTERS, directOnly: true });
    expect(counts.departure.afternoon).toBe(0);
    expect(counts.departure.evening).toBe(1);
  });

  it('lists dates in ascending order', () => {
    const counts = filterCounts(
      [option({ travelDate: '2026-09-21' }), option({ travelDate: '2026-09-19' })],
      NO_FILTERS,
    );
    expect(Object.keys(counts.byDate)).toEqual(['2026-09-19', '2026-09-21']);
  });
});
