import type { Cents } from './money';

/**
 * The trade-off a price-ranked list hides.
 *
 * Ranking by price is right — it is what the product is for — but on a real
 * corridor the cheapest fare is routinely the slowest, and the list makes the
 * reader do the arithmetic across a dozen rows to notice. A observed example:
 * the cheapest at $62.05 takes 5h40m while $72.82 takes 3h49m. Ten dollars for
 * nearly two hours is a decision, and it should be visible without a
 * spreadsheet.
 *
 * Everything here is arithmetic over fares already fetched. Nothing is
 * predicted, and no option is reordered or hidden — the cheapest stays first.
 */

/** Below this, a difference in journey time is not worth pointing at. */
export const MEANINGFUL_MINUTES = 30;

export interface Comparable {
  totalCents: Cents;
  durationMinutes: number;
}

export interface Tradeoffs {
  /** Index of the quickest journey, or -1 when the list is empty. */
  fastestIndex: number;
  /** Minutes each option is slower than the quickest. Zero for the quickest. */
  slowerByMinutes: number[];
}

export function tradeoffs(options: readonly Comparable[]): Tradeoffs {
  if (options.length === 0) return { fastestIndex: -1, slowerByMinutes: [] };

  let fastestIndex = 0;
  for (let i = 1; i < options.length; i += 1) {
    const candidate = options[i] as Comparable;
    const best = options[fastestIndex] as Comparable;
    // Only positive durations compete; a zero or negative one is bad data, not
    // an instantaneous train.
    if (
      candidate.durationMinutes > 0 &&
      (best.durationMinutes <= 0 || candidate.durationMinutes < best.durationMinutes)
    ) {
      fastestIndex = i;
    }
  }

  const fastest = (options[fastestIndex] as Comparable).durationMinutes;
  return {
    fastestIndex,
    slowerByMinutes: options.map((option) =>
      option.durationMinutes > 0 && fastest > 0 ? Math.max(0, option.durationMinutes - fastest) : 0,
    ),
  };
}

export interface FasterAlternative {
  /** Index in the input list. */
  index: number;
  /** What it costs on top of the cheapest. */
  extraCents: Cents;
  /** How much sooner it arrives than the cheapest. */
  minutesSaved: number;
}

/**
 * The cheapest option that is meaningfully quicker than the cheapest overall.
 *
 * Deliberately the *cheapest* such option rather than the quickest: the reader
 * is being offered one alternative, and the least they can pay to escape the
 * slow one is the useful version of that offer. Returns null when the cheapest
 * fare is also fast enough that there is nothing to say — which is the common
 * case and must stay silent.
 */
export function fasterAlternative(
  options: readonly Comparable[],
  minMinutesSaved = MEANINGFUL_MINUTES,
): FasterAlternative | null {
  if (options.length < 2) return null;

  let cheapestIndex = 0;
  for (let i = 1; i < options.length; i += 1) {
    if ((options[i] as Comparable).totalCents < (options[cheapestIndex] as Comparable).totalCents) {
      cheapestIndex = i;
    }
  }

  const cheapest = options[cheapestIndex] as Comparable;
  if (cheapest.durationMinutes <= 0) return null;

  let best: FasterAlternative | null = null;
  for (const [index, option] of options.entries()) {
    if (index === cheapestIndex) continue;
    if (option.durationMinutes <= 0) continue;

    const minutesSaved = cheapest.durationMinutes - option.durationMinutes;
    if (minutesSaved < minMinutesSaved) continue;

    const extraCents = option.totalCents - cheapest.totalCents;
    // A cheaper *and* faster option means the list is not price-ranked the way
    // this assumes; say nothing rather than something confusing.
    if (extraCents <= 0) return null;

    if (best === null || extraCents < best.extraCents) {
      best = { index, extraCents, minutesSaved };
    }
  }

  return best;
}
