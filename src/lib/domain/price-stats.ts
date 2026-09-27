import type { Cents } from './money';

/**
 * Minimum observations before any qualitative claim is made.
 *
 * Three checks is one day. Calling a price "good" on that basis would be
 * dressing up noise as a judgement, and this product's whole posture is that a
 * confident-sounding number it cannot support is worse than no number.
 */
export const MIN_OBSERVATIONS = 5;

export type PriceVerdict = 'BEST_YET' | 'GOOD' | 'TYPICAL' | 'HIGH' | 'UNKNOWN';

export interface PriceStats {
  /** Completed checks that actually returned a price. Failures are excluded. */
  observations: number;
  lowestCents: Cents | null;
  highestCents: Cents | null;
  medianCents: Cents | null;
  /**
   * Share of observed prices strictly higher than the current one, 0–1.
   * 1 means nothing we have seen was more expensive; 0 means nothing was
   * cheaper. Null when there is no current price or nothing to compare against.
   */
  betterThan: number | null;
  verdict: PriceVerdict;
  /** True only when the verdict rests on at least MIN_OBSERVATIONS prices. */
  confident: boolean;
}

const EMPTY: PriceStats = {
  observations: 0,
  lowestCents: null,
  highestCents: null,
  medianCents: null,
  betterThan: null,
  verdict: 'UNKNOWN',
  confident: false,
};

/**
 * Descriptive statistics over what this trip has actually cost.
 *
 * Deliberately **not** a prediction. It answers "is this cheap compared with
 * every price we have observed for this trip", which is a question the data can
 * answer, rather than "will it get cheaper", which it cannot. Nothing here
 * extrapolates, fits a curve, or implies a direction.
 *
 * Failed checks are excluded rather than treated as missing-at-random: a
 * provider outage says nothing about price, and letting it thin the sample
 * would quietly make every verdict less trustworthy than it looks.
 */
export function priceStats(
  history: ReadonlyArray<Cents | null>,
  currentCents: Cents | null,
): PriceStats {
  const observed = history.filter((cents): cents is Cents => cents !== null && cents >= 0);
  if (observed.length === 0) return EMPTY;

  const sorted = [...observed].sort((a, b) => a - b);
  const lowestCents = sorted[0] as Cents;
  const highestCents = sorted[sorted.length - 1] as Cents;
  const medianCents = median(sorted);

  const base: PriceStats = {
    observations: observed.length,
    lowestCents,
    highestCents,
    medianCents,
    betterThan: null,
    verdict: 'UNKNOWN',
    confident: false,
  };

  if (currentCents === null) return base;

  const higher = observed.filter((cents) => cents > currentCents).length;
  const betterThan = observed.length > 0 ? higher / observed.length : null;
  const confident = observed.length >= MIN_OBSERVATIONS;

  return {
    ...base,
    betterThan,
    confident,
    verdict: confident ? verdictFor(currentCents, lowestCents, betterThan) : 'UNKNOWN',
  };
}

function verdictFor(
  currentCents: Cents,
  lowestCents: Cents,
  betterThan: number | null,
): PriceVerdict {
  if (currentCents <= lowestCents) return 'BEST_YET';
  if (betterThan === null) return 'UNKNOWN';
  if (betterThan >= 0.7) return 'GOOD';
  if (betterThan >= 0.3) return 'TYPICAL';
  return 'HIGH';
}

function median(sorted: ReadonlyArray<Cents>): Cents {
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as Cents;
  // Even count: the mean of the two middle values, rounded to whole cents so
  // the result is still money rather than a fraction of a cent.
  return Math.round(((sorted[middle - 1] as Cents) + (sorted[middle] as Cents)) / 2);
}

/** Plain-language summary. Never states a direction the data cannot support. */
export function describeVerdict(stats: PriceStats): { label: string; detail: string } {
  switch (stats.verdict) {
    case 'BEST_YET':
      return {
        label: 'Lowest yet',
        detail: `Cheaper than every one of the ${stats.observations} prices we have seen for this trip.`,
      };
    case 'GOOD':
      return {
        label: 'Good price',
        detail: `Cheaper than ${Math.round((stats.betterThan ?? 0) * 100)}% of the prices we have seen for this trip.`,
      };
    case 'TYPICAL':
      return {
        label: 'Typical',
        detail: `About what this trip usually costs across ${stats.observations} checks.`,
      };
    case 'HIGH':
      return {
        label: 'On the high side',
        detail: `Dearer than ${Math.round((1 - (stats.betterThan ?? 0)) * 100)}% of the prices we have seen for this trip.`,
      };
    default:
      return {
        label: 'Not enough history',
        detail: `A verdict needs at least ${MIN_OBSERVATIONS} completed checks. ${stats.observations} so far.`,
      };
  }
}

export interface PriceChange {
  /** Positive means the price went down since the previous observation. */
  dropCents: Cents;
  /** The price it moved from. */
  fromCents: Cents;
  /** The price it moved to. */
  toCents: Cents;
}

/**
 * The most recent movement, comparing the last two prices we actually saw.
 *
 * Failed checks are skipped rather than treated as a change, so an outage
 * between two identical prices reports "no change" rather than inventing a
 * swing. Returns null when there is nothing to compare — one observation is a
 * price, not a movement.
 */
export function lastChange(history: ReadonlyArray<Cents | null>): PriceChange | null {
  const observed = history.filter((cents): cents is Cents => cents !== null && cents >= 0);
  if (observed.length < 2) return null;

  const toCents = observed[observed.length - 1] as Cents;
  const fromCents = observed[observed.length - 2] as Cents;
  return { dropCents: fromCents - toCents, fromCents, toCents };
}
