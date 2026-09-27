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
import { previewFaresSchema, type PreviewFaresInput } from "@/lib/validation/watch";

export interface FarePreview {
  originCode: string;
  destinationCode: string;
  /** Dates actually searched, after past ones were dropped. */
  dates: string[];
  ranked: RankedCandidate[];
  /** Cheapest on each date, for the strip. */
  byDate: Array<[string, RankedCandidate]>;
  /** Dates the provider could not answer for. */
  failedDates: string[];
  /** Dates we reached and could not parse. Different from never answered. */
  unreadableDates: string[];
  checkedAt: string;
}

/**
 * How many dates a preview will scrape.
 *
 * Lower than a watch's window on purpose. A preview is unauthenticated work
 * that costs provider credits and happens while somebody waits, so it buys the
 * answer to "what does this cost" rather than the full flexibility sweep. The
 * watch does the sweep once it exists.
 */
const MAX_PREVIEW_DATES = 3;

export async function previewFares(input: {
  body: unknown;
  provider: FareProvider;
  now?: Date;
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

  /* Sequential. A preview is one person waiting, not a scheduled sweep, and the
   * provider's own page limit would serialise it anyway. */
  for (const travelDate of dates) {
    const result = await input.provider.searchTrips({
      originCode: parsed.originCode,
      destinationCode: parsed.destinationCode,
      travelDate,
      passengers: { adultCount: parsed.passengerCount },
    });
    if (result.status === "PROVIDER_ERROR") {
      failedDates.push(travelDate);
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
      unreadableDates.push(travelDate);
      failedDates.push(travelDate);
      continue;
    }
    journeys.push(...screened.journeys);
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
