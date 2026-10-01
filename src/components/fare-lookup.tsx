"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StationField } from "@/components/station-field";
import { DateField } from "@/components/date-field";
import { dollarsToCents, formatUsdCompact, formatUsdPerHour } from "@/lib/domain/money";
import { formatDisplayDate } from "@/lib/domain/calendar";
import { formatClock, formatInstantClock } from "@/lib/domain/timezone";
import { sameDayCheapest, trainLabel } from "@/lib/domain/board-decision";
import { dateOutcomes, windowWasPartial } from "@/lib/domain/date-outcomes";
import { centsPerHour, sortBoard, type BoardSort } from "@/lib/domain/board-tools";
import { formatDurationMinutes } from "@/lib/domain/calendar";
import { FareProvenance } from "@/components/fare-provenance";
import { Money } from "@/components/money";
import type { DateProgress, FarePreview } from "@/lib/fares/preview-fares";
import { isPastDate, sharedSearchHref, type SharedSearch } from "@/lib/domain/share-search";
import { cheapestByBucketOnDate } from "@/lib/domain/board-insights";
import type { TimeBucket } from "@/lib/domain/board-tools";
import type { RankedCandidate } from "@/lib/domain/types";

/* The product.
 *
 * You type a route and a date; a real browser reads Amtrak's listed
 * inventory for every date in the window and this renders all of it — the
 * cheapest fare, where it sits in the distribution, which day and which
 * part of the day is cheapest, and what each train works out to per hour.
 *
 * Nothing is saved anywhere. There is no account, no session and no
 * database: the route and the date live in the address bar while you are
 * looking at them and vanish when you close the tab, and the amount typed
 * into "what you paid" is subtracted in this browser and never sent. The
 * page says so, because a page full of fares that looks like it is tracking
 * something is the one thing this must not be mistaken for.
 *
 * Every figure here is a fare a provider was observed listing, or
 * arithmetic on fares a provider was observed listing. There is no
 * forecast, no average over history, and no advice about when to book.
 */

type State =
  | { status: "idle" }
  /* Dates land one at a time, so the waiting state carries the ones that have.
     The first is usually done in a third of the total — holding it back until
     the slowest returns is most of the wait, spent showing nothing. */
  | { status: "searching"; done: DateProgress[] }
  /* The preview is accompanied by the passenger count the search was RUN
     with, not the one in the form. Reading the live field let the stepper
     relabel fares that had already been fetched: a $211 single fare picked
     up "4 passengers, total", and the provenance panel — the one surface
     whose entire job is to let a reader check the arithmetic — printed
     "Per traveller $211 · Party total $211 · Multiplied by 4 travellers".
     Nobody observed $211 for four people. */
  | { status: "done"; preview: FarePreview; passengers: number }
  | { status: "failed"; message: string };

export function FareLookup({ today, initial }: { today: string; initial?: SharedSearch }) {
  const [origin, setOrigin] = useState(initial?.originCode ?? "BOS");
  const [destination, setDestination] = useState(initial?.destinationCode ?? "NYP");
  const [date, setDate] = useState(initial?.travelDate ?? today);
  const [flexibility, setFlexibility] = useState<0 | 1 | 2>(initial?.flexibilityDays ?? 1);
  const [passengers, setPassengers] = useState(initial?.passengers ?? 1);
  const [state, setState] = useState<State>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  /* A date that has gone cannot be searched, and the product knew it.
   *
   * isPastDate was written for exactly this and imported nowhere. A shared
   * link carrying 2020-01-01 rendered "Wed, Jan 1" — no year — with the
   * button enabled, and the search came back "NOT ANSWERED · All dates in
   * the travel window have already passed", under the same kicker a provider
   * block uses. Bad input read as the board having failed, after a round
   * trip spent proving it. */
  const dateHasGone = isPastDate(date, today);
  const ready =
    origin.length === 3 &&
    destination.length === 3 &&
    origin !== destination &&
    Boolean(date) &&
    !dateHasGone;

  /* A link that names a route is a request for that route's fares.
   *
   * The landing page's primary button says "See live fares" and handed the
   * reader a panel reading "No search yet · Pick a route and a date" — with
   * the route and the date they had just picked echoed in the form beside
   * it. The one job of the front door was to turn a stranger into a price,
   * and it delivered an empty state that reads as a failure.
   *
   * Auto-running is scoped to links that carry an explicit route, which is
   * every link the hero and the share button produce. Opening a bare /fares
   * still waits to be asked, because nobody asked for anything. */
  const autoRan = useRef(false);

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
      /* A stream can end without ever sending its verdict — a dropped
         connection, a killed worker, a proxy that times out mid-body. The
         loop below simply ran out of chunks and returned, leaving the page
         in "Reading the live board…" with a disabled button and no way back.
         An unfinished search is a failed search and has to say so. */
      let settled = false;

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
            setState({ status: "done", preview: message.preview, passengers });
            settled = true;
            /* The search that just cost thirty seconds, written into the
               address bar. It left no trace at all: reload, Back and Forward
               all returned the idle "No search yet" panel and the wait was
               unrecoverable. Route, date, window and party only — never a
               fare, for the same reason the share link carries none. */
            window.history.replaceState(
              null,
              "",
              sharedSearchHref({
                originCode: origin,
                destinationCode: destination,
                travelDate: date,
                flexibilityDays: flexibility,
                passengers,
              }),
            );
          } else if (message.type === "error") {
            setState({
              status: "failed",
              message: message.error ?? "The search did not get through.",
            });
            settled = true;
          }
        }
      }

      if (!settled) {
        setState({
          status: "failed",
          message: "The connection dropped before the search finished. Nothing was read.",
        });
      }
    } catch {
      setState({
        status: "failed",
        message: "Could not reach RailDrop. Your connection, or ours.",
      });
    }
  }, [ready, origin, destination, date, flexibility, passengers]);

  useEffect(() => {
    if (autoRan.current || !initial?.routeWasNamed || !ready) return;
    autoRan.current = true;
    void search();
  }, [initial?.routeWasNamed, ready, search]);

  return (
    <div className="lookup">
      {/* action + method + names, so a submit before hydration round-trips
          to the same search instead of discarding it. Without them the
          browser did a native GET with only the one named control (`flex`)
          and landed on /fares?flex=on — route, date and passengers gone,
          the page re-rendered at its defaults, and nothing saying why. */}
      <form
        className="lookup-form panel"
        action="/fares"
        method="get"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <input type="hidden" name="from" value={origin} />
        <input type="hidden" name="to" value={destination} />
        <input type="hidden" name="on" value={date} />
        <input type="hidden" name="pax" value={passengers} />
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
        {dateHasGone ? (
          <p className="lookup-field-note" role="status">
            That date has gone. Pick {today} or later.
          </p>
        ) : null}

        <fieldset className="lookup-flex">
          <legend>Also search</legend>
          {([0, 1, 2] as const).map((value) => (
            <label key={value} className={`choice ${flexibility === value ? "choice-on" : ""}`}>
              <input
                type="radio"
                name="flex"
                value={value}
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
          Nothing is saved anywhere. Listed fares only — confirm on Amtrak before you book.
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

      <Results state={state} />
    </div>
  );
}

/* What "what you paid" is worth, against the right fare.
 *
 * The comparison subtracted the WINDOW minimum, which is frequently a fare on
 * a different day. A reader travelling on Oct 1 who paid $128 was told
 * "$37 cheaper now" in saving-green, where the $91 was an Oct 3 train — two
 * days after their trip. They had in fact done well: the cheapest thing
 * listed for their own day was $211. The product told somebody who had beaten
 * the market by $83 that they were overpaying.
 *
 * So: the verdict is against their own travel date and names it, and moving
 * the trip is a separate sentence that says so, because it is a different
 * offer. When their own date returned nothing there is no honest benchmark
 * and the component says that rather than substituting another day's fare.
 */
type PaidVerdict =
  | { kind: "idle" | "unusable"; note: string; move: null }
  | {
      kind: "cheaper" | "dearer" | "same";
      /** The figure as typed, for the scale to mark. */
      cents: number;
      delta: number;
      move: { date: string; saving: number } | null;
    };

export function readPaid(
  typed: string,
  preview: FarePreview,
  cheapestDay: readonly [string, RankedCandidate] | undefined,
): PaidVerdict {
  if (typed.trim().length === 0) {
    return { kind: "idle", note: "Type it to compare against the live board.", move: null };
  }
  /* dollarsToCents, not Number: "$128" and "1,200" are what people type, and
     Number gives NaN for both — which rendered as the same hint an empty
     field gets, so the product looked like it had not noticed. */
  const cents = dollarsToCents(typed);
  if (cents === null || cents <= 0) {
    return { kind: "unusable", note: "That is not an amount we can compare.", move: null };
  }
  if (cents > MAX_SANE_FARE_CENTS) {
    return {
      kind: "unusable",
      note: "That is more than any rail fare — check the figure.",
      move: null,
    };
  }

  const benchmark = sameDayCheapest(preview.ranked, preview.desiredTravelDate);
  if (!benchmark) {
    return {
      kind: "unusable",
      note: `Nothing was listed for ${formatDisplayDate(preview.desiredTravelDate)}, so there is nothing to compare against.`,
      move: null,
    };
  }

  const delta = cents - benchmark.totalPartyPriceCents;
  const move =
    cheapestDay && cheapestDay[0] !== preview.desiredTravelDate
      ? {
          date: cheapestDay[0],
          saving: benchmark.totalPartyPriceCents - cheapestDay[1].totalPartyPriceCents,
        }
      : null;
  return {
    kind: delta > 0 ? "cheaper" : delta < 0 ? "dearer" : "same",
    cents,
    delta: Math.abs(delta),
    move: move && move.saving > 0 ? move : null,
  };
}

/** Rows shown before the list asks to be expanded. */
const VISIBLE_ROWS = 12;

/* One name per ordering, used by the chips and by the collapse button, so
   the button cannot describe an ordering the chips do not offer. */
const SORT_LABEL: Partial<Record<BoardSort, string>> = {
  price: "price",
  depart: "departure",
  duration: "journey time",
};

/* An upper bound on "what you paid", so a slipped keypress does not produce a
   nine-figure saving rendered in the same green as a real one. Well above any
   Northeast Corridor fare, including a party of eight in first class. */
const MAX_SANE_FARE_CENTS = 10_000_00;

function Results({ state }: { state: State }) {
  /* The count the search ran with, never the one in the form. */
  const passengers = state.status === "done" ? state.passengers : 1;
  /* The headline fare and the first row under "cheapest" are the same train.
   *
   * The headline read preview.ranked[0] — the ranking's own order — while the
   * list read sortBoard(…, "price"). With four fares tied at $91 those are
   * two different trains, so the page could name 7:55 PM at the top and open
   * the list with 3:10 PM, both labelled cheapest. One ordering, used twice. */
  const cheapest = useMemo(
    () => (state.status === "done" ? sortBoard(state.preview.ranked, "price")[0] : undefined),
    [state],
  );
  /* Lives with the result rather than the query, because it is a question
     about the answer: "is this better than what I already have?" Nothing is
     sent anywhere and nothing is stored — it is arithmetic on two numbers
     the reader is already looking at. */
  const [paid, setPaid] = useState("");
  /* The list showed the first twelve and said nothing about the rest, so
     a reader comparing against the scale saw a $315 ceiling with no row
     anywhere near it and no way to tell whether that was a bug. */
  const [showAll, setShowAll] = useState(false);
  /* Cheapest first by default, because that is the question most people
     arrived with. Departure matters to anyone with a meeting, and duration
     to anyone choosing between a $91 four-hour train and a $141 three-hour
     one — both orderings of the same observed set, neither a judgement
     about which to take. */
  const [sort, setSort] = useState<BoardSort>("price");

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
            ? "A real browser is loading the corridor — about ten seconds for each date in your window. Each one appears here as it lands."
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
    /* "That is what the corridor is showing" asserts the corridor was read.
       When dates were refused or could not be parsed, it was not — and the
       claim is the opposite of what happened. The sentence states the counts
       instead, and the colophon comes with it, because a state with no answer
       on it is the one where a reader most needs to know what was measured. */
    const empty = dateOutcomes(preview);
    const unread = empty.failed + empty.unreadable;
    return (
      <div className="lookup-empty panel" role="status">
        <p className="kicker">{unread > 0 ? "Not answered" : "Nothing listed"}</p>
        <p className="mt-2 text-ink-soft">
          {preview.failureReason ??
            (unread === 0
              ? `All ${preview.dates.length} ${preview.dates.length === 1 ? "date" : "dates"} were read and nothing is listed on ${preview.dates.length === 1 ? "it" : "them"}.`
              : unread === preview.dates.length
                ? `None of the ${preview.dates.length} dates could be read, so we do not know what is listed.`
                : `${unread} of ${preview.dates.length} dates could not be read. The ${empty.empty} we did read have nothing listed.`)}
        </p>
        <Colophon preview={preview} />
      </div>
    );
  }

  /* Which day, and which part of the day, is cheapest.
   *
   * Both come out of the fares this search actually returned — no history,
   * no model, no prediction. "The cheapest one we saw was on Oct 8, in the
   * morning" is a description of observations; "book on a Tuesday" would be
   * a claim about the future, and this product does not make those. */
  /* By price, not by position. Marking the FIRST cheapest day told a reader
     that Sep 29 beat Sep 30 when both were $22 — a distinction the data does
     not support, on the one element whose entire job is to say which day to
     pick. Every day at the floor is flagged, which is also the honest answer
     to "when should I travel": sometimes it is "either of these". */
  const outcomes = dateOutcomes(preview);
  const dayPrices = preview.byDate.map(([, candidate]) => candidate.totalPartyPriceCents);
  const dayFloor = dayPrices.length ? Math.min(...dayPrices) : 0;
  /* Two dates can land on the same lowest fare, and when they did, both cells
     read "cheapest" under a heading that says "cheapest day" — which looks
     exactly like the arithmetic having gone wrong, on the one surface whose
     whole proposition is that its numbers can be trusted. A tie is a real
     answer and gets said out loud. */
  const dayFloorCount = dayPrices.filter((cents) => cents === dayFloor).length;
  const dayCeiling = dayPrices.length ? Math.max(...dayPrices) : 0;
  /* Only worth saying when the days actually differ. A "spread" of zero is a
     sentence that sounds like advice and contains none. */
  const daySpread = dayCeiling - dayFloor;
  const cheapestDay = preview.byDate.find(
    ([, candidate]) => candidate.totalPartyPriceCents === dayFloor,
  );
  /* One day, named. Pooling the window made "morning" and "afternoon"
     minima that could come from different dates look like a time-of-day
     pattern. The reader's own travel date is the one they are taking;
     if nothing was listed for it, the cheapest day we did read. */
  const bucketDate = sameDayCheapest(preview.ranked, preview.desiredTravelDate)
    ? preview.desiredTravelDate
    : (cheapestDay?.[0] ?? preview.desiredTravelDate);
  const buckets = cheapestByBucketOnDate(preview.ranked, bucketDate);
  const bucketRows = (["morning", "afternoon", "evening"] as const)
    .map((bucket) => [bucket, buckets[bucket]] as const)
    .filter(
      (row): row is readonly [TimeBucket, { candidate: RankedCandidate; count: number }] =>
        row[1] != null,
    );
  const bucketFloor = bucketRows.length
    ? Math.min(...bucketRows.map(([, b]) => b.candidate.totalPartyPriceCents))
    : 0;

  /* The scale.
   *
   * Every fare the search returned, as one tick on one rule, positioned by
   * price between the cheapest and dearest things actually observed. The
   * point is that the eye finds the cheap end before anyone reads a number,
   * and that the shape of the distribution — a lone tick at the floor, or a
   * wall of them crowded at the top — is information no list can give you.
   *
   * Both ends of the rule are real fares. There is no rounded axis, no
   * nice-numbers algorithm, no zero origin: inventing an endpoint would put
   * a price on the page that nobody listed, which is the one thing this
   * product does not do. When every fare is the same price there is no
   * distribution to draw and the component says so instead of drawing a
   * scale one pixel wide.
   */
  const prices = preview.ranked.map((c) => c.totalPartyPriceCents).sort((a, b) => a - b);
  const floor = prices[0] ?? 0;
  const ceiling = prices[prices.length - 1] ?? 0;
  const span = ceiling - floor;
  const at = (cents: number) => (span > 0 ? ((cents - floor) / span) * 100 : 50);

  const ordered = sortBoard(preview.ranked, sort);
  /* The collapsed list always contains the fare the headline names.
   *
   * It was the first twelve of whatever ordering was active, so under
   * "departure" the page could read "$91 · cheapest of 30 listed" over a
   * scale labelled "$91 cheapest listed" and then show twelve rows that
   * started at $257 — the cheapest fare nowhere on screen. That is the same
   * failure the Show-all control was built to prevent, reintroduced at the
   * other end of the scale, and it reads as the $91 being wrong.
   *
   * The cheapest row keeps its place in the sorted order; it is admitted to
   * the collapsed set rather than pinned to the top, so the ordering the
   * reader chose is still the ordering they see. */
  const collapsed = (() => {
    const head = ordered.slice(0, VISIBLE_ROWS);
    if (!cheapest || head.includes(cheapest)) return head;
    const withCheapest = [...head.slice(0, VISIBLE_ROWS - 1), cheapest];
    return ordered.filter((candidate) => withCheapest.includes(candidate));
  })();

  /* What you paid, compared against the right fare.
   *
   * This subtracted the WINDOW minimum, which is frequently a fare on a
   * different day. A reader travelling on Oct 1 who paid $128 was told
   * "$37 cheaper now" in saving-green, where the $91 was an Oct 3 train —
   * two days after their trip. They had in fact done well: the cheapest
   * thing listed for their own day was $211. The product told somebody who
   * beat the market by $83 that they had overpaid.
   *
   * So the comparison is against their own travel date, named in the
   * sentence, and the window is a separate line that says plainly that it
   * means moving the trip.
   *
   * Parsed with dollarsToCents rather than Number, because "$128" and
   * "1,200" are what people type and Number gives NaN for both. */
  const paidVerdict = readPaid(paid, preview, cheapestDay);
  /* The figure to mark on the rule, once it is one we are prepared to compare
     against. An unusable or absent one marks nothing — a band drawn from a
     number we have just refused to use would be the product arguing with
     itself. */
  const paidCents = "cents" in paidVerdict ? paidVerdict.cents : null;
  /* Off the end of the rule in either direction is a fact about the reading,
     not a thing to silently clamp: a $900 entry pinned to the ceiling tick
     reads as a fare somebody listed. */
  const paidBeyond =
    paidCents === null ? null : paidCents > ceiling ? "over" : paidCents < floor ? "under" : null;

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
          <p className="lookup-verdict">
            cheapest of {preview.ranked.length} listed
            {cheapestDay ? ` · ${formatDisplayDate(cheapestDay[0])}` : ""}
            {cheapest?.journey.departureAt ? ` · ${formatClock(cheapest.journey.departureAt)}` : ""}
            {passengers > 1 ? ` · ${passengers} passengers, total` : ""}
          </p>
        </div>

        {/* What you paid, without an account, a watch or a database.
            This comparison was the best thing the product did and it was
            locked behind creating a watch — which needs a session AND the
            one dependency that can be down. It is arithmetic on two numbers
            the reader already has. */}
        <div className="lookup-paid">
          <label className="lookup-paid-label" htmlFor="paid">
            <span className="micro">Already booked? What you paid</span>
            <span className="lookup-paid-input">
              <span aria-hidden>$</span>
              <input
                id="paid"
                inputMode="decimal"
                value={paid}
                onChange={(event) => setPaid(event.target.value)}
                placeholder="128"
                aria-describedby="paid-out"
              />
            </span>
          </label>
          <p id="paid-out" className="lookup-paid-out" aria-live="polite">
            {paidVerdict.kind === "idle" || paidVerdict.kind === "unusable" ? (
              <span className="lookup-paid-idle">{paidVerdict.note}</span>
            ) : paidVerdict.kind === "cheaper" ? (
              <>
                <Money cents={paidVerdict.delta} className="text-save" /> cheaper on{" "}
                {formatDisplayDate(preview.desiredTravelDate)} right now
              </>
            ) : paidVerdict.kind === "dearer" ? (
              <>
                <Money cents={paidVerdict.delta} /> more than you paid on{" "}
                {formatDisplayDate(preview.desiredTravelDate)} — you did well
              </>
            ) : (
              <>Exactly what you paid, on {formatDisplayDate(preview.desiredTravelDate)}.</>
            )}
          </p>
          {paidVerdict.move ? (
            <p className="lookup-paid-move">
              Moving to {formatDisplayDate(paidVerdict.move.date)} would be{" "}
              <Money cents={paidVerdict.move.saving} /> less than your own day.
            </p>
          ) : null}
        </div>
      </header>

      {span > 0 ? (
        <section
          className="fare-scale"
          role="img"
          aria-label={
            `${preview.ranked.length} fares listed, from ` +
            `${formatUsdCompact(floor)} to ${formatUsdCompact(ceiling)}` +
            (paidCents !== null
              ? `. ${preview.ranked.filter((c) => c.totalPartyPriceCents < paidCents).length} of ` +
                `them are below the ${formatUsdCompact(paidCents)} you paid.`
              : ".")
          }
        >
          <div className="fare-scale-rule">
            {/* Everything positioned by price lives on an inset track, so a
                mark at 0% and a mark at 100% are both wholly on the rule
                rather than half outside its rounded corners. */}
            <div className="fare-scale-track">
              {/* The band between the floor and what you paid. Drawn only when
                somebody has told us what they paid, and only across the part
                of the rule that is genuinely below it — it is the gap
                between two observed-or-supplied numbers, not a prediction. */}
              {paidCents !== null && paidBeyond !== "over" ? (
                <span
                  className="fare-scale-band"
                  style={{
                    insetInlineStart: 0,
                    width: `${Math.max(0, Math.min(100, at(paidCents)))}%`,
                  }}
                  aria-hidden
                />
              ) : null}
              {preview.ranked.map((candidate, index) => {
                const cents = candidate.totalPartyPriceCents;
                const best = cents === floor;
                const beatsPaid = paidCents !== null && paidBeyond !== "over" && cents < paidCents;
                return (
                  <span
                    key={`${candidate.journey.id}:${candidate.fare.id}:${index}`}
                    className={`fare-tick${best ? " is-best" : ""}${beatsPaid ? " is-under" : ""}`}
                    style={{ insetInlineStart: `${at(cents)}%` }}
                    aria-hidden
                  />
                );
              })}
              {/* What you paid, as a rule across the scale rather than a
                sentence beside it. An unlabelled dashed line on a rule of
                fare ticks reads as another fare, so it carries its own
                caption; when the figure sits outside everything observed the
                caption says that, because a marker pinned to the end of the
                rule otherwise claims a price somebody listed. */}
              {paidCents !== null ? (
                <span
                  className={`fare-scale-paid${paidBeyond === "over" ? " is-over" : ""}${
                    paidBeyond === "under" ? " is-under-all" : ""
                  }`}
                  style={{
                    insetInlineStart: `${Math.max(0, Math.min(100, at(paidCents)))}%`,
                  }}
                  aria-hidden
                >
                  <span className="fare-scale-paid-tag">
                    {paidBeyond === "over"
                      ? "you paid more than any of these"
                      : paidBeyond === "under"
                        ? "you paid less than any of these"
                        : "you paid"}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
          <div className="fare-scale-ends">
            <span className="fare-scale-end">
              <Money cents={floor} />
              <span className="micro">cheapest listed</span>
            </span>
            <span className="fare-scale-end is-high">
              <Money cents={ceiling} />
              <span className="micro">dearest listed</span>
            </span>
          </div>
        </section>
      ) : preview.ranked.length > 1 ? (
        <p className="fare-scale-flat micro">
          Every listed fare on this search is <Money cents={floor} />. There is no spread to draw.
        </p>
      ) : null}

      {/* One cell per date SEARCHED, not per date that answered.
          
          A date the provider could not read used to drop out of this strip
          entirely and reappear as a sentence below the fold, so a window
          where one of three days failed looked exactly like a window where
          that day was simply dearer — and the reader drew a conclusion
          about a day nobody had managed to look at. A gap in the data is a
          fact about the search, and it holds its position here. */}
      {preview.dates.length > 1 ? (
        <section className="lookup-when" aria-label="Cheapest by date">
          {/* "Cheapest day in this window" over a window we did not finish
              reading is a claim about dates nobody looked at. When part of
              the window went unread the heading says how much of it this
              covers, and the spread — an arithmetic fact about the whole
              range — is withheld rather than computed from the part that
              came back. */}
          <p className="micro lookup-when-head">
            {windowWasPartial(outcomes)
              ? `Cheapest of the ${outcomes.answered} ${outcomes.answered === 1 ? "day" : "days"} we could read`
              : "Cheapest day in this window"}
            {daySpread > 0 && !windowWasPartial(outcomes) ? (
              <>
                {" · "}
                <Money cents={daySpread} /> between the best and worst
              </>
            ) : null}
          </p>
          <ul className="lookup-days stagger">
            {preview.dates.map((day) => {
              const entry = preview.byDate.find(([d]) => d === day);
              const failed = preview.failedDates.includes(day);
              const unreadable = preview.unreadableDates.includes(day);
              const best = Boolean(entry && entry[1].totalPartyPriceCents === dayFloor);
              return (
                <li
                  key={day}
                  className={`lookup-day${best ? " is-best" : ""}${entry ? "" : " is-blank"}`}
                >
                  <span className="lookup-day-label micro">{formatDisplayDate(day)}</span>
                  {entry ? (
                    <span className="price">{formatUsdCompact(entry[1].totalPartyPriceCents)}</span>
                  ) : (
                    <span className="price lookup-day-none" aria-hidden>
                      —
                    </span>
                  )}
                  {/* Unreadable before failed. The two sets used to overlap,
                      so this branch was unreachable and a date the provider
                      DID answer for was labelled "not answered" — the
                      opposite claim, on the strip whose whole job is to say
                      which kind of nothing a gap was. */}
                  <span className="lookup-day-flag micro">
                    {best
                      ? dayFloorCount > 1
                        ? "cheapest · tied"
                        : "cheapest"
                      : unreadable
                        ? "unreadable"
                        : failed
                          ? "not answered"
                          : entry
                            ? ""
                            : "nothing listed"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {bucketRows.length > 1 ? (
        <section className="lookup-when" aria-label="Cheapest by time of day">
          <p className="micro lookup-when-head">
            Cheapest departure time on {formatDisplayDate(bucketDate)}
          </p>
          <ul className="lookup-days">
            {bucketRows.map(([bucket, { candidate, count }]) => (
              <li
                key={bucket}
                className={`lookup-day${
                  candidate.totalPartyPriceCents === bucketFloor ? " is-best" : ""
                }`}
              >
                <span className="lookup-day-label micro">{bucket}</span>
                <span className="price">{formatUsdCompact(candidate.totalPartyPriceCents)}</span>
                {/* The clock AND the sample size: a minimum with no count
                    behind it is a number with nothing saying how much was
                    seen, which the methodology page calls a bug. */}
                <span className="lookup-day-flag micro">
                  {formatClock(candidate.journey.departureAt)} · of {count}{" "}
                  {count === 1 ? "fare" : "fares"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="lookup-sort" role="group" aria-label="Order the fares">
        <span className="micro">Order by</span>
        {(
          [
            ["price", "cheapest"],
            ["depart", SORT_LABEL.depart!],
            ["duration", SORT_LABEL.duration!],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`chip${sort === key ? " chip-on" : ""}`}
            aria-pressed={sort === key}
            onClick={() => setSort(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <ol className="lookup-list stagger">
        {(showAll ? ordered : collapsed).map((candidate) => (
          <li key={`${candidate.journey.id}:${candidate.fare.id}`} className="lookup-row">
            <span className="price lookup-row-price">
              {formatUsdCompact(candidate.totalPartyPriceCents)}
            </span>
            <span className="lookup-row-when">
              {formatDisplayDate(candidate.journey.searchedTravelDate)}{" "}
              {/* A real space, not just the margin below.
                  Without it the text content is "Oct 15:30 PM" — the gap is
                  drawn by CSS and does not exist in the string — so it looks
                  right, reads wrong to a screen reader, and pastes wrong. */}
              <span className="lookup-row-clock">
                {formatClock(candidate.journey.departureAt)}{" "}
                <span className="lookup-row-arrow" aria-hidden>
                  →
                </span>
                <span className="sr-only"> to </span>
                {formatClock(candidate.journey.arrivalAt)}
              </span>
            </span>
            <span className="lookup-row-train">
              {trainLabel(candidate)}
              {/* Duration and cost-per-hour were in the data and on no
                  screen. Both are arithmetic on observations — a departure
                  and an arrival, a fare and a duration — so both are things
                  this product is allowed to state, and the second is the
                  only number that makes a $91 four-hour train and a $141
                  three-hour one comparable at a glance. */}
              <span className="lookup-row-meta micro">
                {formatDurationMinutes(candidate.journey.durationMinutes) ?? "duration unknown"}
                {centsPerHour(candidate.totalPartyPriceCents, candidate.journey.durationMinutes) !=
                null ? (
                  <>
                    {" · "}
                    {formatUsdPerHour(
                      centsPerHour(
                        candidate.totalPartyPriceCents,
                        candidate.journey.durationMinutes,
                      )!,
                    )}
                    /hr
                  </>
                ) : null}
              </span>
            </span>
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

      {preview.ranked.length > VISIBLE_ROWS ? (
        <button
          type="button"
          className="lookup-more"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {/* "Show the cheapest 12" was the label of the COLLAPSE action and
              was false under every ordering but price: it collapsed to the
              twelve earliest, or the twelve shortest. The label names the
              ordering it is actually about to apply. */}
          {showAll
            ? `Show the first ${VISIBLE_ROWS} by ${SORT_LABEL[sort] ?? "price"}`
            : `Show all ${preview.ranked.length} listed fares`}
        </button>
      ) : null}

      <Colophon preview={preview} />
    </section>
  );
}

/* The colophon: exactly what this reading was.
 *
 * Three disclaimers used to be scattered down the page — one about unread
 * dates, one about listed fares not being a booking, one in the provenance
 * toggle — each true, none of them adding up to a statement of what had
 * actually been measured. A reader could not tell a search of three dates
 * that all answered from a search of three dates where one did, and both
 * printed the same confident figure at the top.
 *
 * It rendered only on the success path, which is backwards: the states where
 * "what was actually measured" decides whether to trust the answer are
 * exactly the ones with no answer on them. A search where two of three dates
 * were refused and the third was empty looked identical to a clean reading
 * of three empty dates — both just said "Nothing listed".
 *
 * Counts and verbatim fields only. Every number here is something the search
 * did, not something inferred from it, and `failureReason` is printed in the
 * provider's own words or the line is absent — paraphrasing an error is how
 * "we were blocked" becomes "nothing was listed".
 */
function Colophon({ preview }: { preview: FarePreview }) {
  const outcomes = dateOutcomes(preview);
  return (
    <>
      <dl className="colophon">
        <div>
          <dt className="micro">Dates requested</dt>
          <dd>{preview.dates.length}</dd>
        </div>
        {/* The four outcomes partition the dates requested, exactly once
            each. They did not: unreadable dates were counted again as
            unanswered, and a date that answered with an empty board fell
            through every row, so three dates could render as four outcomes
            with one of them unexplained. A reader who subtracts is entitled
            to get zero. */}
        <div>
          <dt className="micro">Answered with fares</dt>
          <dd>{outcomes.answered}</dd>
        </div>
        {outcomes.empty > 0 ? (
          <div>
            <dt className="micro">Nothing listed</dt>
            <dd className="colophon-gap">{outcomes.empty}</dd>
          </div>
        ) : null}
        {outcomes.failed > 0 ? (
          <div>
            <dt className="micro">Not answered</dt>
            <dd className="colophon-gap">{outcomes.failed}</dd>
          </div>
        ) : null}
        {outcomes.unreadable > 0 ? (
          <div>
            <dt className="micro">Unreadable</dt>
            <dd className="colophon-gap">{outcomes.unreadable}</dd>
          </div>
        ) : null}
        <div>
          <dt className="micro">Fares seen</dt>
          <dd>{preview.ranked.length}</dd>
        </div>
        <div>
          <dt className="micro">Read at</dt>
          {/* An instant, not a naive-local departure time: formatClock would
              print the UTC hour as if it were the reader's. */}
          <dd>{formatInstantClock(preview.checkedAt)}</dd>
        </div>
      </dl>

      {preview.failureReason ? (
        <p className="lookup-note colophon-why">{preview.failureReason}</p>
      ) : null}

      <p className="lookup-note">
        Listed fares, not a booking — confirm on Amtrak. A date that could not be read is unknown,
        not empty.
      </p>
    </>
  );
}
