/* Is this number believable?
 *
 * The product's promise is that it never invents a fare. It has been read as a
 * promise about fabrication — never make one up — and that half was covered:
 * nothing in the codebase synthesises a price. The other half was not. A
 * scraper that misreads a page and reports $0.42 for Boston to New York has
 * invented a fare just as surely, and the pipeline would have ranked it first,
 * shown it on the board as a $127 saving, and emailed it to the traveler. The
 * only check between a parsed number and a person's inbox was "is it a number".
 *
 * So this module asks the question the pipeline never asked. It is deliberately
 * not clever: no learned bounds, no percentile of history, nothing that needs
 * data to warm up. It encodes what is true about Amtrak — a train cannot arrive
 * before it leaves, a corridor fare is not forty cents, a journey returned for
 * a search of BOS→NYP is not a journey from Sacramento — and it rejects what
 * contradicts that.
 *
 * Two design choices worth defending.
 *
 * Rejections are counted, not swallowed. A single implausible row is a bad
 * parse of one card. Eighty per cent implausible is a broken parser, and the
 * twenty per cent that passed are not trustworthy either — they are the rows
 * whose errors happened to land inside the bounds. `searchIntegrity` is what
 * turns "we dropped some rows" into "do not believe this search".
 *
 * The bounds are wide on purpose. This is a filter against garbage, not against
 * surprise. A genuinely cheap fare is the entire point of the product, and a
 * validator that rejected a real $12 Northeast Regional to protect a promise
 * about accuracy would be the most expensive kind of wrong.
 */

import type { FareOption, JourneyOption } from "./types";

export type RejectionCode =
  | "price_missing"
  | "price_not_a_number"
  | "price_too_low"
  | "price_too_high"
  | "party_total_mismatch"
  | "arrives_before_departs"
  | "duration_too_short"
  | "duration_too_long"
  | "duration_disagrees"
  | "wrong_origin"
  | "wrong_destination"
  | "wrong_date"
  | "departs_long_before_search";

export interface Rejection {
  code: RejectionCode;
  /** One line, for a log and for docs/FAILURE_MODES.md. Never shown as a fare. */
  detail: string;
}

/* Bounds.
 *
 * Amtrak's cheapest published adult fares on short corridors sit around $5–$10;
 * below that is not a fare, it is a fee, a deposit, or a misread. The ceiling is
 * a private room on a long-distance sleeper, which can genuinely pass $2,000 —
 * so the ceiling is per traveler and generous, and exists to catch a price
 * field that picked up a phone number or a distance in metres.
 */
const MIN_PER_TRAVELER_CENTS = 300;
const MAX_PER_TRAVELER_CENTS = 500_000;

/** The Empire Builder is about 46 hours; the Sunset Limited about 48. */
const MAX_DURATION_MINUTES = 96 * 60;
/** Two stops on the same corridor. Below this, the two timestamps disagree. */
const MIN_DURATION_MINUTES = 3;
/**
 * How far a stated duration may differ from arrival minus departure.
 *
 * They come from different fields of the provider's payload and disagreeing by
 * a couple of minutes is rounding. Disagreeing by an hour means one of them
 * describes a different train, and we do not know which.
 */
const DURATION_TOLERANCE_MINUTES = 20;

export interface SanityContext {
  /** What was asked for. A result that does not answer it is not an answer. */
  originCode: string;
  destinationCode: string;
  travelDate: string;
  passengerCount: number;
}

/**
 * Every reason this observation cannot be believed. Empty means it can.
 *
 * All of them, not the first: a row that is wrong in three ways is worth
 * knowing about in three ways when someone is working out what the provider
 * broke.
 */
export function checkFare(
  journey: JourneyOption,
  fare: FareOption,
  context: SanityContext,
): Rejection[] {
  const out: Rejection[] = [];
  const add = (code: RejectionCode, detail: string) => out.push({ code, detail });

  // ── the price ───────────────────────────────────────────────────────────
  const total = fare.totalPartyPriceCents;
  if (total === null || total === undefined) {
    add("price_missing", "No total party price.");
  } else if (!Number.isFinite(total) || !Number.isInteger(total)) {
    add("price_not_a_number", `Total party price is ${String(total)}, not whole cents.`);
  } else {
    const travelers = Math.max(1, context.passengerCount);
    const perTraveler = total / travelers;
    if (perTraveler < MIN_PER_TRAVELER_CENTS) {
      add(
        "price_too_low",
        `${fmt(perTraveler)} per traveler is below the ${fmt(MIN_PER_TRAVELER_CENTS)} floor — a fee or a misread, not a fare.`,
      );
    }
    if (perTraveler > MAX_PER_TRAVELER_CENTS) {
      add(
        "price_too_high",
        `${fmt(perTraveler)} per traveler is above the ${fmt(MAX_PER_TRAVELER_CENTS)} ceiling.`,
      );
    }
    /* The party total must be the per-traveler price times the party. When the
     * provider gives both and they disagree, one of them is wrong and the board
     * ranks on the total — so it would rank on the wrong one. */
    const per = fare.pricePerTravelerCents;
    if (per != null && Number.isFinite(per) && per > 0) {
      const expected = per * travelers;
      if (Math.abs(expected - total) > travelers) {
        add(
          "party_total_mismatch",
          `${fmt(per)} × ${travelers} is ${fmt(expected)}, but the total says ${fmt(total)}.`,
        );
      }
    }
  }

  // ── the clock ───────────────────────────────────────────────────────────
  const departs = Date.parse(journey.departureAt);
  const arrives = Date.parse(journey.arrivalAt);
  if (Number.isFinite(departs) && Number.isFinite(arrives)) {
    const minutes = (arrives - departs) / 60_000;
    if (minutes < 0) {
      add(
        "arrives_before_departs",
        `Arrives ${journey.arrivalAt}, which is before it departs at ${journey.departureAt}.`,
      );
    } else if (minutes < MIN_DURATION_MINUTES) {
      add("duration_too_short", `${Math.round(minutes)} minutes end to end.`);
    } else if (minutes > MAX_DURATION_MINUTES) {
      add("duration_too_long", `${Math.round(minutes / 60)} hours end to end.`);
    }

    const stated = journey.durationMinutes;
    if (
      stated != null &&
      Number.isFinite(stated) &&
      minutes >= 0 &&
      Math.abs(stated - minutes) > DURATION_TOLERANCE_MINUTES
    ) {
      add(
        "duration_disagrees",
        `Stated ${stated} minutes, but the timestamps are ${Math.round(minutes)} apart.`,
      );
    }
  }

  // ── did it answer the question we asked ─────────────────────────────────
  if (!sameStation(journey.originCode, context.originCode)) {
    add(
      "wrong_origin",
      `Searched ${context.originCode}, got a journey from ${journey.originCode}.`,
    );
  }
  if (!sameStation(journey.destinationCode, context.destinationCode)) {
    add(
      "wrong_destination",
      `Searched ${context.destinationCode}, got a journey to ${journey.destinationCode}.`,
    );
  }
  if (journey.searchedTravelDate !== context.travelDate) {
    add(
      "wrong_date",
      `Searched ${context.travelDate}, got a journey filed under ${journey.searchedTravelDate}.`,
    );
  }
  /* A departure well before the searched day is the signature of a provider
   * answering with a cached or defaulted date. One day of slack, because a
   * sleeper that boards at 23:50 the night before is a real thing and the
   * timestamp may be in the origin's zone rather than UTC. */
  if (Number.isFinite(departs)) {
    const searchedMidnight = Date.parse(`${context.travelDate}T00:00:00Z`);
    if (Number.isFinite(searchedMidnight) && departs < searchedMidnight - 36 * 3_600_000) {
      add(
        "departs_long_before_search",
        `Departs ${journey.departureAt}, more than a day before ${context.travelDate}.`,
      );
    }
  }

  return out;
}

/** Whether this observation can be shown to a person as a fact. */
export function fareIsPlausible(
  journey: JourneyOption,
  fare: FareOption,
  context: SanityContext,
): boolean {
  return checkFare(journey, fare, context).length === 0;
}

export interface IntegrityVerdict {
  /** Whether the search as a whole can be believed. */
  trustworthy: boolean;
  kept: number;
  rejected: number;
  /** How many of each kind, worst first. For the log and the operator. */
  byCode: Array<{ code: RejectionCode; count: number }>;
  /** One sentence. Null when nothing was rejected. */
  summary: string | null;
}

/**
 * Above this share of rejected rows, stop believing the survivors.
 *
 * A broken parser does not fail uniformly: it produces some rows that are
 * obviously wrong and some whose errors happen to land inside the bounds. The
 * second kind is the dangerous one, and the only signal we have for it is how
 * many of the first kind there were.
 */
const DISTRUST_SHARE = 0.34;
/** Below this many rows, a share means nothing — one of two is fifty per cent. */
const DISTRUST_MIN_ROWS = 4;

export function searchIntegrity(
  results: ReadonlyArray<{ rejections: Rejection[] }>,
): IntegrityVerdict {
  const counts = new Map<RejectionCode, number>();
  let rejected = 0;
  for (const result of results) {
    if (result.rejections.length === 0) continue;
    rejected += 1;
    for (const rejection of result.rejections) {
      counts.set(rejection.code, (counts.get(rejection.code) ?? 0) + 1);
    }
  }
  const kept = results.length - rejected;
  const byCode = [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const share = results.length === 0 ? 0 : rejected / results.length;
  const trustworthy = !(results.length >= DISTRUST_MIN_ROWS && share > DISTRUST_SHARE);

  return {
    trustworthy,
    kept,
    rejected,
    byCode,
    summary:
      rejected === 0
        ? null
        : `${rejected} of ${results.length} listed fares failed a plausibility check (${byCode
            .map((entry) => `${entry.code}×${entry.count}`)
            .join(", ")}).`,
  };
}

/**
 * What the board says when a search could not be believed.
 *
 * Not "no cheaper fares" — that is a claim about the market, and we do not have
 * one. This is a claim about us.
 */
export function distrustNote(verdict: IntegrityVerdict): string | null {
  if (verdict.trustworthy) return null;
  return `We could not read this corridor reliably on the last check: ${verdict.rejected} of ${
    verdict.kept + verdict.rejected
  } listed fares did not make sense, so we are not showing any of them. This is a problem at our end, not a sold-out corridor.`;
}

function sameStation(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true; // Unknown is not wrong; only a contradiction is.
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function fmt(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
