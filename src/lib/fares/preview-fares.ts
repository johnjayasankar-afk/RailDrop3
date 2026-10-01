/* Fares, with no database involved at all.
 *
 * The product's promise is "here are the live Amtrak fares for your trip". It
 * does not need a database to keep that promise — the scraper does the work and
 * the ranking is pure. But every path to a price went through creating a watch
 * first, so when the Supabase project behind a deployment stopped existing, the
 * app could not show anybody a single fare. The scraper was healthy the whole
 * time. We were just refusing to look until we had somewhere to write it down.
 *
 * This is the path that does not write anything. It is the fallback when the
 * database is unreachable, and it is also just a reasonable thing to want: the
 * price now, without committing to watch it.
 *
 * What it deliberately does not do: pretend. Nothing is saved, no alert will
 * come, and the caller is expected to say so. A preview that looked like a
 * watch would be worse than the error it replaces.
 */

import { generateSearchDates } from "@/lib/domain/calendar";
import { collectEligibleFares } from "@/lib/domain/eligibility";
import { screenJourneys } from "@/lib/domain/fare-screen";
import { cheapestByDate, rankCandidates } from "@/lib/domain/ranking";
import { localIsoDate, isValidTimeZone } from "@/lib/domain/timezone";
import { logger } from "@/lib/logger";
import type { FareProvider } from "@/lib/providers/fare-provider";
import type { JourneyOption, RankedCandidate } from "@/lib/domain/types";
import { previewFaresSchema, type PreviewFaresInput } from "@/lib/validation/fares";

/**
 * One date, the moment it finishes.
 *
 * The search walks its window one date at a time, so the first answer exists
 * seconds in and the last can be half a minute later. Holding all of it back
 * until the slowest date returns is throwing away information the caller
 * already has — and on a page where somebody is watching a bar, that is most
 * of the wait.
 *
 * Deliberately small. It is a progress report, not a second copy of the board:
 * the authoritative ranking still comes from the finished FarePreview, because
 * ranking across dates cannot be done a date at a time.
 */
export interface DateProgress {
  travelDate: string;
  /** 1-based, for "2 of 3" without the caller counting. */
  index: number;
  total: number;
  outcome: "fares" | "empty" | "failed" | "unreadable";
  /** Cheapest believable total on this date, or null when there was none. */
  cheapestCents: number | null;
  journeys: number;
}

export interface FarePreview {
  originCode: string;
  destinationCode: string;
  /** Dates actually searched, after past ones were dropped. */
  dates: string[];
  /* The date the reader actually asked about, as opposed to the cheapest one
     in the window. Without it the result cannot tell "the cheapest fare we
     saw" apart from "the cheapest fare on your trip", and every comparison
     drawn against the window minimum quietly described a different journey
     from the one the reader booked. */
  desiredTravelDate: string;
  ranked: RankedCandidate[];
  /** Cheapest on each date, for the strip. */
  byDate: Array<[string, RankedCandidate]>;
  /** Dates the provider could not answer for. */
  failedDates: string[];
  /** Dates we reached and could not parse. Different from never answered. */
  unreadableDates: string[];
  /**
   * Why the search failed, in the provider's own already-sanitized words.
   *
   * Without this the board could only say "the fare search did not get through",
   * which is true of a bot block, a timeout and a parser failure alike — three
   * things with three different answers. The reader was told the least useful
   * one of the three.
   */
  failureReason: string | null;
  checkedAt: string;
}

/**
 * How many dates a search will scrape.
 *
 * This was 3, which was the right number when a preview was the cheap
 * unauthenticated taster and a saved watch did the full sweep later. There is
 * no watch any more — this search is the product — and the leftover cap had
 * turned the "±2 days" control into a lie: a five-date window was trimmed
 * back to three, while the form said "searching ±2 days" and the picker lit
 * five days in the calendar. The reader chose a wider window, was shown a
 * wider window, and got the narrower one.
 *
 * Five is the widest window the interface can ask for, so nothing the reader
 * can select is silently trimmed. trimAround still guards the invariant for
 * any caller that asks for more.
 */
const MAX_PREVIEW_DATES = 5;

export async function previewFares(input: {
  body: unknown;
  provider: FareProvider;
  now?: Date;
  /**
   * Called as each date lands, before the whole window is done.
   *
   * Optional, and never awaited: a caller that is slow to render must not
   * slow the search down, and one that throws must not lose a window that was
   * otherwise fine.
   */
  onProgress?: (progress: DateProgress) => void;
  /**
   * Abandoned by the reader.
   *
   * Each date drives a real headless browser at a real provider, and the
   * stream route's only reaction to a closed connection was to stop writing
   * — the scrape kept going through every remaining date, for up to the
   * route's full five-minute budget, on work nobody would ever see. Checked
   * between dates, which is where the expensive part begins.
   */
  signal?: AbortSignal;
}): Promise<FarePreview> {
  const parsed: PreviewFaresInput = previewFaresSchema.parse(input.body);
  if (parsed.originCode === parsed.destinationCode) {
    throw new Error("Origin and destination must differ");
  }
  const timezone = isValidTimeZone(parsed.timezone) ? parsed.timezone : "America/New_York";
  const now = input.now ?? new Date();
  const today = localIsoDate(now, timezone);

  const window = generateSearchDates(parsed.desiredTravelDate, parsed.dateFlexibilityDays, today);
  if (window.dates.length === 0) {
    throw new Error("All dates in the travel window have already passed");
  }
  /* Centred on the date they actually asked for. Trimming from the ends would
   * be arbitrary; trimming to the requested date and its nearest neighbours is
   * the answer to the question they asked. */
  const dates = trimAround(window.dates, parsed.desiredTravelDate, MAX_PREVIEW_DATES);

  const journeys: JourneyOption[] = [];
  const failedDates: string[] = [];
  const unreadableDates: string[] = [];
  /** First real reason seen. The first is the useful one: the rest repeat it. */
  let failureReason: string | null = null;

  /* Sequential. A preview is one person waiting, not a scheduled sweep, and the
   * provider's own page limit would serialise it anyway. */
  for (const [index, travelDate] of dates.entries()) {
    /* The reader has gone. Stop before paying for the next date; what has
       already landed is still returned, so a caller holding the promise gets
       a partial window rather than an exception. */
    if (input.signal?.aborted) {
      for (const remaining of dates.slice(index)) failedDates.push(remaining);
      break;
    }
    const result = await input.provider.searchTrips({
      originCode: parsed.originCode,
      destinationCode: parsed.destinationCode,
      travelDate,
      passengers: { adultCount: parsed.passengerCount },
    });
    if (result.status === "PROVIDER_ERROR") {
      failedDates.push(travelDate);
      failureReason ??= result.providerError?.message ?? null;
      report(input.onProgress, {
        travelDate,
        index: index + 1,
        total: dates.length,
        outcome: "failed",
        cheapestCents: null,
        journeys: 0,
      });
      /* A block is a fact about us, not about this date.
       *
       * Every date goes to the same host from the same address, so once we are
       * refused, the remaining dates will be refused identically. Trying them
       * anyway spends the request's whole budget re-proving it and the traveler
       * ends up with a killed request and a blank screen instead of a sentence.
       * They are recorded as failed, because they were not searched. */
      if (isRefusal(failureReason)) {
        for (const remaining of dates.slice(index + 1)) failedDates.push(remaining);
        break;
      }
      continue;
    }
    // The same screening a real cycle applies. A preview must not be the one
    // surface where an implausible fare gets through.
    const screened = screenJourneys(result.journeys, {
      originCode: parsed.originCode,
      destinationCode: parsed.destinationCode,
      travelDate,
      passengerCount: parsed.passengerCount,
    });
    if (!screened.verdict.trustworthy) {
      /* Unreadable only, never also failed.
       *
       * This pushed the date into BOTH arrays, which made the two outcomes
       * overlap and every count drawn from them wrong: one bad date out of
       * three rendered as "Answered 2 · Not answered 1 · Unreadable 1" —
       * four outcomes for three dates, with the same date claimed twice. It
       * also made the strip's "unreadable" branch unreachable, because the
       * code tests `failed` first and `failed` was always true whenever
       * `unreadable` was, so a date the provider DID answer for was labelled
       * "not answered". Those are opposite claims, and telling them apart is
       * the thing the methodology page promises in the reader's defence.
       *
       * The two sets are disjoint. "Did not produce a fare" is their union
       * where a caller needs it. */
      unreadableDates.push(travelDate);
      report(input.onProgress, {
        travelDate,
        index: index + 1,
        total: dates.length,
        outcome: "unreadable",
        cheapestCents: null,
        journeys: screened.journeys.length,
      });
      continue;
    }
    journeys.push(...screened.journeys);
    /* The cheapest fare on this date that the board would actually offer.
     *
     * Through the same eligibility filter the finished window uses, not simply
     * the lowest number on the page. Without it a progress line could show $49
     * from a restricted or unavailable fare and the board settle at $74 a
     * moment later — a price that appears and then withdraws is the same
     * broken promise as one that was never there.
     *
     * Still not the ranking: ordering across dates is a comparison between
     * them and cannot be done a date at a time. */
    const cheapestHere = collectEligibleFares(screened.journeys, {
      includeRestrictedFares: parsed.includeRestrictedFares,
      includeThruway: parsed.includeThruway,
      travelClass: "COACH",
      requireAvailable: true,
    })
      .map((item) => item.fare.totalPartyPriceCents)
      .filter((cents): cents is number => typeof cents === "number" && cents > 0)
      .sort((a, b) => a - b)[0];
    report(input.onProgress, {
      travelDate,
      index: index + 1,
      total: dates.length,
      outcome: screened.journeys.length > 0 ? "fares" : "empty",
      cheapestCents: cheapestHere ?? null,
      journeys: screened.journeys.length,
    });
  }

  const eligible = collectEligibleFares(journeys, {
    includeRestrictedFares: parsed.includeRestrictedFares,
    includeThruway: parsed.includeThruway,
    travelClass: "COACH",
    requireAvailable: true,
  });
  const ranked = rankCandidates(eligible, {
    desiredTravelDate: parsed.desiredTravelDate,
    preferredDepartureTime: null,
    /* Zero, not their booking. A preview ranks by price because there is no
     * booking to compare against yet — passing one would compute "savings"
     * against a number that is not a reservation. */
    currentBookedPriceCents: 0,
  });

  logger.info("fares.preview", {
    origin: parsed.originCode,
    destination: parsed.destinationCode,
    dates: dates.length,
    failed: failedDates.length,
    unreadable: unreadableDates.length,
    found: ranked.length,
  });

  return {
    originCode: parsed.originCode,
    destinationCode: parsed.destinationCode,
    dates,
    ranked,
    byDate: [...cheapestByDate(ranked).entries()],
    failedDates,
    unreadableDates,
    failureReason,
    desiredTravelDate: parsed.desiredTravelDate,
    checkedAt: now.toISOString(),
  };
}

/** The requested date plus its nearest neighbours, up to `max`. */
function trimAround(dates: string[], wanted: string, max: number): string[] {
  if (dates.length <= max) return dates;
  const centre = Math.max(0, dates.indexOf(wanted));
  const picked = [dates[centre]!];
  for (let step = 1; picked.length < max; step += 1) {
    const before = dates[centre - step];
    const after = dates[centre + step];
    if (after && picked.length < max) picked.push(after);
    if (before && picked.length < max) picked.unshift(before);
    if (!before && !after) break;
  }
  return picked;
}

/**
 * Whether a provider message means "we were refused", as opposed to "this date
 * did not work out".
 *
 * Matched on the sanitized text the provider already produces, so it stays in
 * step with what the reader is shown.
 */
function isRefusal(message: string | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("blocked") || lower.includes("bot check") || lower.includes("just a moment")
  );
}

/**
 * Hand a progress report to the caller without letting it affect the search.
 *
 * Never awaited and never allowed to throw: a slow renderer must not slow the
 * provider down, and a caller that blows up on one date must not cost the
 * traveller the rest of the window.
 */
function report(
  onProgress: ((progress: DateProgress) => void) | undefined,
  progress: DateProgress,
): void {
  if (!onProgress) return;
  try {
    onProgress(progress);
  } catch (error) {
    logger.warn("fares.progress_listener_failed", {
      travelDate: progress.travelDate,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
