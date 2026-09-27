import { addDays, assertCalendarDate, compareDates, formatClock, type CalendarDate } from './dates';
import { SLOT_LOCAL_MINUTES } from './schedule';

/**
 * What RailDrop will actually do with a trip, before it is created.
 *
 * The form already carried every one of these facts, scattered across five
 * separate hint lines — how many dates, how many searches per check, when the
 * checks run, how long the window lasts, what counts as material. Read that
 * way none of them added up to the one thing a person is deciding: *what am I
 * committing to here*.
 *
 * Pure, because the interesting parts are arithmetic on dates and the awkward
 * cases are all data — a past date, a window that outlives the journey, a
 * flexibility that reaches back before today.
 */

export interface PlanInput {
  desiredDate: string;
  dateFlexibilityDays: number;
  monitoringHours: number;
  /** Today, in the trip's timezone. Dates before it are never searched. */
  today: string;
  benchmarkCents: number | null;
  minimumSavingsCents: number;
  passengers: number;
  returnDate?: string | null;
}

export interface PlanPreview {
  /** Dates that will actually be searched, ascending. */
  dates: CalendarDate[];
  /** Dates the flexibility implies that are already in the past. */
  droppedPastDates: CalendarDate[];
  checksPerDay: number;
  /** Clock times the checks run at, in the trip's own timezone. */
  checkTimes: string[];
  /** Provider searches for one full day of monitoring, both legs included. */
  searchesPerDay: number;
  /** Searches for the whole window, rounded up to whole days of checking. */
  searchesTotal: number;
  monitoringDays: number;
  /** True when the window is cut short because the journey happens first. */
  cappedByDeparture: boolean;
  legs: 1 | 2;
}

const CHECK_TIMES = Object.values(SLOT_LOCAL_MINUTES).sort((a, b) => a - b);

export function planPreview(input: PlanInput): PlanPreview | null {
  let desired: CalendarDate;
  let today: CalendarDate;
  try {
    desired = assertCalendarDate(input.desiredDate);
    today = assertCalendarDate(input.today);
  } catch {
    return null;
  }

  const flexibility = Math.max(0, Math.min(2, Math.round(input.dateFlexibilityDays)));
  const span: CalendarDate[] = [];
  for (let offset = -flexibility; offset <= flexibility; offset += 1) {
    span.push(addDays(desired, offset));
  }

  // A date already gone is never searched — it cannot be booked, and charging
  // a provider credit for it would be spending money on nothing.
  const dates = span.filter((date) => compareDates(date, today) >= 0);
  const droppedPastDates = span.filter((date) => compareDates(date, today) < 0);

  const legs: 1 | 2 = input.returnDate ? 2 : 1;
  const checksPerDay = CHECK_TIMES.length;
  const searchesPerDay = dates.length * checksPerDay * legs;

  // The window never outlives the journey: once the last date has gone there
  // is nothing left to find.
  const lastTravelDate = span[span.length - 1] as CalendarDate;
  const daysUntilDeparture = Math.max(
    0,
    Math.round(
      (Date.parse(`${lastTravelDate}T23:59:59Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    ),
  );
  const requestedDays = input.monitoringHours / 24;
  const cappedByDeparture = requestedDays > daysUntilDeparture;
  const monitoringDays = Math.max(0, Math.min(requestedDays, daysUntilDeparture));

  return {
    dates,
    droppedPastDates,
    checksPerDay,
    checkTimes: CHECK_TIMES.map((minutes) => formatClock(minutes)),
    searchesPerDay,
    searchesTotal: Math.ceil(monitoringDays * searchesPerDay),
    monitoringDays,
    cappedByDeparture,
    legs,
  };
}

/** "48 hours", "6 days" — whichever reads better at that length. */
export function describeDuration(hours: number): string {
  if (hours < 48) return `${Math.round(hours)} hours`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
}
