import { describe, expect, it } from "vitest";
import { buildHistory, type Observation } from "@/lib/domain/fare-history";
import { waitOrBook, type WaitOrBookInput } from "@/lib/domain/wait-or-book";
import { summarizeCorridor } from "@/lib/domain/corridor-stats";

/* The recommendation, branch by branch.
 *
 * The rule that matters most is the one about invented prices: the product's
 * whole promise is that it never states a fare it has not seen, and a predicted
 * fare is still invented. The last block in this file asserts that across every
 * branch at once, so a future edit that adds "fares usually rise closer to
 * departure" fails here rather than shipping.
 */

const HOUR = 3_600_000;
const base = Date.parse("2026-09-26T12:00:00.000Z");

/** Observations at hourly intervals ending now, oldest first. */
function series(...cents: Array<number | null>): Observation[] {
  return cents.map((value, index) => ({
    at: new Date(base - (cents.length - 1 - index) * 6 * HOUR).toISOString(),
    cents: value,
  }));
}

function ask(patch: Partial<WaitOrBookInput> = {}) {
  return waitOrBook({
    bestCents: 5_000,
    bookedCents: 12_800,
    changeFeeCents: 0,
    hoursToDeparture: 240,
    history: buildHistory(series(5_000)),
    ...patch,
  });
}

describe("nothing to switch to", () => {
  it("says so plainly when nothing qualifies", () => {
    const result = ask({ bestCents: null });
    expect(result.call).toBe("HOLD");
    expect(result.reason).toMatch(/No listed fare is below what you paid/i);
    // High confidence, because this is an observation and not a judgement.
    expect(result.confidence).toBe("high");
  });

  it("says so when the cheapest listed is not cheaper", () => {
    expect(ask({ bestCents: 12_800 }).call).toBe("HOLD");
    expect(ask({ bestCents: 15_000 }).call).toBe("HOLD");
  });
});

describe("the traveler's own money decides first", () => {
  it("refuses when the change fee exceeds the saving", () => {
    const result = ask({ bestCents: 11_000, changeFeeCents: 3_000 });
    expect(result.call).toBe("HOLD");
    expect(result.label).toMatch(/fee eats/i);
    // $18 gross against a $30 fee: switching costs $12.
    expect(result.reason).toContain("$12");
    expect(result.confidence).toBe("high");
  });

  it("refuses at exactly break-even, where switching is pure friction", () => {
    expect(ask({ bestCents: 11_000, changeFeeCents: 1_800 }).call).toBe("HOLD");
  });

  it("outranks an imminent departure, because no timing fixes a loss", () => {
    const result = ask({ bestCents: 11_000, changeFeeCents: 3_000, hoursToDeparture: 2 });
    expect(result.call).toBe("HOLD");
  });

  it("calls a small net saving small rather than recommending it", () => {
    const result = ask({ bestCents: 12_000, changeFeeCents: 500 });
    expect(result.call).toBe("HOLD");
    expect(result.label).toMatch(/Barely worth it/i);
    expect(result.reason).toContain("$3");
  });

  it("treats a fee of zero as not entered, not as free", () => {
    // Nothing is subtracted, and nothing claims the change is free.
    const result = ask({ changeFeeCents: 0 });
    expect(result.reason).not.toMatch(/no fee|free/i);
  });
});

describe("close to departure", () => {
  it("says book it inside a day", () => {
    const result = ask({ hoursToDeparture: 6 });
    expect(result.call).toBe("BOOK_NOW");
    expect(result.reason).toMatch(/under a day/i);
    expect(result.reason).toMatch(/Confirm on Amtrak/i);
  });

  it("does not claim prices rise near departure", () => {
    // We have not measured that and will not assert it. The argument is the
    // asymmetry of remaining chances, which is true by construction.
    const result = ask({ hoursToDeparture: 6 });
    expect(result.reason).not.toMatch(/will rise|usually rise|prices increase|likely to/i);
    expect(result.reason).toMatch(/little time left/i);
  });

  it("is honest that it barely knows the corridor", () => {
    const result = ask({ hoursToDeparture: 6, history: buildHistory(series(5_000)) });
    expect(result.confidence).toBe("moderate");
    expect(result.basis).toMatch(/not watched this corridor for long/i);
  });

  it("is more sure once it has watched a while", () => {
    const result = ask({
      hoursToDeparture: 6,
      history: buildHistory(series(6_000, 5_800, 5_000)),
    });
    expect(result.confidence).toBe("high");
  });
});

describe("a falling corridor with time to spare", () => {
  const falling = buildHistory(series(9_000, 8_000, 7_000, 5_000));

  it("suggests waiting, but only with room to wait", () => {
    const result = ask({ history: falling, hoursToDeparture: 240 });
    expect(result.call).toBe("WATCH_CLOSELY");
    expect(result.label).toMatch(/Falling/i);
  });

  it("will not suggest waiting close to departure", () => {
    expect(ask({ history: falling, hoursToDeparture: 20 }).call).toBe("BOOK_NOW");
  });

  it("stops arguing from the trend once the window is short", () => {
    // Still WATCH_CLOSELY at 48h — a corridor that swung 90 to 50 is unsettled
    // and there are six checks left — but on the evidence of the range, not on
    // a trend it is too late to ride.
    const result = ask({ history: falling, hoursToDeparture: 48 });
    expect(result.label).not.toMatch(/Falling/i);
    expect(result.label).toMatch(/Unsettled/i);
  });

  it("hedges hard, and downgrades its own confidence for saying it", () => {
    const result = ask({ history: falling, hoursToDeparture: 240 });
    // A trend is the weakest thing here, so it never claims high confidence.
    expect(result.confidence).not.toBe("high");
    expect(result.basis).toMatch(/not a prediction/i);
    expect(result.reason).toMatch(/may not|bet/i);
  });

  it("still tells them the money is available now", () => {
    expect(ask({ history: falling, hoursToDeparture: 240 }).reason).toContain("$78");
  });
});

describe("a rising corridor", () => {
  const rising = buildHistory(series(3_000, 4_000, 5_000));

  it("says take it", () => {
    const result = ask({ history: rising });
    expect(result.call).toBe("BOOK_NOW");
    expect(result.label).toMatch(/Take it/i);
  });

  it("describes what happened rather than what will", () => {
    const result = ask({ history: rising });
    expect(result.reason).toMatch(/changes we saw were upward/i);
    expect(result.basis).toMatch(/not predicting/i);
  });
});

describe("an unsettled corridor", () => {
  const jumpy = buildHistory(series(13_300, 4_700, 11_000, 5_000, 9_000, 5_000));

  it("says watch it, and names the range it has actually seen", () => {
    const result = ask({ history: jumpy });
    expect(result.call).toBe("WATCH_CLOSELY");
    expect(result.reason).toContain("$47");
    expect(result.reason).toContain("$133");
  });

  it("does not need a trend to say so", () => {
    expect(ask({ history: jumpy }).label).toMatch(/Unsettled/i);
  });
});

describe("a steady corridor with a real saving", () => {
  it("recommends switching", () => {
    const steady = buildHistory(series(5_000, 5_000, 5_000, 5_000));
    const result = ask({ history: steady });
    expect(result.call).toBe("BOOK_NOW");
    expect(result.label).toMatch(/Worth switching/i);
    expect(result.reason).toMatch(/Confirm the fare and the change rules on Amtrak/i);
  });
});

describe("confidence reflects what was actually seen", () => {
  it("is low on a first look", () => {
    expect(ask({ history: buildHistory([]) }).confidence).toBe("low");
    expect(ask({ history: buildHistory([]) }).basis).toMatch(/first look/i);
  });

  it("is low after one observation, and says one is not a pattern", () => {
    const result = ask({ history: buildHistory(series(5_000)) });
    expect(result.confidence).toBe("low");
    expect(result.basis).toMatch(/not a pattern/i);
  });

  it("is moderate after a few checks over a day", () => {
    const result = ask({ history: buildHistory(series(5_000, 5_000, 5_000, 5_000, 5_000)) });
    expect(result.confidence).toBe("moderate");
  });

  it("is high only after days of watching", () => {
    const many: Observation[] = Array.from({ length: 14 }, (_, index) => ({
      at: new Date(base - (13 - index) * 8 * HOUR).toISOString(),
      cents: 5_000,
    }));
    const result = ask({ history: buildHistory(many) });
    expect(result.confidence).toBe("high");
    expect(result.basis).toMatch(/days of watching/i);
  });

  it("never claims high confidence from a handful of points", () => {
    for (const count of [2, 3, 4]) {
      const history = buildHistory(series(...Array(count).fill(5_000)));
      expect(ask({ history }).confidence, `${count} points`).not.toBe("high");
    }
  });
});

describe("the cold start, which the corridor fixes", () => {
  /* The weakest moment in the product. A brand-new watch said "this is the
   * first look" and shrugged, while RailDrop had been scraping that exact route
   * three times a day for somebody else all week and throwing the numbers away. */
  const corridor = summarizeCorridor(
    Array.from({ length: 48 }, (_, index) => ({
      at: new Date(base - index * 4 * HOUR).toISOString(),
      travelDate: "2026-10-09",
      cheapestPriceCents: 5_000 + (index % 9) * 700,
    })),
  )!;

  it("still says it is the first look at this trip", () => {
    // Borrowing the route's history must not be dressed up as knowing this
    // train. The sentence has to keep both facts.
    const result = ask({ history: buildHistory([]), corridor });
    expect(result.basis).toMatch(/first look at your trip/i);
    expect(result.basis).toMatch(/describes the route, not your particular train/i);
  });

  it("lifts a first look out of low confidence, but only to moderate", () => {
    expect(ask({ history: buildHistory([]) }).confidence).toBe("low");
    expect(ask({ history: buildHistory([]), corridor }).confidence).toBe("moderate");
  });

  it("never reaches high on the route's evidence alone", () => {
    // Knowing what a route usually costs is not knowing what tomorrow
    // morning's train will do.
    for (const history of [buildHistory([]), buildHistory(series(5_000))]) {
      expect(ask({ history, corridor }).confidence).not.toBe("high");
    }
  });

  it("names the numbers it is borrowing", () => {
    const result = ask({ history: buildHistory([]), corridor });
    expect(result.basis).toContain("48 checks");
    expect(result.basis).toMatch(/\$5\d/);
  });

  it("changes nothing once the trip has its own history", () => {
    const own = buildHistory(series(5_000, 5_000, 5_000, 5_000, 5_000));
    expect(ask({ history: own, corridor }).basis).toBe(ask({ history: own }).basis);
  });
});

describe("nothing cheaper today, but the route says otherwise", () => {
  /* "Keep the ticket you have" was the whole answer, and it is the least
   * useful true sentence in the product. */
  const cheapRoute = summarizeCorridor(
    Array.from({ length: 48 }, (_, index) => ({
      at: new Date(base - index * 4 * HOUR).toISOString(),
      travelDate: "2026-10-09",
      cheapestPriceCents: 4_000 + (index % 9) * 400,
    })),
  )!;

  it("tells someone paying well above the route's normal price", () => {
    const result = ask({ bestCents: null, bookedCents: 12_800, corridor: cheapRoute });
    expect(result.call).toBe("HOLD");
    expect(result.label).toMatch(/keep watching/i);
    expect(result.reason).toMatch(/near the top/i);
  });

  it("does not manufacture concern for someone who paid well", () => {
    const result = ask({ bestCents: null, bookedCents: 4_100, corridor: cheapRoute });
    expect(result.label).toBe("Nothing to switch to");
    expect(result.reason).toMatch(/did well/i);
  });

  it("keeps the old answer when there is no route history", () => {
    const result = ask({ bestCents: null, bookedCents: 12_800 });
    expect(result.label).toBe("Nothing to switch to");
    expect(result.confidence).toBe("high");
  });

  it("is honest that this is about the route, not today's board", () => {
    const result = ask({ bestCents: null, bookedCents: 12_800, corridor: cheapRoute });
    expect(result.basis).toMatch(/describes the route/i);
    expect(result.confidence).not.toBe("high");
  });
});

describe("the promise: it never invents a price", () => {
  /* Every branch, checked at once. The product's core claim is that it never
   * states a fare it has not observed; a predicted one is still invented. */
  const cases: Array<[string, Partial<WaitOrBookInput>]> = [
    ["nothing cheaper", { bestCents: null }],
    ["fee eats it", { bestCents: 11_000, changeFeeCents: 3_000 }],
    ["marginal", { bestCents: 12_000, changeFeeCents: 500 }],
    ["imminent", { hoursToDeparture: 3 }],
    ["falling", { history: buildHistory(series(9_000, 8_000, 7_000, 5_000)) }],
    ["rising", { history: buildHistory(series(3_000, 4_000, 5_000)) }],
    ["jumpy", { history: buildHistory(series(13_300, 4_700, 11_000, 5_000, 9_000, 5_000)) }],
    ["steady", { history: buildHistory(series(5_000, 5_000, 5_000, 5_000)) }],
    ["no history", { history: buildHistory([]) }],
  ];

  /* Predictive claims, not the vocabulary. "not a forecast" is the product
   * saying the right thing, so the lookbehind lets a denial through while the
   * assertion itself still fails. */
  const forbidden =
    /\b(will (be|drop|rise|fall|go)|expect(ed)?\s+to|(?<!not a )(?<!never )(predict|forecast)|likely to (drop|rise|fall)|probably (drop|rise|fall)|should (drop|fall|rise))\b/i;

  for (const [name, patch] of cases) {
    it(`states no future price for: ${name}`, () => {
      const result = waitOrBook({
        bestCents: 5_000,
        bookedCents: 12_800,
        changeFeeCents: 0,
        hoursToDeparture: 240,
        history: buildHistory(series(5_000)),
        ...patch,
      });
      const text = `${result.label} ${result.reason} ${result.basis}`;
      expect(text, text).not.toMatch(forbidden);
    });
  }

  it("always says something, and always says how sure it is", () => {
    for (const [name, patch] of cases) {
      const result = waitOrBook({
        bestCents: 5_000,
        bookedCents: 12_800,
        changeFeeCents: 0,
        hoursToDeparture: 240,
        history: buildHistory(series(5_000)),
        ...patch,
      });
      expect(result.reason.length, name).toBeGreaterThan(20);
      expect(result.basis.length, name).toBeGreaterThan(10);
      expect(["low", "moderate", "high"], name).toContain(result.confidence);
      expect(["BOOK_NOW", "HOLD", "WATCH_CLOSELY"], name).toContain(result.call);
    }
  });

  it("copes with an unknown departure rather than guessing one", () => {
    const result = ask({ hoursToDeparture: null });
    expect(result.call).toBeTruthy();
    expect(result.reason).not.toMatch(/NaN|undefined|null/);
  });
});
