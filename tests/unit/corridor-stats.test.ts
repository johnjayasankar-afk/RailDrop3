import { describe, expect, it } from "vitest";
import {
  MIN_OBSERVATIONS,
  corridorEvidence,
  fareStanding,
  summarizeCorridor,
  type CorridorObservation,
} from "@/lib/domain/corridor-stats";

/* The shared half of the product.
 *
 * A watch only ever knew about itself, so the first thing a new one said was
 * "we have no price history for this trip yet" — while the product had been
 * scraping that corridor three times a day for somebody else all week. This
 * answers the question a single watch cannot: is what I paid any good?
 */

const DAY = 86_400_000;
const base = Date.parse("2026-09-27T12:00:00.000Z");

/** n observations at the given prices, spread backwards one per six hours. */
function series(prices: number[], travelDates?: string[]): CorridorObservation[] {
  return prices.map((cheapestPriceCents, index) => ({
    at: new Date(base - (prices.length - 1 - index) * 6 * 3_600_000).toISOString(),
    travelDate: travelDates?.[index % travelDates.length] ?? "2026-10-09",
    cheapestPriceCents,
  }));
}

/** A realistic corridor: mostly around $70, occasionally cheap, occasionally dear. */
const typical = series([
  4_700, 5_200, 6_000, 6_400, 6_800, 7_100, 7_200, 7_400, 7_900, 8_600, 9_900, 13_300,
]);

describe("refusing to speak from too little", () => {
  it("says nothing below the floor", () => {
    // A percentile from five readings is a number with a decimal point and no
    // meaning. Staying quiet is cheap; being wrong is not.
    expect(summarizeCorridor(series([4_700, 5_000, 6_000, 7_000, 8_000]))).toBeNull();
    expect(summarizeCorridor([])).toBeNull();
  });

  it("speaks at exactly the floor", () => {
    expect(series(Array(MIN_OBSERVATIONS).fill(7_000))).toHaveLength(MIN_OBSERVATIONS);
    expect(summarizeCorridor(series(Array(MIN_OBSERVATIONS).fill(7_000)))).not.toBeNull();
  });

  it("counts only observations it can use", () => {
    const dirty: CorridorObservation[] = [
      ...series(Array(MIN_OBSERVATIONS).fill(7_000)),
      { at: "not-a-date", travelDate: "2026-10-09", cheapestPriceCents: 5_000 },
      { at: new Date(base).toISOString(), travelDate: "2026-10-09", cheapestPriceCents: 0 },
      { at: new Date(base).toISOString(), travelDate: "2026-10-09", cheapestPriceCents: -1 },
      {
        at: new Date(base).toISOString(),
        travelDate: "2026-10-09",
        cheapestPriceCents: Number.NaN,
      },
    ];
    expect(summarizeCorridor(dirty)?.count).toBe(MIN_OBSERVATIONS);
  });

  it("does not let rubbish drag the floor down", () => {
    // The whole point of screening before recording: a corridor whose low is a
    // misparse tells every traveler on it that they overpaid.
    const stats = summarizeCorridor([
      ...series(Array(MIN_OBSERVATIONS).fill(7_000)),
      { at: new Date(base).toISOString(), travelDate: "2026-10-09", cheapestPriceCents: 0 },
    ])!;
    expect(stats.low).toBe(7_000);
  });
});

describe("summarizeCorridor", () => {
  const stats = summarizeCorridor(typical)!;

  it("describes the shape, not just the extremes", () => {
    expect(stats.low).toBe(4_700);
    expect(stats.high).toBe(13_300);
    expect(stats.median).toBeGreaterThan(stats.p25);
    expect(stats.p75).toBeGreaterThan(stats.median);
  });

  it("says how much it is made of", () => {
    expect(stats.count).toBe(12);
    expect(stats.spanDays).toBeGreaterThan(0);
    expect(Date.parse(stats.newest)).toBeGreaterThan(Date.parse(stats.oldest));
  });

  it("counts distinct travel dates, which is the breadth of the sample", () => {
    // Twelve checks of one date is a much narrower claim than twelve across
    // four, and the copy has to be able to say which.
    const oneDate = summarizeCorridor(series(Array(12).fill(7_000), ["2026-10-09"]))!;
    const fourDates = summarizeCorridor(
      series(Array(12).fill(7_000), ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]),
    )!;
    expect(oneDate.dates).toBe(1);
    expect(fourDates.dates).toBe(4);
  });

  it("is order-independent", () => {
    const shuffled = [...typical].reverse();
    expect(summarizeCorridor(shuffled)).toEqual(stats);
  });

  it("copes with a corridor that never moved", () => {
    const flat = summarizeCorridor(series(Array(14).fill(7_000)))!;
    expect(flat.low).toBe(7_000);
    expect(flat.high).toBe(7_000);
    expect(flat.median).toBe(7_000);
  });
});

describe("where your fare sits", () => {
  const stats = summarizeCorridor(typical)!;

  it("tells someone at the cheap end that they did well", () => {
    const standing = fareStanding(4_900, stats);
    expect(standing.standing).toBe("well-below");
    expect(standing.verdict).toMatch(/did well/i);
  });

  it("tells someone near the top, plainly", () => {
    /* The most useful and least comfortable thing this says. It should not be
       softened into uselessness. */
    const standing = fareStanding(13_000, stats);
    expect(standing.standing).toBe("well-above");
    expect(standing.verdict).toMatch(/near the top/i);
    expect(standing.verdict).toContain("$47");
  });

  it("tells someone in the middle that they are in the middle", () => {
    const standing = fareStanding(stats.median, stats);
    expect(standing.standing).toBe("typical");
    expect(standing.percentile).toBeGreaterThan(35);
    expect(standing.percentile).toBeLessThan(66);
  });

  it("moves monotonically with price", () => {
    const cheap = fareStanding(5_000, stats).percentile;
    const mid = fareStanding(7_200, stats).percentile;
    const dear = fareStanding(12_000, stats).percentile;
    expect(cheap).toBeLessThan(mid);
    expect(mid).toBeLessThan(dear);
  });

  it("does not put two nearby fares on the same percentile", () => {
    // A rank would; interpolation is why this is not a rank.
    expect(fareStanding(7_000, stats).percentile).not.toBe(fareStanding(8_200, stats).percentile);
  });

  it("clamps rather than going off the end", () => {
    expect(fareStanding(1, stats).percentile).toBe(0);
    expect(fareStanding(999_999, stats).percentile).toBe(100);
  });

  it("survives a corridor that never moved", () => {
    const flat = summarizeCorridor(series(Array(14).fill(7_000)))!;
    for (const price of [1_000, 7_000, 20_000]) {
      const standing = fareStanding(price, flat);
      expect(Number.isFinite(standing.percentile), String(price)).toBe(true);
      expect(standing.verdict).not.toMatch(/NaN|undefined/);
    }
  });

  it("always says what the number is made of", () => {
    for (const price of [4_000, 7_000, 14_000]) {
      const standing = fareStanding(price, stats);
      expect(standing.basis).toContain("12 checks");
      // And that it is about the route, not their train — a different claim.
      expect(standing.basis).toMatch(/describes the route, not your particular train/i);
    }
  });

  it("never predicts", () => {
    /* A description of what we saw. Not a forecast, in any branch — the
       product's promise is that it never states a fare it has not observed, and
       a future one is still unobserved. */
    const forbidden =
      /\b(will (be|drop|rise|fall)|expect(ed)? to|predict|forecast|likely to (drop|rise|fall)|should (drop|fall|rise))\b/i;
    for (const price of [1_000, 4_900, 7_200, 13_000, 99_000]) {
      const standing = fareStanding(price, stats);
      const text = `${standing.verdict} ${standing.basis}`;
      expect(text, text).not.toMatch(forbidden);
    }
  });
});

describe("corridorEvidence", () => {
  it("is none without a summary", () => {
    expect(corridorEvidence(null)).toBe("none");
  });

  it("is some from a thin but usable sample", () => {
    expect(corridorEvidence(summarizeCorridor(typical))).toBe("some");
  });

  it("is good from a wide one", () => {
    const wide: CorridorObservation[] = Array.from({ length: 60 }, (_, index) => ({
      at: new Date(base - index * 4 * 3_600_000).toISOString(),
      travelDate: "2026-10-09",
      cheapestPriceCents: 6_000 + (index % 7) * 300,
    }));
    const stats = summarizeCorridor(wide)!;
    expect(stats.spanDays).toBeGreaterThanOrEqual(5);
    expect(corridorEvidence(stats)).toBe("good");
  });

  it("is only some when a big sample is all from one afternoon", () => {
    // Sixty readings over four hours is one afternoon, not a week. Breadth in
    // time is what makes a range mean anything.
    const burst: CorridorObservation[] = Array.from({ length: 60 }, (_, index) => ({
      at: new Date(base - index * 4 * 60_000).toISOString(),
      travelDate: "2026-10-09",
      cheapestPriceCents: 6_000 + index,
    }));
    expect(corridorEvidence(summarizeCorridor(burst))).toBe("some");
  });
});

describe("a realistic fortnight", () => {
  it("reads sensibly end to end", () => {
    const fortnight: CorridorObservation[] = [];
    for (let day = 13; day >= 0; day -= 1) {
      for (const hour of [8, 14, 20]) {
        fortnight.push({
          at: new Date(base - day * DAY + hour * 3_600_000).toISOString(),
          travelDate: `2026-10-${String(9 + (day % 5)).padStart(2, "0")}`,
          // A corridor that mostly sits near $70 and occasionally dips.
          cheapestPriceCents: day % 4 === 0 ? 4_900 : 6_800 + (day % 3) * 600,
        });
      }
    }
    const stats = summarizeCorridor(fortnight)!;
    expect(stats.count).toBe(42);
    expect(stats.dates).toBe(5);
    expect(stats.spanDays).toBeGreaterThanOrEqual(13);
    expect(corridorEvidence(stats)).toBe("good");

    const overpaid = fareStanding(12_800, stats);
    expect(overpaid.standing).toBe("well-above");
    expect(overpaid.basis).toContain("42 checks");
    expect(overpaid.basis).toContain("5 travel dates");
  });
});

/* Every dollar figure a corridor summary reports is a fare we saw.
 *
 * `percentile` interpolated. With twelve observations `(12 - 1) * 0.25` is
 * 2.75, so p25 came back three-quarters of the way from the third-cheapest
 * fare to the fourth — a dollar amount nobody paid and nobody saw listed.
 * Across sample sizes 12 to 40, 68% of the quartiles it produced were like
 * that.
 *
 * Those figures were not decorative. They are the copy under the price
 * history ("the middle half runs $53.75–$81.25"), and `buildAssistantFacts`
 * pushes all five into `observedCents` — the whitelist `verifyAnswer` checks
 * a model's answer against. The guard against the assistant stating a fare
 * nobody observed was itself seeded with fares nobody observed.
 *
 * This test is about the property, not the algorithm: whatever the quantile
 * definition, a summary may only report numbers that are in the sample.
 */
describe("a corridor summary only ever reports fares that were observed", () => {
  function every(prices: number[]) {
    const stats = summarizeCorridor(series(prices));
    expect(stats).not.toBeNull();
    return { stats: stats!, observed: new Set(prices) };
  }

  it("reports observed fares at every sample size the floor allows", () => {
    const invented: string[] = [];
    for (let n = MIN_OBSERVATIONS; n <= 40; n += 1) {
      // Distinct, irregularly spaced prices, so an interpolation cannot
      // accidentally land on a real one.
      const prices = Array.from(
        { length: n },
        (_, index) => 4_700 + index * 313 + (index % 3) * 97,
      );
      const { stats, observed } = every(prices);
      for (const [name, value] of [
        ["low", stats.low],
        ["p25", stats.p25],
        ["median", stats.median],
        ["p75", stats.p75],
        ["high", stats.high],
      ] as const) {
        if (!observed.has(value)) invented.push(`n=${n} ${name}=${value}`);
      }
    }
    expect(invented).toEqual([]);
  });

  it("reports observed fares on an even sample, where the old code always invented one", () => {
    // Twelve prices; the midpoint of the two middle ones is 6_050, which is
    // not among them. The old median was exactly that.
    const prices = [
      4_700, 4_900, 5_200, 5_500, 5_900, 6_000, 6_100, 6_400, 8_800, 9_900, 11_000, 13_300,
    ];
    const { stats, observed } = every(prices);
    expect(observed.has(stats.median)).toBe(true);
    expect(stats.median).not.toBe(6_050);
  });

  it("keeps the quartiles ordered and inside the range", () => {
    const prices = Array.from({ length: 19 }, (_, index) => 4_000 + index * 517);
    const { stats } = every(prices);
    expect(stats.low).toBeLessThanOrEqual(stats.p25);
    expect(stats.p25).toBeLessThanOrEqual(stats.median);
    expect(stats.median).toBeLessThanOrEqual(stats.p75);
    expect(stats.p75).toBeLessThanOrEqual(stats.high);
  });

  it("survives a sample that is entirely one price", () => {
    const { stats, observed } = every(Array.from({ length: 14 }, () => 7_000));
    for (const value of [stats.low, stats.p25, stats.median, stats.p75, stats.high]) {
      expect(observed.has(value)).toBe(true);
    }
  });
});
