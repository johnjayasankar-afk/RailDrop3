"use client";

import { useCallback, useMemo, useState } from "react";
import { StationField } from "@/components/station-field";
import { DateField } from "@/components/date-field";
import { formatUsdCompact } from "@/lib/domain/money";
import { formatDisplayDate } from "@/lib/domain/calendar";
import { formatClock } from "@/lib/domain/timezone";
import { trainLabel } from "@/lib/domain/board-decision";
import { centsPerHour } from "@/lib/domain/board-tools";
import { formatDurationMinutes } from "@/lib/domain/calendar";
import { FareProvenance } from "@/components/fare-provenance";
import { Money } from "@/components/money";
import type { DateProgress, FarePreview } from "@/lib/fares/preview-fares";
import { sharedSearchHref, type SharedSearch } from "@/lib/domain/share-search";
import { cheapestByBucket } from "@/lib/domain/board-insights";
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

      <Results state={state} passengers={passengers} />
    </div>
  );
}

/** Rows shown before the list asks to be expanded. */
const VISIBLE_ROWS = 12;

function Results({ state, passengers }: { state: State; passengers: number }) {
  const cheapest = useMemo(
    () => (state.status === "done" ? state.preview.ranked[0] : undefined),
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
  const dayPrices = preview.byDate.map(([, candidate]) => candidate.totalPartyPriceCents);
  const dayFloor = dayPrices.length ? Math.min(...dayPrices) : 0;
  const dayCeiling = dayPrices.length ? Math.max(...dayPrices) : 0;
  /* Only worth saying when the days actually differ. A "spread" of zero is a
     sentence that sounds like advice and contains none. */
  const daySpread = dayCeiling - dayFloor;
  const cheapestDay = preview.byDate.find(
    ([, candidate]) => candidate.totalPartyPriceCents === dayFloor,
  );
  const buckets = cheapestByBucket(preview.ranked);
  const bucketRows = (["morning", "afternoon", "evening"] as const)
    .map((bucket) => [bucket, buckets[bucket]] as const)
    .filter((row): row is readonly [TimeBucket, RankedCandidate] => row[1] != null);
  const bucketFloor = bucketRows.length
    ? Math.min(...bucketRows.map(([, c]) => c.totalPartyPriceCents))
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

  const paidCents = Math.round(Number(paid) * 100);
  const paidIsReal = Number.isFinite(paidCents) && paidCents > 0;
  const delta = paidIsReal ? paidCents - cheapest!.totalPartyPriceCents : null;

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
            {delta === null ? (
              <span className="lookup-paid-idle">Type it to compare against the live board.</span>
            ) : delta > 0 ? (
              <>
                <Money cents={delta} className="text-save" /> cheaper now
              </>
            ) : delta < 0 ? (
              <>
                <Money cents={-delta} /> more than you paid — you did well
              </>
            ) : (
              <>Exactly what you paid.</>
            )}
          </p>
        </div>
      </header>

      {span > 0 ? (
        <section
          className="fare-scale"
          role="img"
          aria-label={
            `${preview.ranked.length} fares listed, from ` +
            `${formatUsdCompact(floor)} to ${formatUsdCompact(ceiling)}` +
            (delta !== null && delta > 0
              ? `. ${preview.ranked.filter((c) => c.totalPartyPriceCents < paidCents).length} of ` +
                `them are below the ${formatUsdCompact(paidCents)} you paid.`
              : ".")
          }
        >
          <div className="fare-scale-rule">
            {/* The band between the floor and what you paid. Drawn only when
                somebody has told us what they paid, and only across the part
                of the rule that is genuinely below it — it is the gap
                between two observed-or-supplied numbers, not a prediction. */}
            {delta !== null && delta > 0 ? (
              <span
                className="fare-scale-band"
                style={{ insetInlineStart: 0, width: `${Math.min(100, at(paidCents))}%` }}
                aria-hidden
              />
            ) : null}
            {preview.ranked.map((candidate, index) => {
              const cents = candidate.totalPartyPriceCents;
              const best = cents === floor;
              const beatsPaid = delta !== null && delta > 0 && cents < paidCents;
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
                sentence beside it. Clamped, and said so, when it sits
                outside everything we saw. */}
            {delta !== null ? (
              <span
                className={`fare-scale-paid${paidCents > ceiling ? " is-over" : ""}${
                  paidCents < floor ? " is-under-all" : ""
                }`}
                style={{
                  insetInlineStart: `${Math.max(0, Math.min(100, at(paidCents)))}%`,
                }}
                aria-hidden
              />
            ) : null}
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
          <p className="micro lookup-when-head">
            Cheapest day in this window
            {daySpread > 0 ? (
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
                  <span className="lookup-day-flag micro">
                    {best
                      ? "cheapest"
                      : failed
                        ? "not answered"
                        : unreadable
                          ? "unreadable"
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
          <p className="micro lookup-when-head">Cheapest departure time</p>
          <ul className="lookup-days">
            {bucketRows.map(([bucket, candidate]) => (
              <li
                key={bucket}
                className={`lookup-day${
                  candidate.totalPartyPriceCents === bucketFloor ? " is-best" : ""
                }`}
              >
                <span className="lookup-day-label micro">{bucket}</span>
                <span className="price">{formatUsdCompact(candidate.totalPartyPriceCents)}</span>
                <span className="lookup-day-flag micro">
                  {formatClock(candidate.journey.departureAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ol className="lookup-list stagger">
        {(showAll ? preview.ranked : preview.ranked.slice(0, VISIBLE_ROWS)).map((candidate) => (
          <li key={`${candidate.journey.id}:${candidate.fare.id}`} className="lookup-row">
            <span className="price lookup-row-price">
              {formatUsdCompact(candidate.totalPartyPriceCents)}
            </span>
            <span className="lookup-row-when">
              {formatDisplayDate(candidate.journey.searchedTravelDate)}
              <span className="lookup-row-clock">
                {formatClock(candidate.journey.departureAt)}
                <span className="lookup-row-arrow" aria-hidden>
                  →
                </span>
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
                    {formatUsdCompact(
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
          {showAll
            ? `Show the cheapest ${VISIBLE_ROWS}`
            : `Show all ${preview.ranked.length} listed fares`}
        </button>
      ) : null}

      {/* The colophon: exactly what this reading was.
          
          Three disclaimers used to be scattered down the page — one about
          unread dates, one about listed fares not being a booking, one in
          the provenance toggle — each true, none of them adding up to a
          statement of what had actually been measured. A reader could not
          tell a search of three dates that all answered from a search of
          three dates where one did, and both printed the same confident
          figure at the top.
          
          Counts and verbatim fields only. Every number here is something
          the search did, not something inferred from it, and
          `failureReason` is printed in the provider's own words or the
          line is absent — paraphrasing an error is how "we were blocked"
          becomes "nothing was listed". */}
      <dl className="colophon">
        <div>
          <dt className="micro">Dates requested</dt>
          <dd>{preview.dates.length}</dd>
        </div>
        <div>
          <dt className="micro">Answered</dt>
          <dd>{preview.byDate.length}</dd>
        </div>
        {preview.failedDates.length > 0 ? (
          <div>
            <dt className="micro">Not answered</dt>
            <dd className="colophon-gap">{preview.failedDates.length}</dd>
          </div>
        ) : null}
        {preview.unreadableDates.length > 0 ? (
          <div>
            <dt className="micro">Unreadable</dt>
            <dd className="colophon-gap">{preview.unreadableDates.length}</dd>
          </div>
        ) : null}
        <div>
          <dt className="micro">Fares seen</dt>
          <dd>{preview.ranked.length}</dd>
        </div>
        <div>
          <dt className="micro">Read at</dt>
          <dd>{formatClock(preview.checkedAt)}</dd>
        </div>
      </dl>

      {preview.failureReason ? (
        <p className="lookup-note colophon-why">{preview.failureReason}</p>
      ) : null}

      <p className="lookup-note">
        Listed fares, not a booking — confirm on Amtrak. A date that could not be read is unknown,
        not empty.
      </p>
    </section>
  );
}
