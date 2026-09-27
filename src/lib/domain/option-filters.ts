import { minutesOfDayFromLocalIso } from './dates';

/**
 * Narrowing a list of fares.
 *
 * A three-day window on a busy corridor routinely returns fifteen to twenty
 * options, and the cheapest is frequently one nobody would take — a 5am
 * departure with two changes. Ranking alone cannot fix that, because "cheapest"
 * and "acceptable" are different questions and only the traveller knows the
 * second one.
 *
 * Pure, so the awkward cases are testable as data: an unparseable departure
 * time, a bus among the trains, a filter that matches nothing.
 */

export type DeparturePart = 'any' | 'morning' | 'afternoon' | 'evening';

export interface OptionFilters {
  /** Exclude anything with a connection. */
  directOnly: boolean;
  /** Exclude Thruway bus segments. */
  railOnly: boolean;
  /** Exclude fares that limit changes and refunds. */
  noRestricted: boolean;
  departure: DeparturePart;
  /** A specific travel date, or null for every date in the window. */
  travelDate: string | null;
}

export const NO_FILTERS: OptionFilters = {
  directOnly: false,
  railOnly: false,
  noRestricted: false,
  departure: 'any',
  travelDate: null,
};

export interface FilterableOption {
  travelDate: string;
  departureLocal: string;
  transfers: number;
  serviceType: string;
  restricted: boolean;
}

export const DEPARTURE_PARTS: Array<{ id: DeparturePart; label: string; hint: string }> = [
  { id: 'any', label: 'Any time', hint: 'All departures' },
  { id: 'morning', label: 'Morning', hint: 'Before noon' },
  { id: 'afternoon', label: 'Afternoon', hint: 'Noon to 5pm' },
  { id: 'evening', label: 'Evening', hint: '5pm onwards' },
];

/** Which part of the day a departure falls in, or null when unreadable. */
export function departurePart(departureLocal: string): Exclude<DeparturePart, 'any'> | null {
  let minutes: number;
  try {
    minutes = minutesOfDayFromLocalIso(departureLocal);
  } catch {
    return null;
  }
  if (minutes < 12 * 60) return 'morning';
  if (minutes < 17 * 60) return 'afternoon';
  return 'evening';
}

export function isFiltered(filters: OptionFilters): boolean {
  return (
    filters.directOnly ||
    filters.railOnly ||
    filters.noRestricted ||
    filters.departure !== 'any' ||
    filters.travelDate !== null
  );
}

export function filterOptions<T extends FilterableOption>(
  options: readonly T[],
  filters: OptionFilters,
): T[] {
  return options.filter((option) => {
    if (filters.directOnly && option.transfers > 0) return false;
    if (filters.railOnly && option.serviceType === 'THRUWAY_BUS') return false;
    if (filters.noRestricted && option.restricted) return false;
    if (filters.travelDate !== null && option.travelDate !== filters.travelDate) return false;

    if (filters.departure !== 'any') {
      const part = departurePart(option.departureLocal);
      // An unreadable departure time is kept rather than dropped. Hiding a
      // real, possibly cheapest fare because its timestamp was malformed
      // would be a silent false negative — exactly what this product refuses
      // to do elsewhere.
      if (part !== null && part !== filters.departure) return false;
    }

    return true;
  });
}

/**
 * How many options each filter would leave, computed against the *other*
 * active filters. This is what lets a control show "Direct 4" and disable
 * itself at zero rather than becoming a dead end the user has to undo.
 */
export function filterCounts<T extends FilterableOption>(
  options: readonly T[],
  filters: OptionFilters,
): {
  directOnly: number;
  railOnly: number;
  noRestricted: number;
  departure: Record<DeparturePart, number>;
  byDate: Record<string, number>;
} {
  const count = (override: Partial<OptionFilters>) =>
    filterOptions(options, { ...filters, ...override }).length;

  const dates = [...new Set(options.map((option) => option.travelDate))].sort();

  return {
    directOnly: count({ directOnly: true }),
    railOnly: count({ railOnly: true }),
    noRestricted: count({ noRestricted: true }),
    departure: {
      any: count({ departure: 'any' }),
      morning: count({ departure: 'morning' }),
      afternoon: count({ departure: 'afternoon' }),
      evening: count({ departure: 'evening' }),
    },
    byDate: Object.fromEntries(dates.map((date) => [date, count({ travelDate: date })])),
  };
}
