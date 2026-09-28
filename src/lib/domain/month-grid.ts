import { addUtcDays, compareIsoDates, parseIsoDate } from "./calendar";

/* The month a date picker draws.
 *
 * All arithmetic is UTC, matching addUtcDays and formatIsoDate in calendar.ts.
 * A picker built on local Date parts drifts on the two days a year the clocks
 * change — the 2nd of November renders twice or not at all, depending on which
 * side of the transition the browser is on — and a fare window that quietly
 * loses a day is a wrong answer that looks like a right one.
 *
 * The grid is always six weeks. A month that fits in five would make the popover
 * change height as you page through it, moving the buttons under the cursor.
 */

export interface DayCell {
  iso: string;
  day: number;
  /** False for the leading and trailing days borrowed from the months either side. */
  inMonth: boolean;
  /** Outside [min, max]. Rendered, but not selectable — a gap would misalign the week. */
  disabled: boolean;
  isToday: boolean;
  isSelected: boolean;
}

export interface MonthGrid {
  /** "2026-10". */
  month: string;
  label: string;
  weeks: DayCell[][];
  canGoPrev: boolean;
  canGoNext: boolean;
  prevMonth: string;
  nextMonth: string;
}

const WEEKS = 6;
const DAYS = 7;

export const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

/** "2026-10-04" → "2026-10". */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Month arithmetic that survives a year boundary and a 31st. */
export function shiftMonth(month: string, delta: number): string {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const index = Number.parseInt(month.slice(5, 7), 10) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(index)) return month;
  const total = year * 12 + index + delta;
  const nextYear = Math.floor(total / 12);
  const nextIndex = total - nextYear * 12;
  return `${String(nextYear).padStart(4, "0")}-${String(nextIndex + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string): number {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const index = Number.parseInt(month.slice(5, 7), 10);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

function firstWeekdayOf(month: string): number {
  const at = parseIsoDate(`${month}-01`);
  return at ? at.getUTCDay() : 0;
}

export function monthLabel(month: string): string {
  const at = parseIsoDate(`${month}-01`);
  if (!at) return month;
  return at.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface GridOptions {
  month: string;
  selected: string | null;
  today: string;
  /** Inclusive. Usually today — a fare cannot be watched in the past. */
  min?: string | null;
  /** Inclusive. Usually the end of the booking horizon. */
  max?: string | null;
}

export function monthGrid(options: GridOptions): MonthGrid {
  const { month, selected, today, min = null, max = null } = options;
  const lead = firstWeekdayOf(month);
  // The Sunday on or before the 1st, so week one is complete.
  const start = addUtcDays(`${month}-01`, -lead);

  const weeks: DayCell[][] = [];
  for (let week = 0; week < WEEKS; week += 1) {
    const row: DayCell[] = [];
    for (let day = 0; day < DAYS; day += 1) {
      const iso = addUtcDays(start, week * DAYS + day);
      row.push({
        iso,
        day: Number.parseInt(iso.slice(8, 10), 10),
        inMonth: iso.slice(0, 7) === month,
        disabled: outsideRange(iso, min, max),
        isToday: iso === today,
        isSelected: selected !== null && iso === selected,
      });
    }
    weeks.push(row);
  }

  /* Paging is blocked only when the whole neighbouring month is out of range,
     not when the edge day is: a min of the 20th must still allow the month
     containing it. */
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return {
    month,
    label: monthLabel(month),
    weeks,
    prevMonth: prev,
    nextMonth: next,
    canGoPrev:
      min === null ||
      compareIsoDates(`${prev}-${String(daysInMonth(prev)).padStart(2, "0")}`, min) >= 0,
    canGoNext: max === null || compareIsoDates(`${next}-01`, max) <= 0,
  };
}

function outsideRange(iso: string, min: string | null, max: string | null): boolean {
  if (min !== null && compareIsoDates(iso, min) < 0) return true;
  if (max !== null && compareIsoDates(iso, max) > 0) return true;
  return false;
}

/**
 * Where an arrow key lands, clamped to the range.
 *
 * Returns null for a key the grid does not handle, so the caller can leave the
 * event alone rather than swallowing every keystroke — a picker that eats Tab
 * is a trap for anyone not using a mouse.
 */
export function moveByKey(
  iso: string,
  key: string,
  options: { min?: string | null; max?: string | null } = {},
): string | null {
  const { min = null, max = null } = options;
  const delta = KEY_DELTAS[key];
  if (delta === undefined) return null;
  const moved = addUtcDays(iso, delta);
  // Refuse to leave the range rather than silently clamping to its edge:
  // clamping makes a held-down arrow key look stuck instead of finished.
  return outsideRange(moved, min, max) ? iso : moved;
}

const KEY_DELTAS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
  PageUp: -28,
  PageDown: 28,
};
