'use client';

import { formatShortDate } from '@/lib/domain/dates';
import {
  DEPARTURE_PARTS,
  NO_FILTERS,
  isFiltered,
  type DeparturePart,
  type OptionFilters,
} from '@/lib/domain/option-filters';

/**
 * Narrowing controls for the fare list.
 *
 * Every control carries the number of options it would leave, computed against
 * the other active filters, and disables itself at zero. A filter that can only
 * lead to "nothing matches" is a dead end the user has to discover and then
 * undo; showing the count turns it into information before it is a mistake.
 */
export function OptionFilterBar({
  filters,
  onChange,
  counts,
  total,
  shown,
  dates,
  hasBus,
  hasRestricted,
}: {
  filters: OptionFilters;
  onChange: (next: OptionFilters) => void;
  counts: {
    directOnly: number;
    railOnly: number;
    noRestricted: number;
    departure: Record<DeparturePart, number>;
    byDate: Record<string, number>;
  };
  total: number;
  shown: number;
  dates: string[];
  hasBus: boolean;
  hasRestricted: boolean;
}) {
  const active = isFiltered(filters);
  const toggles = [
    { key: 'directOnly' as const, label: 'Direct only', count: counts.directOnly, show: true },
    { key: 'railOnly' as const, label: 'Rail only', count: counts.railOnly, show: hasBus },
    {
      key: 'noRestricted' as const,
      label: 'No restricted fares',
      count: counts.noRestricted,
      show: hasRestricted,
    },
  ].filter((toggle) => toggle.show);

  return (
    <div
      data-testid="option-filters"
      className="rd-card mb-3 flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3"
    >
      <div role="group" aria-label="Filter options" className="flex flex-wrap items-center gap-1.5">
        {toggles.map((toggle) => {
          const on = filters[toggle.key];
          const dead = !on && toggle.count === 0;
          return (
            <button
              key={toggle.key}
              type="button"
              aria-pressed={on}
              disabled={dead}
              onClick={() => onChange({ ...filters, [toggle.key]: !on })}
              className={chipClass(on, dead)}
            >
              {toggle.label}
              <span className={countClass(on)}>{toggle.count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <label htmlFor="departure-part" className="text-[11.5px] font-semibold text-faint">
          Departs
        </label>
        <select
          id="departure-part"
          value={filters.departure}
          onChange={(event) =>
            onChange({ ...filters, departure: event.target.value as DeparturePart })
          }
          className="rd-input !min-h-11 w-auto !py-1 !text-[13px]"
        >
          {DEPARTURE_PARTS.map((part) => (
            <option key={part.id} value={part.id} disabled={counts.departure[part.id] === 0}>
              {part.label} ({counts.departure[part.id]})
            </option>
          ))}
        </select>
      </div>

      {dates.length > 1 ? (
        <div
          role="group"
          aria-label="Filter by date"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            aria-pressed={filters.travelDate === null}
            onClick={() => onChange({ ...filters, travelDate: null })}
            className={chipClass(filters.travelDate === null, false)}
          >
            All dates
          </button>
          {dates.map((date) => {
            const on = filters.travelDate === date;
            const count = counts.byDate[date] ?? 0;
            return (
              <button
                key={date}
                type="button"
                aria-pressed={on}
                disabled={!on && count === 0}
                onClick={() => onChange({ ...filters, travelDate: on ? null : date })}
                className={chipClass(on, !on && count === 0)}
              >
                {formatShortDate(date)}
                <span className={countClass(on)}>{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-3">
        <span aria-live="polite" className="tnum text-[12px] text-faint">
          {active ? `${shown} of ${total}` : `${total} option${total === 1 ? '' : 's'}`}
        </span>
        {active ? (
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="inline-flex min-h-11 items-center text-[12.5px] font-semibold text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function chipClass(on: boolean, dead: boolean): string {
  const base =
    'inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-semibold transition-colors';
  if (dead) return `${base} cursor-not-allowed border-line text-faint opacity-50`;
  return on
    ? `${base} border-ink bg-invert text-on-invert`
    : `${base} border-line text-muted hover:border-line-strong hover:text-ink`;
}

function countClass(on: boolean): string {
  return `tnum text-[11px] ${on ? 'opacity-70' : 'text-faint'}`;
}
