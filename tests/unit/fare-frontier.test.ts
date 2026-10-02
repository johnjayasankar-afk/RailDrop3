import { describe, expect, it } from "vitest";
import { fareFrontier } from "@/lib/domain/fare-frontier";
import type { RankedCandidate } from "@/lib/domain/types";

/* Which fares are not beaten on both price and journey time.
 *
 * Tested and unused on purpose: on real Northeast Corridor data a timetable
 * is near-monotone and the faster service is the expensive one, so the
 * frontier collapses to a point or two and there is no staircase worth
 * drawing. The function exists so the claim can be measured before anything
 * is built on it. */

let n = 0;
const fare = (over: {
  price: number;
  minutes: number | null;
  date?: string;
  journeyId?: string;
}): RankedCandidate =>
  ({
    journey: {
      id: over.journeyId ?? `j${(n += 1)}`,
      searchedTravelDate: over.date ?? "2026-10-09",
      durationMinutes: over.minutes,
    },
    fare: { id: `f${n}` },
    totalPartyPriceCents: over.price,
  }) as unknown as RankedCandidate;

describe("not beaten on both price and journey time", () => {
  it("drops a fare that is both dearer and slower", () => {
    const good = fare({ price: 9100, minutes: 240 });
    const beaten = fare({ price: 14_100, minutes: 260 });
    const { frontier } = fareFrontier([good, beaten], "2026-10-09");
    expect(frontier).toEqual([good]);
  });

  it("keeps a fare that is dearer but faster — that is a trade, not a loss", () => {
    const cheapSlow = fare({ price: 9100, minutes: 260 });
    const dearFast = fare({ price: 14_100, minutes: 180 });
    expect(fareFrontier([cheapSlow, dearFast], "2026-10-09").frontier).toHaveLength(2);
  });

  it("uses weak dominance, so an equal-duration dearer fare is beaten", () => {
    /* Strict-on-both would leave a $74 and a $59 fare on the same train at
       the same minute both calling themselves undominated. */
    const cheap = fare({ price: 5900, minutes: 249 });
    const dear = fare({ price: 7400, minutes: 249 });
    expect(fareFrontier([cheap, dear], "2026-10-09").frontier).toEqual([cheap]);
  });

  it("never lets two fares on one journey beat each other", () => {
    const flx = fare({ price: 7400, minutes: 249, journeyId: "same" });
    const vlu = fare({ price: 5900, minutes: 249, journeyId: "same" });
    const { frontier } = fareFrontier([flx, vlu], "2026-10-09");
    expect(frontier).toHaveLength(2);
  });

  it("looks at one date only", () => {
    /* Pooling a window puts a whole column of prices at one train's duration
       and asserts cross-day comparability, which this product refuses. */
    const today = fare({ price: 14_100, minutes: 240, date: "2026-10-09" });
    const cheaperTomorrow = fare({ price: 5900, minutes: 200, date: "2026-10-10" });
    const out = fareFrontier([today, cheaperTomorrow], "2026-10-09");
    expect(out.frontier).toEqual([today]);
    expect(out.considered).toBe(1);
  });

  it("ignores a fare it cannot place", () => {
    const placed = fare({ price: 9100, minutes: 240 });
    const noDuration = fare({ price: 5900, minutes: null });
    const out = fareFrontier([placed, noDuration], "2026-10-09");
    expect(out.frontier).toEqual([placed]);
    expect(out.considered).toBe(1);
  });

  it("collapses exact duplicates, so one train is one point", () => {
    const a = fare({ price: 9100, minutes: 240, journeyId: "a" });
    const b = fare({ price: 9100, minutes: 240, journeyId: "b" });
    expect(fareFrontier([a, b], "2026-10-09").frontier).toHaveLength(1);
  });

  it("returns an empty frontier for a date with nothing on it", () => {
    expect(fareFrontier([], "2026-10-09")).toEqual({
      travelDate: "2026-10-09",
      frontier: [],
      considered: 0,
    });
  });
});
