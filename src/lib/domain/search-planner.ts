/**
 * SearchPlanner — turns a watch into the canonical set of external searches.
 *
 * Pure. The single source of truth for "which dates do we search?".
 */

import { addDays, assertCalendarDate, compareDates, type CalendarDate } from './dates';
import type { FareSearchRequest, SearchDate, Watch } from './types';

export interface PlannedSearch {
  request: FareSearchRequest;
  searchDate: SearchDate;
  /** ORIGIN|DEST|YYYY-MM-DD|PAX — the global dedupe key. */
  canonicalKey: string;
}

export interface SearchPlan {
  watchId: string;
  searches: PlannedSearch[];
  /** Dates inside ±flexibility that were dropped because they are in the past. */
  droppedPastDates: CalendarDate[];
}

export function canonicalKey(req: FareSearchRequest): string {
  return `${req.originCode.toUpperCase()}|${req.destinationCode.toUpperCase()}|${req.date}|${req.passengers}`;
}

export class PlannerError extends Error {}

/**
 * Build the searches for one watch.
 *
 * @param today  the current calendar date **in the watch's timezone**. Callers get
 *               this from `todayInTimeZone(now, watch.timezone)` so the planner
 *               itself stays free of clock and timezone I/O.
 */
export function planSearches(watch: Watch, today: CalendarDate): SearchPlan {
  assertCalendarDate(watch.desiredDate);
  assertCalendarDate(today);

  const flex = watch.preferences.dateFlexibilityDays;
  if (![0, 1, 2].includes(flex)) {
    throw new PlannerError(`dateFlexibilityDays must be 0, 1 or 2 — got ${flex}`);
  }
  if (!Number.isInteger(watch.passengers) || watch.passengers < 1) {
    throw new PlannerError(`passengers must be a positive integer — got ${watch.passengers}`);
  }
  if (watch.originCode.toUpperCase() === watch.destinationCode.toUpperCase()) {
    throw new PlannerError('origin and destination must differ');
  }

  const searches: PlannedSearch[] = [];
  const droppedPastDates: CalendarDate[] = [];
  const seen = new Set<string>();

  for (let offset = -flex; offset <= flex; offset += 1) {
    const date = addDays(watch.desiredDate, offset);

    // Never search the past.
    if (compareDates(date, today) < 0) {
      droppedPastDates.push(date);
      continue;
    }

    const request: FareSearchRequest = {
      originCode: watch.originCode.toUpperCase(),
      destinationCode: watch.destinationCode.toUpperCase(),
      date,
      passengers: watch.passengers,
    };
    const key = canonicalKey(request);

    // A watch can never emit the same date twice — this makes a 3x3 fan-out
    // structurally impossible, not merely unlikely.
    if (seen.has(key)) continue;
    seen.add(key);

    searches.push({ request, searchDate: { date, displacementDays: offset }, canonicalKey: key });
  }

  return { watchId: watch.id, searches, droppedPastDates };
}

/** True when the whole travel window has moved into the past. */
export function isWindowExhausted(watch: Watch, today: CalendarDate): boolean {
  const latest = addDays(watch.desiredDate, watch.preferences.dateFlexibilityDays);
  return compareDates(latest, today) < 0;
}
