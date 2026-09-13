import { describe, expect, it } from 'vitest';
import {
  DateError,
  addDays,
  assertCalendarDate,
  daysBetween,
  describeDisplacement,
  formatDurationMinutes,
  localPartsInTimeZone,
  minutesOfDayFromLocalIso,
  parseClockTime,
  todayInTimeZone,
} from '@/lib/domain/dates';

describe('calendar dates', () => {
  it('validates real dates only', () => {
    expect(assertCalendarDate('2026-09-20')).toBe('2026-09-20');
    expect(() => assertCalendarDate('2026-02-30')).toThrow(DateError);
    expect(() => assertCalendarDate('26-09-20')).toThrow(DateError);
    expect(() => assertCalendarDate('2026-13-01')).toThrow(DateError);
  });

  it('crosses month and year boundaries exactly', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('is immune to DST when adding days', () => {
    // US spring forward 2026-03-08 and fall back 2026-11-01.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('computes signed day differences', () => {
    expect(daysBetween('2026-09-19', '2026-09-20')).toBe(1);
    expect(daysBetween('2026-09-21', '2026-09-20')).toBe(-1);
    expect(daysBetween('2026-09-20', '2026-09-20')).toBe(0);
  });

  it('reads local parts in a named timezone', () => {
    const instant = new Date('2026-09-20T12:00:00.000Z');
    expect(localPartsInTimeZone(instant, 'America/New_York').hour).toBe(8);
    expect(localPartsInTimeZone(instant, 'UTC').hour).toBe(12);
    // Non-hour offsets must work.
    const kolkata = localPartsInTimeZone(instant, 'Asia/Kolkata');
    expect(kolkata.hour).toBe(17);
    expect(kolkata.minute).toBe(30);
  });

  it('normalises midnight to hour 0, not 24', () => {
    const midnight = new Date('2026-09-20T04:00:00.000Z'); // 00:00 in New York
    const parts = localPartsInTimeZone(midnight, 'America/New_York');
    expect(parts.hour).toBe(0);
    expect(parts.minutesOfDay).toBe(0);
    expect(parts.date).toBe('2026-09-20');
  });

  it('resolves "today" per timezone at the same instant', () => {
    const instant = new Date('2026-09-20T10:00:00.000Z');
    expect(todayInTimeZone(instant, 'Pacific/Kiritimati')).toBe('2026-09-21');
    expect(todayInTimeZone(instant, 'Pacific/Midway')).toBe('2026-09-19');
  });

  it('parses clock times and local ISO times', () => {
    expect(parseClockTime('07:05')).toBe(425);
    expect(parseClockTime('23:59')).toBe(1439);
    expect(() => parseClockTime('24:00')).toThrow(DateError);
    expect(minutesOfDayFromLocalIso('2026-09-20T07:05')).toBe(425);
  });

  it('describes displacement and durations', () => {
    expect(describeDisplacement(0)).toBe('Same day');
    expect(describeDisplacement(-1)).toBe('1 day earlier');
    expect(describeDisplacement(2)).toBe('2 days later');
    expect(formatDurationMinutes(249)).toBe('4h 9m');
    expect(formatDurationMinutes(120)).toBe('2h');
    expect(formatDurationMinutes(45)).toBe('45m');
  });
});
