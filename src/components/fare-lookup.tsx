"use client";

import { useCallback, useMemo, useState } from "react";
import { StationField } from "@/components/station-field";
import { DateField } from "@/components/date-field";
import { formatUsdCompact } from "@/lib/domain/money";
import { formatDisplayDate } from "@/lib/domain/calendar";
import { formatClock } from "@/lib/domain/timezone";
import { trainLabel } from "@/lib/domain/board-decision";
import type { FarePreview } from "@/lib/watches/preview-fares";

/* What does this cost, right now.
 *
 * The app could already answer this — /api/fares needs no database and no
 * account — but the only way to reach the answer was to try to save a watch
 * and have it fail. The most direct question the product can answer was
 * reachable only through a failure path.
 *
 * Nothing here is saved and nothing is watched, and the page says so twice:
 * once before you search and once beside the results. A list of fares that
 * looks like a watch is the one thing this must not be mistaken for.
 */

type State =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; preview: FarePreview }
  | { status: "failed"; message: string };

export function FareLookup({ today }: { today: string }) {
  const [origin, setOrigin] = useState("BOS");
  const [destination, setDestination] = useState("NYP");
  const [date, setDate] = useState(today);
  const [flexibility, setFlexibility] = useState<0 | 1 | 2>(1);
  const [passengers, setPassengers] = useState(1);
  const [state, setState] = useState<State>({ status: "idle" });

  const ready = origin.length === 3 && destination.length === 3 && origin !== destination && date;

  const search = useCallback(async () => {
    if (!ready) return;
    setState({ status: "searching" });
    try {
      const response = await fetch("/api/fares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originCode: origin,
          destinationCode: destination,
          desiredTravelDate: date,
          dateFlexibilityDays: flexibility,
          passengerCount: passengers,
        }),
      });
      const json = (await response.json()) as { preview?: FarePreview; error?: string };
      if (!response.ok || !json.preview) {
        setState({ status: "failed", message: json.error ?? "The search did not get through." });
        return;
      }
      setState({ status: "done", preview: json.preview });
    } catch {
      setState({
        status: "failed",
        message: "Could not reach RailDrop. Your connection, or ours.",
      });
    }
  }, [ready, origin, destination, date, flexibility, passengers]);

  return (
    <div className="lookup">
      <form
        className="lookup-form panel"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <div className="lookup-route">
          <StationField label="From" value={origin} onChange={setOrigin} />
          <button
            type="button"
            className="lookup-swap"
            aria-label="Swap origin and destination"
            onClick={() => {
              setOrigin(destination);
              setDestination(origin);
            }}
          >
            ⇄
          </button>
          <StationField label="To" value={destination} onChange={setDestination} />
        </div>

        <DateField
          value={date}
          onChange={setDate}
          today={today}
          flexibilityDays={flexibility}
          label="Travel date"
        />

        <fieldset className="lookup-flex">
          <legend>Also search</legend>
          {([0, 1, 2] as const).map((value) => (
            <label key={value} className={`choice ${flexibility === value ? "choice-on" : ""}`}>
              <input
                type="radio"
                name="flex"
                checked={flexibility === value}
                onChange={() => setFlexibility(value)}
              />
              {value === 0 ? "This day" : `±${value} day${value === 1 ? "" : "s"}`}
            </label>
          ))}
        </fieldset>

        <label className="lookup-pax">
          Passengers
          <input
            className="field"
            type="number"
            min={1}
            max={8}
            value={passengers}
            onChange={(event) =>
              setPassengers(Math.min(8, Math.max(1, Number(event.target.value) || 1)))
            }
          />
        </label>

        <button
          type="submit"
          className="btn btn-primary lookup-go"
          disabled={!ready || state.status === "searching"}
        >
          {state.status === "searching" ? "Reading the live board…" : "Check the fare"}
        </button>
        <p className="lookup-caveat">
          Nothing is saved and nothing is watched. Listed fares only — confirm on Amtrak.
        </p>
      </form>

      <Results state={state} passengers={passengers} />
    </div>
  );
}

function Results({ state, passengers }: { state: State; passengers: number }) {
  const cheapest = useMemo(
    () => (state.status === "done" ? state.preview.ranked[0] : undefined),
    [state],
  );

  if (state.status === "idle") {
    return (
      <div className="lookup-empty panel" role="status">
        <p className="kicker">No search yet</p>
        <p className="mt-2 text-ink-soft">
          Pick a route and a date. RailDrop reads the live board and shows what is actually listed —
          it never estimates a fare.
        </p>
      </div>
    );
  }

  if (state.status === "searching") {
    return (
      <div className="lookup-empty panel" role="status" aria-live="polite">
        <p className="kicker">Reading the live board</p>
        <p className="mt-2 text-ink-soft">
          A real browser is loading the corridor. Ten to thirty seconds is normal.
        </p>
        <div className="lookup-bar" aria-hidden>
          <span />
        </div>
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <div className="lookup-empty panel" role="alert">
        <p className="kicker text-drop">Not answered</p>
        <p className="mt-2 text-ink-soft">{state.message}</p>
      </div>
    );
  }

  const { preview } = state;
  if (preview.ranked.length === 0) {
    return (
      <div className="lookup-empty panel" role="status">
        <p className="kicker">
          {preview.failedDates.length > 0 ? "Not answered" : "Nothing listed"}
        </p>
        <p className="mt-2 text-ink-soft">
          {preview.failureReason ??
            "No fares are listed for these dates right now. That is what the corridor is showing."}
        </p>
      </div>
    );
  }

  return (
    <section className="lookup-results" aria-label="Listed fares">
      <header className="lookup-head">
        <p className="kicker">
          {preview.originCode} → {preview.destinationCode}
        </p>
        <p className="lookup-best">
          <span className="price serif">{formatUsdCompact(cheapest!.totalPartyPriceCents)}</span>
          <span className="lookup-best-note">
            cheapest of {preview.ranked.length} listed
            {passengers > 1 ? ` · ${passengers} passengers, total` : ""}
          </span>
        </p>
      </header>

      {preview.byDate.length > 1 ? (
        <ul className="lookup-days stagger">
          {preview.byDate.map(([day, candidate]) => (
            <li key={day} className={`lookup-day${day === preview.byDate[0]?.[0] ? "" : ""}`}>
              <span className="lookup-day-label">{formatDisplayDate(day)}</span>
              <span className="price">{formatUsdCompact(candidate.totalPartyPriceCents)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <ol className="lookup-list stagger">
        {preview.ranked.slice(0, 12).map((candidate) => (
          <li key={`${candidate.journey.id}:${candidate.fare.id}`} className="lookup-row">
            <span className="price lookup-row-price">
              {formatUsdCompact(candidate.totalPartyPriceCents)}
            </span>
            <span className="lookup-row-when">
              {formatDisplayDate(candidate.journey.searchedTravelDate)} ·{" "}
              {formatClock(candidate.journey.departureAt)}
            </span>
            <span className="lookup-row-train">{trainLabel(candidate)}</span>
          </li>
        ))}
      </ol>

      {preview.failedDates.length > 0 ? (
        <p className="lookup-note">
          {preview.failedDates.length} date{preview.failedDates.length === 1 ? "" : "s"} in this
          window could not be read, so they are unknown rather than empty.
        </p>
      ) : null}

      <p className="lookup-note">
        Listed fares, not a booking, and nothing here is being watched.{" "}
        <a href="/watches/new" className="underline">
          Watch this trip
        </a>{" "}
        to be told when one drops.
      </p>
    </section>
  );
}
