import { describe, expect, it } from "vitest";
import {
  bestEverNote,
  buildHistory,
  chartGeometry,
  recentDirection,
  volatility,
  volatilityNote,
  type Observation,
} from "@/lib/domain/fare-history";

const HOUR = 3_600_000;
const now = Date.parse("2026-09-26T12:00:00.000Z");

/** Observations every six hours, ending now, oldest first. */
function series(...cents: Array<number | null>): Observation[] {
  return cents.map((value, index) => ({
    at: new Date(now - (cents.length - 1 - index) * 6 * HOUR).toISOString(),
    cents: value,
  }));
}

describe("buildHistory", () => {
  it("keeps only the checks that saw a price", () => {
    // null is a real observation — looked, saw nothing — but it is not a point
    // on a price line.
    const history = buildHistory(series(5_000, null, 4_700));
    expect(history.points.map((p) => p.cents)).toEqual([5_000, 4_700]);
    // ...and it still counts as a check, which is the denominator for "how often".
    expect(history.checks).toBe(3);
  });

  it("sorts by time, because cycle order is not guaranteed by any query", () => {
    const shuffled: Observation[] = [
      { at: "2026-09-26T12:00:00.000Z", cents: 3 },
      { at: "2026-09-24T12:00:00.000Z", cents: 1 },
      { at: "2026-09-25T12:00:00.000Z", cents: 2 },
    ];
    expect(buildHistory(shuffled).points.map((p) => p.cents)).toEqual([1, 2, 3]);
  });

  it("drops rubbish rather than charting it", () => {
    const junk: Observation[] = [
      { at: "not-a-date", cents: 5_000 },
      { at: "2026-09-26T12:00:00.000Z", cents: 0 },
      { at: "2026-09-26T13:00:00.000Z", cents: -100 },
      { at: "2026-09-26T14:00:00.000Z", cents: Number.NaN },
      { at: "2026-09-26T15:00:00.000Z", cents: 4_700 },
    ];
    expect(buildHistory(junk).points.map((p) => p.cents)).toEqual([4_700]);
  });

  it("finds the lowest and the highest it saw", () => {
    const history = buildHistory(series(9_000, 4_700, 6_000));
    expect(history.lowest?.cents).toBe(4_700);
    expect(history.highest?.cents).toBe(9_000);
    expect(history.latest?.cents).toBe(6_000);
  });

  it("names the first time it saw the lowest, not the last", () => {
    // "The cheapest was on Tuesday" should mean the Tuesday it first appeared.
    const history = buildHistory(series(4_700, 9_000, 4_700));
    expect(history.lowest?.at).toBe(series(4_700, 9_000, 4_700)[0]!.at);
  });

  it("records moves between consecutive observations, and ignores no-ops", () => {
    const history = buildHistory(series(5_000, 5_000, 4_700, 4_700, 6_000));
    expect(history.moves).toHaveLength(2);
    expect(history.moves[0]).toMatchObject({ from: 5_000, to: 4_700, direction: "down" });
    expect(history.moves[1]).toMatchObject({ from: 4_700, to: 6_000, direction: "up" });
  });

  it("measures the span it actually watched", () => {
    expect(buildHistory(series(1, 2, 3)).spanHours).toBe(12);
    expect(buildHistory(series(1)).spanHours).toBe(0);
  });

  it("is empty-safe", () => {
    const history = buildHistory([]);
    expect(history.points).toEqual([]);
    expect(history.lowest).toBeNull();
    expect(history.moves).toEqual([]);
    expect(history.spanHours).toBe(0);
  });
});

describe("volatilityNote", () => {
  it("says nothing from one move, because that is not a pattern", () => {
    expect(volatilityNote(buildHistory(series(5_000, 4_700)))).toBeNull();
    expect(volatilityNote(buildHistory(series(5_000)))).toBeNull();
    expect(volatilityNote(buildHistory([]))).toBeNull();
  });

  it("says nothing when the price never actually changed", () => {
    expect(volatilityNote(buildHistory(series(5_000, 5_000, 5_000)))).toBeNull();
  });

  it("counts the changes and names the range it saw", () => {
    const note = volatilityNote(buildHistory(series(13_300, 4_700, 11_000, 5_000)))!;
    expect(note).toContain("3 price changes");
    expect(note).toContain("$47");
    expect(note).toContain("$133");
  });

  it("reads in days once it has watched for days", () => {
    const week: Observation[] = Array.from({ length: 8 }, (_, index) => ({
      at: new Date(now - (7 - index) * 24 * HOUR).toISOString(),
      cents: 5_000 + index * 100,
    }));
    expect(volatilityNote(buildHistory(week))).toContain("7 days");
  });
});

describe("bestEverNote", () => {
  it("says nothing until there is more than one look", () => {
    expect(bestEverNote(buildHistory(series(5_000)), now)).toBeNull();
    expect(bestEverNote(buildHistory([]), now)).toBeNull();
  });

  it("does not tell someone they missed a fare that is still here", () => {
    // The lie that costs money. If the cheapest ever is what is listed now, say
    // that, and do not invent a regret.
    const note = bestEverNote(buildHistory(series(9_000, 4_700)), now)!;
    expect(note).toMatch(/that is what is listed now/i);
    expect(note).not.toMatch(/missed|ago/i);
  });

  it("says how long ago the cheapest was, and what it costs now", () => {
    const note = bestEverNote(buildHistory(series(4_700, 9_000)), now)!;
    expect(note).toContain("$47");
    expect(note).toContain("$90");
    expect(note).toContain("6 hours ago");
    // And the difference, stated rather than left as arithmetic homework.
    expect(note).toContain("$43");
  });

  it("drops the relative time when there is no clock yet", () => {
    // Server render and first hydration: reading a clock there is a mismatch,
    // so the sentence has to be true without one.
    const note = bestEverNote(buildHistory(series(4_700, 9_000)), null)!;
    expect(note).toContain("$47");
    expect(note).toContain("$43");
    expect(note).not.toMatch(/ago/);
  });

  it("reads in days for an older sighting", () => {
    const old: Observation[] = [
      { at: new Date(now - 72 * HOUR).toISOString(), cents: 4_700 },
      { at: new Date(now).toISOString(), cents: 9_000 },
    ];
    expect(bestEverNote(buildHistory(old), now)).toContain("3 days ago");
  });
});

describe("recentDirection", () => {
  it("is flat with nothing to go on", () => {
    expect(recentDirection(buildHistory(series(5_000))).direction).toBe("flat");
    expect(recentDirection(buildHistory(series(5_000, 5_000))).direction).toBe("flat");
  });

  it("reads a consistent fall and a consistent rise", () => {
    expect(recentDirection(buildHistory(series(9_000, 8_000, 7_000))).direction).toBe("down");
    expect(recentDirection(buildHistory(series(3_000, 4_000, 5_000))).direction).toBe("up");
  });

  it("refuses to call a direction that is not there", () => {
    expect(recentDirection(buildHistory(series(9_000, 4_000, 8_000))).direction).toBe("mixed");
  });

  it("looks only at the last few, so an old trend does not outvote the present", () => {
    const history = buildHistory(series(1_000, 2_000, 3_000, 4_000, 3_000, 2_000, 1_000));
    expect(recentDirection(history, 3).direction).toBe("down");
  });
});

describe("volatility", () => {
  it("is zero without evidence, which is not the same as stable", () => {
    expect(volatility(buildHistory([]))).toBe(0);
    expect(volatility(buildHistory(series(5_000)))).toBe(0);
  });

  it("is zero for a genuinely flat corridor", () => {
    expect(volatility(buildHistory(series(5_000, 5_000, 5_000)))).toBe(0);
  });

  it("is relative, so corridors of different prices compare", () => {
    // A $20 swing is noise on a $300 fare and a third of a $60 one.
    const cheap = volatility(buildHistory(series(4_000, 6_000)));
    const dear = volatility(buildHistory(series(29_000, 31_000)));
    expect(cheap).toBeGreaterThan(dear);
    expect(cheap).toBeCloseTo(0.4, 5);
  });
});

describe("chartGeometry", () => {
  const box = { width: 300, height: 80 };

  it("lays points left to right across the box", () => {
    const geometry = chartGeometry(buildHistory(series(5_000, 4_000, 6_000)), box);
    const xs = geometry.points.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[0]).toBeCloseTo(4, 5);
    expect(xs[xs.length - 1]!).toBeCloseTo(296, 5);
  });

  it("puts the cheapest at the bottom and the dearest at the top", () => {
    const geometry = chartGeometry(buildHistory(series(9_000, 4_000)), box);
    const [dear, cheap] = geometry.points;
    expect(dear!.y).toBeLessThan(cheap!.y);
  });

  it("stays inside the box", () => {
    const geometry = chartGeometry(buildHistory(series(1_000, 50_000, 25_000)), box);
    for (const point of geometry.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(box.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(box.height);
    }
  });

  it("draws a gap where we did not look, rather than a confident line", () => {
    /* Two checks a week apart joined by a straight line would claim we watched
     * the price slide between them. We did not look. */
    const sparse: Observation[] = [
      { at: new Date(now - 8 * 24 * HOUR).toISOString(), cents: 9_000 },
      { at: new Date(now - 7 * 24 * HOUR).toISOString(), cents: 8_000 },
      { at: new Date(now).toISOString(), cents: 5_000 },
    ];
    const geometry = chartGeometry(buildHistory(sparse), box);
    expect(geometry.segments).toHaveLength(2);
    expect(geometry.segments[0]).toHaveLength(2);
    expect(geometry.segments[1]).toHaveLength(1);
  });

  it("keeps one unbroken line when the checks are regular", () => {
    expect(chartGeometry(buildHistory(series(1, 2, 3, 4)), box).segments).toHaveLength(1);
  });

  it("places the booking benchmark when it is on the scale", () => {
    const geometry = chartGeometry(buildHistory(series(4_000, 6_000)), {
      ...box,
      benchmarkCents: 5_000,
    });
    expect(geometry.benchmarkY).not.toBeNull();
    expect(geometry.benchmarkY!).toBeGreaterThan(0);
    expect(geometry.benchmarkY!).toBeLessThan(box.height);
  });

  it("widens the scale to include the benchmark rather than clipping it", () => {
    const geometry = chartGeometry(buildHistory(series(4_000, 5_000)), {
      ...box,
      benchmarkCents: 12_800,
    });
    expect(geometry.high).toBe(12_800);
    expect(geometry.benchmarkY).not.toBeNull();
  });

  it("does not divide by zero on a flat series", () => {
    const geometry = chartGeometry(buildHistory(series(5_000, 5_000, 5_000)), box);
    for (const point of geometry.points) expect(Number.isFinite(point.y)).toBe(true);
    // Drawn in the middle, which is what a flat line is.
    expect(geometry.points[0]!.y).toBeCloseTo(box.height / 2, 0);
  });

  it("puts a single observation at the right edge, where now is", () => {
    const geometry = chartGeometry(buildHistory(series(5_000)), box);
    expect(geometry.points).toHaveLength(1);
    expect(geometry.points[0]!.x).toBeCloseTo(296, 5);
  });

  it("is empty-safe", () => {
    const geometry = chartGeometry(buildHistory([]), box);
    expect(geometry.points).toEqual([]);
    expect(geometry.segments).toEqual([]);
  });
});
