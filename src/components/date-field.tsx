"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { monthGrid, monthOf, moveByKey, WEEKDAY_LABELS } from "@/lib/domain/month-grid";
import {
  addUtcDays,
  compareIsoDates,
  formatDisplayDate,
  formatDisplayDateLong,
} from "@/lib/domain/calendar";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const max = useMemo(() => addUtcDays(today, WINDOW_MAX_DAYS), [today]);
  /* Past dates are dropped before anything is searched, so the window the
     radio names and the window that runs are not always the same. */
  const searchedSpan = useMemo(() => {
    if (!value || flexibilityDays <= 0) return "";
    const wanted = addUtcDays(value, -flexibilityDays);
    const first = wanted < today ? today : wanted;
    const last = addUtcDays(value, flexibilityDays);
    return `${formatDisplayDate(first)}\u2009–\u2009${formatDisplayDate(last)}`;
  }, [value, flexibilityDays, today]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /* Focus follows the cursor so a screen reader announces the day it lands on.
   *
   * Guarded, because it also ran on the frame the popover opened — and the
   * popover opened on the input's own focus event, so clicking or tabbing
   * into the text field moved focus out of it into a day button within the
   * same commit. The field could not be typed into on any path a reader
   * would find: digits went to a <button>, which swallows them, and Space
   * picked the cursor date and closed the calendar.
   *
   * It now moves focus only when the grid already has it — which is exactly
   * when an arrow key has moved the cursor and the announcement is wanted —
   * or when the opener asked for it. */
  const wantsGridFocus = useRef(false);
  useEffect(() => {
    if (!open) return;
    const grid = gridRef.current;
    if (!grid) return;
    const gridHasFocus = grid.contains(document.activeElement);
    if (!gridHasFocus && !wantsGridFocus.current) return;
    wantsGridFocus.current = false;
    grid.querySelector<HTMLButtonElement>('[data-cursor="true"]')?.focus();
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
      /* Back to the field, not to document.body: the button holding focus is
         about to unmount, and focus landing on the body drops a keyboard
         user out of the form entirely. */
      inputRef.current?.focus();
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
          ref={inputRef}
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
          /* No onFocus={openCalendar}. Focusing a text field must not open a
             popover that then takes the focus away from it. The calendar
             opens from its own button, or from ArrowDown here. */
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              wantsGridFocus.current = true;
              openCalendar();
              return;
            }
            if (event.key === "Escape" && open) {
              event.preventDefault();
              setOpen(false);
            }
          }}
          autoComplete="off"
        />
        <button
          type="button"
          className="datefield-toggle"
          aria-expanded={open}
          aria-controls={`${id}-cal`}
          aria-label={open ? "Close the calendar" : "Open the calendar"}
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            wantsGridFocus.current = true;
            openCalendar();
          }}
        >
          <CalendarGlyph />
        </button>
      </div>

      {value ? (
        <p className="datefield-read">
          {formatDisplayDateLong(value)}
          {/* The dates that will actually be searched, not the width of the
              window that was asked for. "±2 days" on a trip leaving today
              promises five dates and gets three, because the two before
              today have gone — and the reader has no way to tell that from
              the control. Naming the span says it without a caveat. */}
          {flexibilityDays > 0 ? ` · searching ${searchedSpan}` : ""}
        </p>
      ) : null}

      {/* Not role="dialog": Tab passing through into the rest of the form is
          correct for a non-modal popover, and aria-expanded plus
          aria-controls on the toggle already describe it honestly. */}
      {open ? (
        <div className="datefield-pop" id={`${id}-cal`} aria-label="Choose a date">
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

          {/* Unconditional. The one line telling anybody the grid is
              keyboard-driven rendered only at ±0, and the product defaults
              to ±1 — so it was invisible in the state almost everyone is in. */}
          <p className="datefield-hint">
            Arrow keys move, Enter chooses.
            {flexibilityDays > 0 ? ` Shaded days are also searched, at ±${flexibilityDays}.` : ""}
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
