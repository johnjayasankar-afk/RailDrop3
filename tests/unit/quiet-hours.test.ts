import { describe, expect, it } from 'vitest';
import {
  clockToMinutesOrNull,
  hasQuietHours,
  heldUntil,
  isInQuietHours,
  minutesToClock,
} from '@/lib/domain/quiet-hours';

const OFF = { startMinutes: null, endMinutes: null };
const NIGHT = { startMinutes: 22 * 60, endMinutes: 7 * 60 }; // 22:00 -> 07:00
const DAY = { startMinutes: 9 * 60, endMinutes: 17 * 60 }; // 09:00 -> 17:00

describe('quiet hours', () => {
  it('is off unless both ends are set and differ', () => {
    expect(hasQuietHours(OFF)).toBe(false);
    expect(hasQuietHours({ startMinutes: 600, endMinutes: null })).toBe(false);
    expect(hasQuietHours({ startMinutes: 600, endMinutes: 600 })).toBe(false);
    expect(hasQuietHours(NIGHT)).toBe(true);
  });

  it('handles a window that wraps midnight', () => {
    expect(isInQuietHours(23 * 60, NIGHT)).toBe(true);
    expect(isInQuietHours(2 * 60, NIGHT)).toBe(true);
    expect(isInQuietHours(6 * 60 + 59, NIGHT)).toBe(true);
    expect(isInQuietHours(7 * 60, NIGHT)).toBe(false); // end is exclusive
    expect(isInQuietHours(12 * 60, NIGHT)).toBe(false);
    expect(isInQuietHours(22 * 60, NIGHT)).toBe(true); // start is inclusive
  });

  it('handles a same-day window', () => {
    expect(isInQuietHours(8 * 60, DAY)).toBe(false);
    expect(isInQuietHours(9 * 60, DAY)).toBe(true);
    expect(isInQuietHours(16 * 60 + 59, DAY)).toBe(true);
    expect(isInQuietHours(17 * 60, DAY)).toBe(false);
  });

  it('never holds when quiet hours are off', () => {
    expect(heldUntil(new Date('2026-09-20T03:00:00Z'), 'America/New_York', OFF)).toBeNull();
  });

  it('releases at the end of the window, not at some fixed delay', () => {
    // 02:30 in New York is inside 22:00 -> 07:00; release at 07:00 local.
    const held = heldUntil(new Date('2026-09-20T06:30:00.000Z'), 'America/New_York', NIGHT);
    expect(held).not.toBeNull();
    expect(held?.toISOString()).toBe('2026-09-20T11:00:00.000Z'); // 07:00 EDT
  });

  it('lets a notification straight through outside the window', () => {
    // 12:00 in New York.
    expect(heldUntil(new Date('2026-09-20T16:00:00.000Z'), 'America/New_York', NIGHT)).toBeNull();
  });

  it('respects the user timezone, not the server one', () => {
    const instant = new Date('2026-09-20T06:30:00.000Z');
    // 02:30 in New York — quiet.
    expect(heldUntil(instant, 'America/New_York', NIGHT)).not.toBeNull();
    // 12:00 in Kolkata at the same instant — not quiet.
    expect(heldUntil(instant, 'Asia/Kolkata', NIGHT)).toBeNull();
  });

  it('round-trips clock values for the settings form', () => {
    expect(minutesToClock(null)).toBe('');
    expect(minutesToClock(0)).toBe('00:00');
    expect(minutesToClock(22 * 60)).toBe('22:00');
    expect(minutesToClock(7 * 60 + 5)).toBe('07:05');

    expect(clockToMinutesOrNull('22:00')).toBe(1320);
    expect(clockToMinutesOrNull('7:05')).toBe(425);
    expect(clockToMinutesOrNull('')).toBeNull();
    expect(clockToMinutesOrNull('25:00')).toBeNull();
    expect(clockToMinutesOrNull('nonsense')).toBeNull();
  });
});
