import { describe, expect, it } from "vitest";
import { fareDistribution } from "@/lib/domain/fare-distribution";

/* Order statistics only. The rule drew forty ticks and said nothing about
 * what the shape was; the eye cannot count forty ticks. */

describe("the shape of what was listed", () => {
  it("returns nothing when nothing was listed", () => {
    expect(fareDistribution([])).toBeNull();
    expect(fareDistribution([0, -100])).toBeNull();
  });

  it("every figure it reports is a fare somebody actually listed", () => {
    /* The constraint the whole product rests on. An interpolated median of
       [100, 200] is 150, and nobody listed 150. */
    const observed = [10_000, 20_000];
    const d = fareDistribution(observed)!;
    for (const value of [d.low, d.high, d.median, d.lowerQuartile, d.upperQuartile]) {
      expect(observed, `${value} was not observed`).toContain(value);
    }
  });

  it("describes a real spread", () => {
    const d = fareDistribution([9100, 16700, 16700, 21100, 25700, 31500])!;
    expect(d.count).toBe(6);
    expect(d.distinct).toBe(5);
    expect(d.low).toBe(9100);
    expect(d.high).toBe(31500);
    expect(d.median).toBe(16700);
    expect(d.lowerQuartile).toBe(16700);
    expect(d.upperQuartile).toBe(25700);
    expect(d.atFloor).toBe(1);
  });

  it("counts how many trains sit at the floor", () => {
    // "The cheapest fare is one train" and "six trains are this price" are
    // different facts about whether you need to hurry.
    expect(fareDistribution([9100, 9100, 9100, 25700])!.atFloor).toBe(3);
  });

  it("counts the middle rather than asserting a fraction", () => {
    /* "middle half" is false under ties: one fare at $91, thirty at $167 and
       three at $302 gives lowerQuartile === median === upperQuartile, so the
       line claimed "half" about 30 of 34 fares. */
    const lopsided = [9100, ...Array.from({ length: 30 }, () => 16_700), 30_200, 30_200, 30_200];
    const d = fareDistribution(lopsided)!;
    expect(d.lowerQuartile).toBe(d.upperQuartile);
    expect(d.inMiddle).toBe(30);
    expect(d.count).toBe(34);
  });

  it("holds up for a single fare", () => {
    const d = fareDistribution([12_300])!;
    expect(d).toMatchObject({
      count: 1,
      distinct: 1,
      low: 12_300,
      high: 12_300,
      median: 12_300,
      lowerQuartile: 12_300,
      upperQuartile: 12_300,
      atFloor: 1,
      inMiddle: 1,
    });
  });

  it("does not care what order it is handed", () => {
    const shuffled = fareDistribution([31500, 9100, 25700, 16700]);
    const sorted = fareDistribution([9100, 16700, 25700, 31500]);
    expect(shuffled).toEqual(sorted);
  });
});
