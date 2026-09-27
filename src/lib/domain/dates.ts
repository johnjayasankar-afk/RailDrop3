/**
 * Calendar + timezone helpers.
 *
 * A `CalendarDate` is a plain 'YYYY-MM-DD' string with no timezone attached.
 * All date arithmetic anchors at UTC noon so a DST transition can never shift a
 * calendar day, and month/year/leap-day rollovers are exact.
 */

export type CalendarDate = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class DateError extends Error {}

export function assertCalendarDate(value: string): CalendarDate {
  if (!DATE_RE.test(value)) throw new DateError(`Not a YYYY-MM-DD date: ${JSON.stringify(value)}`);
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new DateError(`Not a real calendar date: ${value}`);
  }
  return value;
}

function toUtcNoon(date: CalendarDate): Date {
  assertCalendarDate(date);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fromUtcNoon(dt: Date): CalendarDate {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const dt = toUtcNoon(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUtcNoon(dt);
}

/** Signed whole-day difference: daysBetween('2026-09-19','2026-09-20') === 1 */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const ms = toUtcNoon(to).getTime() - toUtcNoon(from).getTime();
  return Math.round(ms / 86_400_000);
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  assertCalendarDate(a);
  assertCalendarDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface LocalParts {
  date: CalendarDate;
  hour: number;
  minute: number;
  /** Minutes since local midnight. */
  minutesOfDay: number;
}

/**
 * Wall-clock parts of `instant` as observed in `timeZone`.
 * Uses Intl so DST and non-hour offsets (+05:30, +12:45) are exact.
 */
export function localPartsInTimeZone(instant: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const p = parts.find((x) => x.type === type);
    if (!p) throw new DateError(`Missing ${type} for timezone ${timeZone}`);
    return p.value;
  };
  // en-CA hour12:false can render midnight as "24"; normalise to 0.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

export function todayInTimeZone(instant: Date, timeZone: string): CalendarDate {
  return localPartsInTimeZone(instant, timeZone).date;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 'HH:mm' → minutes since midnight. */
export function parseClockTime(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new DateError(`Not a HH:mm time: ${JSON.stringify(value)}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) throw new DateError(`Not a valid time: ${value}`);
  return hh * 60 + mm;
}

/** Local ISO 'YYYY-MM-DDTHH:mm[:ss]' → minutes since local midnight. */
export function minutesOfDayFromLocalIso(iso: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) throw new DateError(`Cannot read time from ${JSON.stringify(iso)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function calendarDateFromLocalIso(iso: string): CalendarDate {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  if (!m || !m[1]) throw new DateError(`Cannot read date from ${JSON.stringify(iso)}`);
  return assertCalendarDate(m[1]);
}

/** Human display: '7:05 AM' */
export function formatClock(minutesOfDay: number): string {
  const h24 = Math.floor(minutesOfDay / 60) % 24;
  const mm = String(minutesOfDay % 60).padStart(2, '0');
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

/** Human display: 'Sep 19' */
export function formatShortDate(date: CalendarDate): string {
  assertCalendarDate(date);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcNoon(date));
}

/** Human display: 'Sat, Sep 19' */
export function formatMediumDate(date: CalendarDate): string {
  assertCalendarDate(date);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcNoon(date));
}

/** 'same day' | '1 day earlier' | '2 days later' */
export function describeDisplacement(displacementDays: number): string {
  if (displacementDays === 0) return 'Same day';
  const n = Math.abs(displacementDays);
  const unit = n === 1 ? 'day' : 'days';
  return displacementDays < 0 ? `${n} ${unit} earlier` : `${n} ${unit} later`;
}

export function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
