"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { StationField } from "@/components/station-field";
import { DateField } from "@/components/date-field";
import { formatUsdCompact } from "@/lib/domain/money";
import { formatDisplayDate } from "@/lib/domain/calendar";
import { formatClock } from "@/lib/domain/timezone";
import { trainLabel } from "@/lib/domain/board-decision";
import { FareProvenance } from "@/components/fare-provenance";
import { Money } from "@/components/money";
import type { DateProgress, FarePreview } from "@/lib/watches/preview-fares";
import { sharedSearchHref, type SharedSearch } from "@/lib/domain/share-search";

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
  /* Dates land one at a time, so the waiting state carries the ones that have.
     The first is usually done in a third of the total — holding it back until
     the slowest returns is most of the wait, spent showing nothing. */
  | { status: "searching"; done: DateProgress[] }
  | { status: "done"; preview: FarePreview }
  | { status: "failed"; message: string };

export function FareLookup({ today, initial }: { today: string; initial?: SharedSearch }) {
  const [origin, setOrigin] = useState(initial?.originCode ?? "BOS");
  const [destination, setDestination] = useState(initial?.destinationCode ?? "NYP");
  const [date, setDate] = useState(initial?.travelDate ?? today);
  const [flexibility, setFlexibility] = useState<0 | 1 | 2>(initial?.flexibilityDays ?? 1);
  const [passengers, setPassengers] = useState(initial?.passengers ?? 1);
  const [state, setState] = useState<State>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  const ready = origin.length === 3 && destination.length === 3 && origin !== destination && date;

  const search = useCallback(async () => {
    if (!ready) return;
    setState({ status: "searching", done: [] });
    try {
      const response = await fetch("/api/fares/stream", {
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
      if (!response.ok || !response.body) {
        setState({ status: "failed", message: "The search did not get through." });
        return;
      }

      /* NDJSON: one object per line. A chunk can split a line anywhere, so the
         tail is carried over rather than parsed — the bug this shape invites
         is assuming a chunk is a whole message, which works locally and fails
         the moment a real network is involved. */
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let carry = "";
      const landed: DateProgress[] = [];

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });
        const lines = carry.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let message: {
            type: string;
            progress?: DateProgress;
            preview?: FarePreview;
            error?: string;
          };
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.type === "progress" && message.progress) {
            landed.push(message.progress);
            setState({ status: "searching", done: [...landed] });
          } else if (message.type === "done" && message.preview) {
            setState({ status: "done", preview: message.preview });
          } else if (message.type === "error") {
            setState({
              status: "failed",
              message: message.error ?? "The search did not get through.",
            });
          }
        }
      }
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
        {/* The link carries the route and the date and never a fare. A price in
            a URL is one nobody observed by the time it is read, and a forged
            one would look exactly like a real one. */}
        <button
          type="button"
          className="lookup-share"
          onClick={async () => {
            const href = new URL(
              sharedSearchHref({
                originCode: origin,
                destinationCode: destination,
                travelDate: date,
                flexibilityDays: flexibility,
                passengers,
              }),
              window.location.origin,
            ).toString();
            try {
              await navigator.clipboard.writeText(href);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard refused (permissions, insecure origin). Say nothing
              // rather than claim a copy that did not happen.
              setCopied(false);
            }
          }}
        >
          {copied ? "Link copied" : "Copy this search"}
        </button>
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
      <div className="lookup-empty is-idle panel" role="status">
        <p className="kicker">No search yet</p>
        <p className="mt-2 text-ink-soft">
          Pick a route and a date. RailDrop reads the live board and shows what is actually listed —
          it never estimates a fare.
        </p>
      </div>
    );
  }

  if (state.status === "searching") {
    const total = state.done[0]?.total ?? 0;
    return (
      <div className="lookup-empty panel" role="status" aria-live="polite">
        <p className="kicker">Reading the live board</p>
        <p className="mt-2 text-ink-soft">
          {state.done.length === 0
            ? "A real browser is loading the corridor. Ten to thirty seconds is normal."
            : `${state.done.length} of ${total} date${total === 1 ? "" : "s"} back.`}
        </p>

        {/* Each date as it lands, rather than a bar and a promise. */}
        {state.done.length > 0 ? (
          <ul className="lookup-live">
            {state.done.map((entry) => (
              <li key={entry.travelDate} className={`lookup-live-row is-${entry.outcome}`}>
                <span className="lookup-live-date">{formatDisplayDate(entry.travelDate)}</span>
                <span className="lookup-live-value">
                  {entry.cheapestCents !== null
                    ? formatUsdCompact(entry.cheapestCents)
                    : entry.outcome === "failed"
                      ? "not answered"
                      : entry.outcome === "unreadable"
                        ? "could not read"
                        : "nothing listed"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

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
      <header className="lookup-head bracketed">
        <div>
          <p className="micro">
            {preview.originCode} <span aria-hidden>→</span> {preview.destinationCode}
          </p>
          <p className="lookup-best">
            {/* toFixed(0) here showed $74 for an observed $74.50. The mark is
                still stepped back so the digits carry the line — that lives in
                Money now, with the cents. */}
            <Money cents={cheapest!.totalPartyPriceCents} className="readout-lg" />
          </p>
        </div>
        <p className="lookup-best-note">
          cheapest of {preview.ranked.length} listed
          {passengers > 1 ? ` · ${passengers} passengers, total` : ""}
        </p>
      </header>

      {preview.byDate.length > 1 ? (
        <ul className="lookup-days stagger">
          {preview.byDate.map(([day, candidate]) => (
            <li key={day} className={`lookup-day${day === preview.byDate[0]?.[0] ? "" : ""}`}>
              <span className="lookup-day-label micro">{formatDisplayDate(day)}</span>
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
            {/* The claim this product makes is unusual enough to be worth
                being able to check. Collapsed, because most people want the
                fare and not the derivation. */}
            <FareProvenance
              candidate={candidate}
              context={{
                originCode: preview.originCode,
                destinationCode: preview.destinationCode,
                travelDate: candidate.journey.searchedTravelDate,
                passengerCount: passengers,
              }}
            />
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
        <Link href="/watches/new" className="underline">
          Watch this trip
        </Link>{" "}
        to be told when one drops.
      </p>
    </section>
  );
}
