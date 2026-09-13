/**
 * Scheduling domain logic: local slots, DST-safe due-slot selection, monitoring
 * windows. Pure — the dispatcher supplies `now` and the set of already-recorded
 * slots, and gets back a decision.
 */

import { localPartsInTimeZone, type CalendarDate } from './dates';
import { SCHEDULED_SLOTS, type ScheduledSlot, type Watch } from './types';

/** Logical local wall-clock slots, in minutes since local midnight. */
export const SLOT_LOCAL_MINUTES: Record<ScheduledSlot, number> = {
  MORNING: 8 * 60, // 08:00
  AFTERNOON: 14 * 60, // 14:00
  EVENING: 20 * 60, // 20:00
};

export type SkipReason = 'MISSED_WINDOW';

export interface DispatchDecision {
  localDate: CalendarDate;
  /** The single slot to run now, or null when nothing is due/unclaimed. */
  claim: ScheduledSlot | null;
  /** Earlier due slots that were never recorded — logged as SKIPPED, not run. */
  skip: Array<{ slot: ScheduledSlot; reason: SkipReason }>;
}

/** Slots whose local time has already passed today. */
export function dueSlots(minutesOfDay: number): ScheduledSlot[] {
  return SCHEDULED_SLOTS.filter((slot) => SLOT_LOCAL_MINUTES[slot] <= minutesOfDay);
}

/**
 * Decide what this heartbeat should do for one watch.
 *
 * Only the most recent due slot is executed. Older un-recorded slots are marked
 * SKIPPED so an outage does not cause a burst of three cycles (nine provider
 * calls) the moment the service recovers.
 */
export function decideDispatch(
  now: Date,
  timezone: string,
  recordedSlotsToday: ReadonlySet<ScheduledSlot>,
): DispatchDecision {
  const local = localPartsInTimeZone(now, timezone);
  const due = dueSlots(local.minutesOfDay);

  if (due.length === 0) {
    return { localDate: local.date, claim: null, skip: [] };
  }

  const latest = due[due.length - 1] as ScheduledSlot;
  const older = due.slice(0, -1).filter((s) => !recordedSlotsToday.has(s));

  return {
    localDate: local.date,
    claim: recordedSlotsToday.has(latest) ? null : latest,
    skip: older.map((slot) => ({ slot, reason: 'MISSED_WINDOW' as const })),
  };
}

/**
 * Convert a local wall-clock moment in `timeZone` to an absolute instant.
 * Converges in at most a few iterations and is correct across DST boundaries and
 * non-hour offsets (+05:30, +12:45).
 */
export function zonedTimeToInstant(
  date: CalendarDate,
  minutesOfDay: number,
  timeZone: string,
): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const targetLocalMs = Date.UTC(y, m - 1, d, Math.floor(minutesOfDay / 60), minutesOfDay % 60);
  let guess = targetLocalMs;

  for (let i = 0; i < 4; i += 1) {
    const parts = localPartsInTimeZone(new Date(guess), timeZone);
    const [py, pm, pd] = parts.date.split('-').map(Number) as [number, number, number];
    const actualLocalMs = Date.UTC(py, pm - 1, pd, parts.hour, parts.minute);
    const diff = targetLocalMs - actualLocalMs;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

export function isMonitoringOpen(watch: Watch, now: Date): boolean {
  if (watch.status !== 'ACTIVE') return false;
  const start = new Date(watch.monitoringStartsAt).getTime();
  const end = new Date(watch.monitoringEndsAt).getTime();
  const t = now.getTime();
  return t >= start && t < end;
}

/**
 * The next scheduled check instant, for "Next check: 8:00 PM" in the UI.
 * Returns null when monitoring ends before the next slot.
 */
export function nextScheduledCheckAt(watch: Watch, now: Date): Date | null {
  const end = new Date(watch.monitoringEndsAt);
  if (watch.status !== 'ACTIVE' || now >= end) return null;

  const local = localPartsInTimeZone(now, watch.timezone);
  const candidates: Date[] = [];

  for (const slot of SCHEDULED_SLOTS) {
    if (SLOT_LOCAL_MINUTES[slot] > local.minutesOfDay) {
      candidates.push(zonedTimeToInstant(local.date, SLOT_LOCAL_MINUTES[slot], watch.timezone));
    }
  }
  if (candidates.length === 0) {
    // Tomorrow's first slot.
    const [y, m, d] = local.date.split('-').map(Number) as [number, number, number];
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1, 12));
    const tomorrowDate = tomorrow.toISOString().slice(0, 10);
    candidates.push(zonedTimeToInstant(tomorrowDate, SLOT_LOCAL_MINUTES.MORNING, watch.timezone));
  }

  const next = candidates.sort((a, b) => a.getTime() - b.getTime())[0];
  if (!next || next >= end) return null;
  return next;
}

export function slotDisplayName(slot: ScheduledSlot): string {
  return { MORNING: '8:00 AM', AFTERNOON: '2:00 PM', EVENING: '8:00 PM' }[slot];
}
