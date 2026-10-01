"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { monthGrid, monthOf, moveByKey, WEEKDAY_LABELS } from "@/lib/domain/month-grid";
import { addUtcDays, compareIsoDates, formatDisplayDateLong } from "@/lib/domain/calendar";

/* Picking the travel date.
 *
 * It replaces <input type="date">, whose calendar is the browser's: a different
 * shape in every one of them, light-only in several regardless of the page's
 * theme, and — the reason it had to go — unable to show the one thing that
 * matters when choosing a date here. A search covers a window, not a day, so
 * the flexibility setting is drawn on the calendar: pick the 9th with ±1 and
 * the 8th and 10th light up as the days that will actually be searched.
 *
 * The text input stays. Typing a date is faster than paging to it, and a
 * calendar that can only be clicked is slower than the thing it replaced.
 */

const WINDOW_MAX_DAYS = 330; // Amtrak sells about eleven months ahead.

export function DateField({
  value,
  onChange,
  today,
  flexibilityDays = 0,
  label = "Desired travel date",
}: {
  value: string;
  onChange: (iso: string) => void;
  today: string;
  /** Days either side that the watch will also search. Drawn as the window. */
  flexibilityDays?: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthOf(value || today));
  /** The day the arrow keys are on. Separate from the selection until Enter. */
  const [cursor, setCursor] = useState(value || today);
  /* The text mid-edit, or null when the field should just show `value`.
   *
   * Holding the text in its own state and syncing it to `value` from an effect
   * is the obvious shape and the wrong one — it sets state during an effect,
   * which cascades a second render on every keystroke and is what
   * react-hooks/set-state-in-effect is pointing at. A null draft means "no edit
   * in progress, show the value", so there is nothing to keep in step. */
  const [draft, setDraft] = useState<string | null>(null);
  const typed = draft ?? value;
  const root = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const max = useMemo(() => addUtcDays(today, WINDOW_MAX_DAYS), [today]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Focus follows the cursor so a screen reader announces the day it lands on.
  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLButtonElement>('[data-cursor="true"]')?.focus();
  }, [open, cursor]);

  const grid = useMemo(
    () => monthGrid({ month, selected: value || null, today, min: today, max }),
    [month, value, today, max],
  );

  const inWindow = useCallback(
    (iso: string) => {
      if (!value || flexibilityDays <= 0) return false;
      if (iso === value) return false;
      const lower = addUtcDays(value, -flexibilityDays);
      const upper = addUtcDays(value, flexibilityDays);
      return compareIsoDates(iso, lower) >= 0 && compareIsoDates(iso, upper) <= 0;
    },
    [value, flexibilityDays],
  );

  const pick = useCallback(
    (iso: string) => {
      onChange(iso);
      setDraft(null);
      setOpen(false);
    },
    [onChange],
  );

  /* Opening is an event, so the calendar is put back in step here rather than
     from an effect watching `value`. */
  const openCalendar = useCallback(() => {
    const anchor = value || today;
    setCursor(anchor);
    setMonth(monthOf(anchor));
    setOpen(true);
  }, [value, today]);

  function onGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(cursor);
      return;
    }
    const moved = moveByKey(cursor, event.key, { min: today, max });
    // null means a key this grid does not own — Tab has to keep working.
    if (moved === null) return;
    event.preventDefault();
    setCursor(moved);
    if (monthOf(moved) !== month) setMonth(monthOf(moved));
  }

  return (
    <div className="datefield" ref={root}>
      <label className="datefield-label" htmlFor={`${id}-input`}>
        {label}
      </label>
      <div className="datefield-control">
        <input
          id={`${id}-input`}
          className="field datefield-input"
          value={typed}
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          onChange={(event) => {
            setDraft(event.target.value);
            // Only commit a complete, in-range date; partial typing is not a choice.
            if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) onChange(event.target.value);
          }}
          onFocus={openCalendar}
          autoComplete="off"
        />
        <button
          type="button"
          className="datefield-toggle"
          aria-expanded={open}
          aria-controls={`${id}-cal`}
          aria-label={open ? "Close the calendar" : "Open the calendar"}
          onClick={() => (open ? setOpen(false) : openCalendar())}
        >
          <CalendarGlyph />
        </button>
      </div>

      {value ? (
        <p className="datefield-read">
          {formatDisplayDateLong(value)}
          {flexibilityDays > 0
            ? ` · searching ±${flexibilityDays} day${flexibilityDays === 1 ? "" : "s"}`
            : ""}
        </p>
      ) : null}

      {open ? (
        <div className="datefield-pop" id={`${id}-cal`} role="dialog" aria-label="Choose a date">
          <div className="datefield-nav">
            <button
              type="button"
              className="datefield-page"
              onClick={() => setMonth(grid.prevMonth)}
              disabled={!grid.canGoPrev}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="datefield-month" aria-live="polite">
              {grid.label}
            </span>
            <button
              type="button"
              className="datefield-page"
              onClick={() => setMonth(grid.nextMonth)}
              disabled={!grid.canGoNext}
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="datefield-grid" role="grid" ref={gridRef} onKeyDown={onGridKeyDown}>
            <div className="datefield-week datefield-head" role="row">
              {WEEKDAY_LABELS.map((day) => (
                <span key={day} role="columnheader" className="datefield-dow" aria-hidden>
                  {day}
                </span>
              ))}
            </div>
            {grid.weeks.map((week) => (
              <div className="datefield-week" role="row" key={week[0]!.iso}>
                {week.map((cell) => {
                  const isCursor = cell.iso === cursor;
                  return (
                    <span role="gridcell" key={cell.iso} aria-selected={cell.isSelected}>
                      <button
                        type="button"
                        data-cursor={isCursor}
                        // Roving tabindex: one stop for the whole grid.
                        tabIndex={isCursor ? 0 : -1}
                        className={
                          "datefield-day" +
                          (cell.inMonth ? "" : " is-outside") +
                          (cell.isSelected ? " is-selected" : "") +
                          (cell.isToday ? " is-today" : "") +
                          (inWindow(cell.iso) ? " is-window" : "")
                        }
                        disabled={cell.disabled}
                        aria-label={formatDisplayDateLong(cell.iso)}
                        onClick={() => pick(cell.iso)}
                        onFocus={() => setCursor(cell.iso)}
                      >
                        {cell.day}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>

          <p className="datefield-hint">
            {flexibilityDays > 0
              ? `Shaded days are also searched, at ±${flexibilityDays}.`
              : "Arrow keys move, Enter chooses."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden focusable="false">
      <rect
        x="1.5"
        y="3"
        width="13"
        height="11.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
