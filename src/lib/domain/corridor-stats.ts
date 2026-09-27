/* What a corridor costs, from every search the product has ever run on it.
 *
 * The weakest moment in RailDrop is the first one. You book a ticket, you tell
 * us what you paid, we scrape for twenty seconds, and then we say "we have no
 * price history for this trip yet — this is the first look" and hand you a
 * low-confidence recommendation. Meanwhile the product has been scraping that
 * exact corridor three times a day for somebody else all week and throwing the
 * numbers away, because a watch only ever knew about itself.
 *
 * This is the shared half. It answers the question a single watch cannot:
 * **is what I paid any good?** — which is the question every traveler actually
 * has, and the one the product has never once addressed.
 *
 * Three things it is careful about.
 *
 * It is a description, never a prediction. "This corridor has run $47 to $133"
 * is a fact about observations we made. "It will drop again" is not, and
 * nothing here says anything like it.
 *
 * It says what the number is made of. A corridor summary mixes travel dates,
 * days of the week and times of booking, so it describes the route rather than
 * any particular departure. Presenting it as "the price of your train" would be
 * a different and false claim, so the copy says which it is.
 *
 * It refuses to speak from too little. Four observations is not a distribution,
 * and a percentile from them is a number with a decimal point and no meaning.
 * Below the floor it returns null and the UI says nothing rather than
 * something impressive.
 */

export interface CorridorObservation {
  at: string;
  travelDate: string;
  cheapestPriceCents: number;
}

export interface CorridorStats {
  /** Observations that survived cleaning. */
  count: number;
  /** Distinct travel dates behind them — the breadth of the sample. */
  dates: number;
  /** Days between the oldest and newest observation. */
  spanDays: number;
  low: number;
  p25: number;
  median: number;
  p75: number;
  high: number;
  newest: string;
  oldest: string;
}

/**
 * Below this, say nothing.
 *
 * Twelve is not a statistically motivated number; it is roughly four days of
 * checking at three a day, which is the point where a range stops being a
 * coincidence of when we happened to look. Being wrong here is cheap in one
 * direction (we stay quiet) and expensive in the other (we tell someone they
 * overpaid on the strength of five readings).
 */
export const MIN_OBSERVATIONS = 12;

export function summarizeCorridor(
  observations: readonly CorridorObservation[],
): CorridorStats | null {
  const clean = observations.filter(
    (observation) =>
      Number.isFinite(observation.cheapestPriceCents) &&
      observation.cheapestPriceCents > 0 &&
      Number.isFinite(Date.parse(observation.at)),
  );
  if (clean.length < MIN_OBSERVATIONS) return null;

  const prices = clean.map((observation) => observation.cheapestPriceCents).sort((a, b) => a - b);
  const times = clean.map((observation) => Date.parse(observation.at)).sort((a, b) => a - b);
  const oldest = times[0]!;
  const newest = times[times.length - 1]!;

  return {
    count: clean.length,
    dates: new Set(clean.map((observation) => observation.travelDate)).size,
    spanDays: Math.max(0, Math.round((newest - oldest) / 86_400_000)),
    low: prices[0]!,
    p25: percentile(prices, 0.25),
    median: percentile(prices, 0.5),
    p75: percentile(prices, 0.75),
    high: prices[prices.length - 1]!,
    newest: new Date(newest).toISOString(),
    oldest: new Date(oldest).toISOString(),
  };
}

export type Standing = "well-below" | "below" | "typical" | "above" | "well-above";

export interface FareStanding {
  standing: Standing;
  /** 0–100. Where this fare sits among what we have seen. */
  percentile: number;
  /** One sentence, in the second person, about their own money. */
  verdict: string;
  /** What the number is made of, so the verdict can be judged. */
  basis: string;
}

/**
 * Where a fare sits in what this corridor has actually cost.
 *
 * The percentile is of observations, not of trains: each observation is one
 * search's cheapest fare, so "the 80th percentile" means "dearer than the
 * cheapest fare on 80% of the occasions we looked". That is the comparison a
 * traveler wants — what could I have paid — rather than a comparison against
 * every seat on every train.
 */
export function fareStanding(paidCents: number, stats: CorridorStats): FareStanding {
  const percentile = Math.round(shareAtOrBelow(paidCents, stats) * 100);
  const standing: Standing =
    percentile <= 10
      ? "well-below"
      : percentile <= 35
        ? "below"
        : percentile <= 65
          ? "typical"
          : percentile <= 90
            ? "above"
            : "well-above";

  const basis = `From ${stats.count} checks of this route across ${stats.dates} travel ${
    stats.dates === 1 ? "date" : "dates"
  }, over ${stats.spanDays === 0 ? "less than a day" : `${stats.spanDays} days`}. It describes the route, not your particular train.`;

  return { standing, percentile, basis, verdict: verdictFor(standing, paidCents, stats) };
}

function verdictFor(standing: Standing, paidCents: number, stats: CorridorStats): string {
  const paid = usd(paidCents);
  const median = usd(stats.median);
  const low = usd(stats.low);
  const high = usd(stats.high);
  switch (standing) {
    case "well-below":
      return `${paid} is at the cheap end of what we have seen this route go for — it has run ${low} to ${high}, typically around ${median}. You did well.`;
    case "below":
      return `${paid} is below what this route usually goes for. We have seen it between ${low} and ${high}, typically around ${median}.`;
    case "typical":
      return `${paid} is about what this route usually costs. We have seen it between ${low} and ${high}, typically around ${median}.`;
    case "above":
      return `${paid} is above what this route usually goes for — typically around ${median}, and as low as ${low}. Worth watching.`;
    case "well-above":
      /* The most useful and least comfortable thing this module says, so it says
       * it plainly and then says the one useful thing about it. */
      return `${paid} is near the top of what we have ever seen this route cost. It has gone as low as ${low} and typically sits around ${median}. That is worth knowing before you travel again, whatever happens to this trip.`;
  }
}

/**
 * How much of what we saw was at or below this price.
 *
 * Linear interpolation between the bracketing observations rather than a rank,
 * so two fares a dollar apart do not land on the same percentile just because
 * the sample is small.
 */
function shareAtOrBelow(cents: number, stats: CorridorStats): number {
  if (cents <= stats.low) return 0;
  if (cents >= stats.high) return 1;
  // Piecewise through the quartiles, which is all the shape we keep.
  const points: Array<[number, number]> = [
    [stats.low, 0],
    [stats.p25, 0.25],
    [stats.median, 0.5],
    [stats.p75, 0.75],
    [stats.high, 1],
  ];
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1]!;
    const [x1, y1] = points[index]!;
    if (cents <= x1) {
      if (x1 === x0) return y1;
      return y0 + ((cents - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
}

/**
 * How much a corridor summary is worth as evidence about one trip.
 *
 * Used to lift a brand-new watch out of "we have looked once" without
 * pretending the two kinds of evidence are the same: the corridor describes the
 * route over weeks, the watch describes this departure over hours. A wide
 * sample of the route is real evidence about what is possible; it is weak
 * evidence about tomorrow morning's train.
 */
export function corridorEvidence(
  stats: CorridorStats | null | undefined,
): "none" | "some" | "good" {
  if (!stats) return "none";
  if (stats.count >= 40 && stats.spanDays >= 5) return "good";
  return "some";
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return Math.round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower));
}

function usd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toFixed(2)}`;
}
