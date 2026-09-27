import { addDays, assertCalendarDate, compareDates, type CalendarDate } from './dates';

/**
 * Looking outside the monitoring window, once, on purpose.
 *
 * The monitoring window is capped at ±2 days deliberately: it runs three times
 * a day for the life of a trip, so every extra date is a recurring cost. But
 * "what if I shifted a few days?" is a real question the product could not
 * answer at all, and quietly widening the window would multiply the standing
 * spend without anybody choosing it.
 *
 * A probe is the honest shape: one scan, of dates the trip is **not** already
 * monitoring, with the exact cost stated before it runs.
 */

/** How far either side of the travel date a probe reaches. */
export const PROBE_RADIUS_DAYS = 7;

export interface ProbePlan {
  /** Every date the calendar will cover, ascending — monitored and probed. */
  span: CalendarDate[];
  /** Dates a probe would actually search, and therefore pay for. */
  toProbe: CalendarDate[];
  /** Dates already covered by ongoing monitoring, so free. */
  alreadyMonitored: CalendarDate[];
  /** Dates inside the radius that have already gone. */
  droppedPastDates: CalendarDate[];
}

/**
 * Which dates a probe would search.
 *
 * Dates the trip already monitors are excluded: their prices arrive three times
 * a day at no extra cost, and buying them again to fill in a calendar would be
 * paying twice for the same fact. Past dates are excluded because they cannot
 * be booked.
 */
export function planProbe(
  desiredDate: string,
  monitoredFlexibilityDays: number,
  today: string,
  radiusDays: number = PROBE_RADIUS_DAYS,
): ProbePlan | null {
  let desired: CalendarDate;
  let now: CalendarDate;
  try {
    desired = assertCalendarDate(desiredDate);
    now = assertCalendarDate(today);
  } catch {
    return null;
  }

  const radius = Math.max(0, Math.min(30, Math.round(radiusDays)));
  const monitored = Math.max(0, Math.min(2, Math.round(monitoredFlexibilityDays)));

  const span: CalendarDate[] = [];
  const toProbe: CalendarDate[] = [];
  const alreadyMonitored: CalendarDate[] = [];
  const droppedPastDates: CalendarDate[] = [];

  for (let offset = -radius; offset <= radius; offset += 1) {
    const date = addDays(desired, offset);

    if (compareDates(date, now) < 0) {
      droppedPastDates.push(date);
      continue;
    }

    span.push(date);
    if (Math.abs(offset) <= monitored) alreadyMonitored.push(date);
    else toProbe.push(date);
  }

  return { span, toProbe, alreadyMonitored, droppedPastDates };
}

/**
 * Past this, a probed price is old enough that presenting it with the same
 * weight as a fresh one would overstate what RailDrop knows. Monitored dates
 * are re-priced three times a day; twelve hours is the point at which a probe
 * has fallen behind them.
 */
export const PROBE_STALE_HOURS = 12;

export interface ProbeAge {
  hours: number;
  stale: boolean;
  /** Plain wording, never a precise time nobody needs. */
  label: string;
}

/** How long ago a probe ran. Null when the timestamp is unusable. */
export function probeAge(probedAt: string, now: Date = new Date()): ProbeAge | null {
  const at = Date.parse(probedAt);
  if (Number.isNaN(at)) return null;

  const hours = Math.max(0, (now.getTime() - at) / 3_600_000);
  const stale = hours >= PROBE_STALE_HOURS;

  let label: string;
  if (hours < 1) label = 'just now';
  else if (hours < 24) label = `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'} ago`;
  else {
    const days = Math.round(hours / 24);
    label = `${days} day${days === 1 ? '' : 's'} ago`;
  }

  return { hours, stale, label };
}
