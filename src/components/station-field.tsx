"use client";

import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";

type Coverage = "verified" | "unverified" | "ambiguous" | "unknown";
type Station = {
  code: string;
  name: string;
  city: string;
  state: string;
  coverage?: Coverage;
};

/* What the provider can actually reach, said before a watch is created.
 *
 * 169 of the 189 catalog stations have no verified provider id. For those the
 * search falls back to matching city names, which either returns nothing (and
 * reads as "no cheaper fare") or returns the other station in the same city.
 * Neither is something to discover after 48 hours of silent monitoring. */
const COVERAGE_NOTE: Record<Coverage, string | null> = {
  verified: null,
  unverified: "Coverage unverified — live results are not guaranteed for this station",
  ambiguous: "Two stations share this code — results may be for the other one",
  unknown: "RailDrop does not recognise this station",
};

const COVERAGE_TAG: Record<Coverage, string | null> = {
  verified: null,
  unverified: "unverified",
  ambiguous: "ambiguous",
  unknown: "unknown",
};

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
  /** Coverage of the station currently chosen, kept after the list closes. */
  const [chosen, setChosen] = useState<Coverage | null>(null);
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
      // A bare three-letter code typed by hand is accepted as a station code,
      // so if the catalog has never heard of it, say so rather than letting a
      // watch be created against a station that can never return a fare.
      if (/^[A-Za-z]{3}$/.test(q) && json.stations.length === 0) {
        setChosen("unknown");
      }
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
    setChosen(station.coverage ?? null);
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
        aria-activedescendant={
          results[active] ? `${listId}-${results[active].code}-${active}` : undefined
        }
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setQuery(event.target.value);
          setResults([]);
          setChosen(null);
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
          {results.map((station, index) => {
            const tag = station.coverage ? COVERAGE_TAG[station.coverage] : null;
            return (
              // Index is part of the key: five codes are held by two different
              // stations, so the code alone is not unique.
              <li key={`${station.code}-${index}`} role="presentation">
                <button
                  type="button"
                  id={`${listId}-${station.code}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`station-option w-full px-3 py-2.5 text-left ${index === active ? "is-active" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(station)}
                >
                  <span className="flex items-center gap-2">
                    <span className="station-code">{station.code}</span>
                    {tag ? <span className="coverage-tag">{tag}</span> : null}
                  </span>
                  <span className="mt-0.5 block">{station.name}</span>
                  <span className="text-xs opacity-70">
                    {station.city}, {station.state}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {chosen && COVERAGE_NOTE[chosen] ? (
        <p className="coverage-note" role="status">
          {COVERAGE_NOTE[chosen]}
        </p>
      ) : null}
    </label>
  );
}
