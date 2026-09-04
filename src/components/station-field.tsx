"use client";

import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";

type Station = { code: string; name: string; city: string; state: string };

export function StationField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<Station[]>([]);
  const [active, setActive] = useState(0);
  const lastValue = useRef(value);
  const root = useRef<HTMLLabelElement>(null);
  const listId = useId();

  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    setQuery(value);
    setResults([]);
  }, [value]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q.toUpperCase() === value || q.toUpperCase().includes(`(${value})`)) {
      return;
    }
    const handle = setTimeout(async () => {
      const response = await fetch(`/api/stations/search?q=${encodeURIComponent(q)}`);
      if (!response.ok) return;
      const json = (await response.json()) as { stations: Station[] };
      setResults(json.stations);
      setActive(0);
    }, 180);
    return () => clearTimeout(handle);
  }, [query, value]);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setResults([]);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setResults([]);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function pick(station: Station) {
    lastValue.current = station.code;
    onChange(station.code);
    setQuery(`${station.name} (${station.code})`);
    setResults([]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    }
    if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      pick(results[active]!);
    }
  }

  return (
    <label ref={root} className="relative block text-sm">
      {label}
      <input
        value={query}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={results[active] ? `${listId}-${results[active].code}` : undefined}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setQuery(event.target.value);
          setResults([]);
          if (/^[A-Za-z]{3}$/.test(event.target.value)) {
            onChange(event.target.value.toUpperCase());
          }
        }}
        className="field"
        placeholder="Boston or BOS"
        autoComplete="off"
      />
      {results.length > 0 ? (
        <ul id={listId} role="listbox" className="station-list absolute z-20 mt-1 w-full">
          {results.map((station, index) => (
            <li key={station.code} role="presentation">
              <button
                type="button"
                id={`${listId}-${station.code}`}
                role="option"
                aria-selected={index === active}
                className={`station-option w-full px-3 py-2.5 text-left ${index === active ? "is-active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(station)}
              >
                <span className="station-code">{station.code}</span>
                <span className="mt-0.5 block">{station.name}</span>
                <span className="text-xs opacity-70">
                  {station.city}, {station.state}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}
