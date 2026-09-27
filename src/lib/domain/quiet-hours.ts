/**
 * Quiet hours. Pure: the caller supplies local wall-clock minutes.
 *
 * A quiet window HOLDS a notification, it never drops one — a fare drop you
 * were not told about is the one failure this product cannot have.
 */

import { localPartsInTimeZone } from './dates';

export interface QuietHours {
  /** Minutes since local midnight, or null when quiet hours are off. */
  startMinutes: number | null;
  endMinutes: number | null;
}

export function hasQuietHours(q: QuietHours): boolean {
  return q.startMinutes !== null && q.endMinutes !== null && q.startMinutes !== q.endMinutes;
}

/**
 * True when `minutesOfDay` falls inside the window.
 * Handles windows that wrap midnight (22:00 → 07:00), which is the common case.
 */
export function isInQuietHours(minutesOfDay: number, q: QuietHours): boolean {
  if (!hasQuietHours(q)) return false;
  const start = q.startMinutes as number;
  const end = q.endMinutes as number;
  return start < end
    ? minutesOfDay >= start && minutesOfDay < end
    : minutesOfDay >= start || minutesOfDay < end;
}

/**
 * When a notification raised at `now` may be delivered.
 * Returns null when it can go immediately.
 */
export function heldUntil(now: Date, timeZone: string, q: QuietHours): Date | null {
  if (!hasQuietHours(q)) return null;
  const local = localPartsInTimeZone(now, timeZone);
  if (!isInQuietHours(local.minutesOfDay, q)) return null;

  const end = q.endMinutes as number;
  const minutesUntilEnd =
    end > local.minutesOfDay ? end - local.minutesOfDay : 1440 - local.minutesOfDay + end;
  return new Date(now.getTime() + minutesUntilEnd * 60_000);
}

/** 'HH:mm' for a minutes-since-midnight value, for form round-tripping. */
export function minutesToClock(minutes: number | null): string {
  if (minutes === null) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function clockToMinutesOrNull(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
