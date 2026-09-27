'use client';

import { useId, useMemo, useRef, useState } from 'react';

export interface StationOption {
  code: string;
  name: string;
  city: string;
  state: string;
}

/**
 * Accessible combobox over the LOCAL station catalog.
 *
 * The whole catalog is passed in from the server, so typing filters in memory and
 * never triggers a network request - let alone a paid provider autocomplete call.
 */
export function StationPicker({
  label,
  name,
  stations,
  value,
  onChange,
  error,
  autoFocus,
}: {
  label: string;
  name: string;
  stations: StationOption[];
  value: string;
  onChange: (code: string) => void;
  error?: string | null;
  autoFocus?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => stations.find((s) => s.code === value) ?? null, [stations, value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return stations.slice(0, 8);

    const score = (s: StationOption): number => {
      const code = s.code.toLowerCase();
      if (code === q) return 0; // an exact code match is unambiguous intent
      if (code.startsWith(q)) return 1;
      if (s.city.toLowerCase().startsWith(q)) return 2;
      if (s.city.toLowerCase().includes(q)) return 3;
      return 4;
    };

    return stations
      .filter(
        (s) =>
          s.code.toLowerCase().startsWith(q) ||
          s.city.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q),
      )
      .map((s) => [score(s), s] as const)
      .sort((a, b) => a[0] - b[0] || a[1].city.localeCompare(b[1].city))
      .map(([, s]) => s)
      .slice(0, 8);
  }, [stations, query]);

  function commit(station: StationOption) {
    onChange(station.code);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      // ArrowDown is the keyboard route into the suggestion list.
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      const station = matches[highlight];
      if (open && station) {
        event.preventDefault();
        commit(station);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const display = selected && query === '' ? `${selected.code} · ${selected.city}` : query;

  return (
    <div className="relative">
      <label htmlFor={id} className="rd-label">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        autoComplete="off"
        autoFocus={autoFocus}
        className="rd-input mt-1.5"
        placeholder="City or 3-letter code"
        value={display}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
          if (selected) onChange('');
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      <input type="hidden" name={name} value={value} />

      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-[12px] text-danger">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] text-faint">
          {selected ? selected.name : 'Search by city or station code'}
        </p>
      )}

      {open && matches.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} station suggestions`}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line-strong bg-surface py-1 shadow-lg"
        >
          {matches.map((station, index) => (
            <li key={station.code} role="none">
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(station)}
                onMouseEnter={() => setHighlight(index)}
                className={`flex w-full items-baseline gap-3 px-3 py-2 text-left ${
                  index === highlight ? 'bg-paper' : ''
                }`}
              >
                <span className="tnum w-9 shrink-0 text-[13px] font-bold text-rust">
                  {station.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">
                    {station.city}, {station.state}
                  </span>
                  <span className="block truncate text-[12px] text-muted">{station.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
