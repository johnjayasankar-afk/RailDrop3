/* The shape of what was listed, as order statistics on the observed fares.
 *
 * The rule under the headline draws every fare as a tick, so the shape is
 * visible — a lone mark at the floor, or a wall of them at the top — but
 * nothing says what the shape IS, and the eye cannot count forty ticks.
 *
 * Every figure here is an order statistic of prices a provider was observed
 * listing: a value from the set, or a boundary between two values from the
 * set. None of them is an average, a model, or a claim about this route in
 * general. The methodology page requires the sample size to travel with the
 * number — "If a number appears without something next to it saying how much
 * was seen, that is a bug" — so `count` is part of the result and the caller
 * is expected to print it.
 *
 * The median and the quartiles use the nearest-rank method, which returns an
 * element OF the sample rather than interpolating between two. That matters
 * here beyond pedantry: interpolation would put a price on screen that
 * nobody listed, which is the one thing this product does not do.
 */
export interface FareDistribution {
  /** How many fares this was computed from. Always printed beside it. */
  count: number;
  /** How many different prices those fares took. */
  distinct: number;
  low: number;
  high: number;
  /** Nearest-rank median: a fare that was actually listed. */
  median: number;
  /** The quartile boundaries, each an observed fare. */
  lowerQuartile: number;
  upperQuartile: number;
  /** How many fares sit at the lowest price. "The floor is one train" matters. */
  atFloor: number;
  /* How many fares fall between the quartile boundaries, counted — not the
     fraction the boundaries imply.
     "middle half $141 to $211" asserts that half the fares are in there, and
     under ties it is simply false: one fare at $91, thirty at $167 and three
     at $302 gives lowerQuartile === median === upperQuartile === $167, so
     the line read "middle half $167 to $167" about 30 of 34 fares. The
     methodology page forbids exactly this — a described pattern must be a
     count of what was observed. */
  inMiddle: number;
}

/** Nearest-rank: returns an element of `sorted`, never a value between two. */
function atPercentile(sorted: number[], fraction: number): number {
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1]!;
}

export function fareDistribution(pricesCents: number[]): FareDistribution | null {
  const sorted = pricesCents.filter((cents) => cents > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const low = sorted[0]!;
  return {
    count: sorted.length,
    distinct: new Set(sorted).size,
    low,
    high: sorted[sorted.length - 1]!,
    median: atPercentile(sorted, 0.5),
    lowerQuartile: atPercentile(sorted, 0.25),
    upperQuartile: atPercentile(sorted, 0.75),
    atFloor: sorted.filter((cents) => cents === low).length,
    inMiddle: sorted.filter(
      (cents) => cents >= atPercentile(sorted, 0.25) && cents <= atPercentile(sorted, 0.75),
    ).length,
  };
}
