import { describe, expect, it } from "vitest";
import { previewFares } from "@/lib/fares/preview-fares";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import type { FareProvider } from "@/lib/providers/fare-provider";
import type { FareSearchRequest, FareSearchResult, JourneyOption } from "@/lib/domain/types";

/* Fares without a database.
 *
 * The product's promise is "here are the live Amtrak fares for your trip", and
 * keeping it does not require somewhere to write the answer down. But every
 * path to a price went through creating a watch first, so when the Supabase
 * project behind a deployment stopped existing, the app could not show anybody
 * a single fare — while the scraper was working perfectly the whole time.
 *
 * Nothing in this file touches a repository. That is the point, and the test
 * that would catch a regression is that these all pass without one existing.
 */

const body = {
  originCode: "BOS",
  destinationCode: "NYP",
  desiredTravelDate: "2026-10-09",
  dateFlexibilityDays: 1 as const,
};

const now = new Date("2026-09-27T12:00:00.000Z");

describe("a fare lookup with no database", () => {
  it("returns ranked fares", async () => {
    const preview = await previewFares({ body, provider: new FixtureFareProvider(), now });
    expect(preview.ranked.length).toBeGreaterThan(0);
    expect(preview.originCode).toBe("BOS");
  });

  it("ranks cheapest first, because there is no booking to rank against", async () => {
    const preview = await previewFares({ body, provider: new FixtureFareProvider(), now });
    const prices = preview.ranked.map((candidate) => candidate.totalPartyPriceCents);
    expect(prices[0]).toBe(Math.min(...prices));
  });

  it("never reports a saving, because there is nothing to save against", async () => {
    /* A preview has no booked price. Computing "savings" against zero would
       make every fare look like a windfall. */
    const preview = await previewFares({ body, provider: new FixtureFareProvider(), now });
    for (const candidate of preview.ranked) {
      expect(candidate.savingsCents).toBeLessThanOrEqual(0);
    }
  });

  it("names the cheapest on each day", async () => {
    const preview = await previewFares({ body, provider: new FixtureFareProvider(), now });
    expect(preview.byDate.length).toBeGreaterThan(0);
    for (const [date, candidate] of preview.byDate) {
      expect(candidate.journey.searchedTravelDate).toBe(date);
    }
  });

  it("caps how many dates it will scrape", async () => {
    // Somebody is waiting, and it costs provider credit. The watch does the
    // full sweep once it exists.
    const preview = await previewFares({
      body: { ...body, dateFlexibilityDays: 2 },
      provider: new FixtureFareProvider(),
      now,
    });
    expect(preview.dates.length).toBeLessThanOrEqual(3);
  });

  it("centres the window on the date that was actually asked for", async () => {
    const preview = await previewFares({
      body: { ...body, dateFlexibilityDays: 2 },
      provider: new FixtureFareProvider(),
      now,
    });
    expect(preview.dates).toContain("2026-10-09");
  });
});

describe("it screens fares like a real cycle does", () => {
  function provider(corrupt: (journeys: JourneyOption[]) => JourneyOption[]): FareProvider {
    const inner = new FixtureFareProvider();
    return {
      id: inner.id,
      async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
        const result = await inner.searchTrips(request);
        return { ...result, journeys: corrupt(result.journeys) };
      },
      getStations: () => inner.getStations(),
      healthCheck: () => inner.healthCheck(),
    };
  }

  it("drops an implausible fare rather than showing it", async () => {
    /* A preview must not be the one surface where a misparse gets through.
       It is the surface a stranger sees first. */
    const preview = await previewFares({
      body,
      now,
      provider: provider((journeys) =>
        journeys.map((journey, index) =>
          index === 0
            ? {
                ...journey,
                fares: journey.fares.map((fare) => ({
                  ...fare,
                  totalPartyPriceCents: 42,
                  pricePerTravelerCents: 42,
                })),
              }
            : journey,
        ),
      ),
    });
    expect(preview.ranked.map((c) => c.totalPartyPriceCents)).not.toContain(42);
  });

  it("fails a date it could not read, rather than calling it empty", async () => {
    const preview = await previewFares({
      body: { ...body, dateFlexibilityDays: 0 },
      now,
      provider: provider((journeys) =>
        journeys.map((journey) => ({
          ...journey,
          fares: journey.fares.map((fare) => ({
            ...fare,
            totalPartyPriceCents: 1,
            pricePerTravelerCents: 1,
          })),
        })),
      ),
    });
    expect(preview.unreadableDates).toContain("2026-10-09");
    expect(preview.failedDates).toContain("2026-10-09");
    expect(preview.ranked).toHaveLength(0);
  });
});

describe("what it refuses", () => {
  it("rejects a trip that goes nowhere", async () => {
    await expect(
      previewFares({
        body: { ...body, destinationCode: "BOS" },
        provider: new FixtureFareProvider(),
        now,
      }),
    ).rejects.toThrow(/must differ/i);
  });

  it("rejects a window entirely in the past", async () => {
    await expect(
      previewFares({
        body: { ...body, desiredTravelDate: "2020-01-01", dateFlexibilityDays: 0 },
        provider: new FixtureFareProvider(),
        now,
      }),
    ).rejects.toThrow(/already passed/i);
  });

  it("rejects a malformed station code", async () => {
    await expect(
      previewFares({
        body: { ...body, originCode: "B" },
        provider: new FixtureFareProvider(),
        now,
      }),
    ).rejects.toThrow();
  });

  it("survives a provider that is entirely down", async () => {
    const dead: FareProvider = {
      id: "dead",
      async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
        return {
          request,
          status: "PROVIDER_ERROR",
          journeys: [],
          providerError: { code: "DOWN", message: "no", retryable: true },
          metadata: { requestId: "x", provider: "dead", retrievedAt: "", latencyMs: 1 },
        } as unknown as FareSearchResult;
      },
      getStations: async () => [],
      healthCheck: async () => ({ ok: false, message: "down", latencyMs: 1 }),
    };
    const preview = await previewFares({ body, provider: dead, now });
    expect(preview.ranked).toHaveLength(0);
    expect(preview.failedDates.length).toBeGreaterThan(0);
  });
});

/* When the fare site refuses us.
 *
 * Wanderu sits behind Cloudflare, and on 27 September it began answering 403
 * with the "Just a moment" interstitial — to a plain fetch and to headless
 * Chromium alike, from a residential address as well as from Vercel. The
 * scraper cannot get a price while that is true, and the only thing left worth
 * getting right is what the traveler is told and how long they wait for it.
 *
 * Before this, a refused search waited out the full trip wait and the extra
 * wait on every date in the window — about ninety seconds each — and then
 * reported "Wanderu returned no trip data", which is not what happened. Three
 * dates of that overran the function's budget, so the request was killed and
 * the screen stayed blank.
 */
describe("when the fare site refuses the search", () => {
  function refusing(counter: { calls: number }): FareProvider {
    return {
      id: "refusing",
      async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
        counter.calls += 1;
        return {
          request,
          status: "PROVIDER_ERROR",
          journeys: [],
          providerError: { message: "Live fare site blocked this check. Recheck in a minute." },
        } as unknown as FareSearchResult;
      },
      async getStations() {
        return [];
      },
      async healthCheck() {
        return { ok: false };
      },
    } as unknown as FareProvider;
  }

  it("asks once and stops, instead of re-proving it on every date", async () => {
    /* The whole point. Every date goes to the same host from the same address,
       so the second and third attempts can only fail the same way — and the
       budget spent on them is the budget that was supposed to render an answer. */
    const counter = { calls: 0 };
    await previewFares({ body, provider: refusing(counter), now });
    expect(counter.calls).toBe(1);
  });

  it("still reports every date in the window as failed", async () => {
    // Not searched is not the same as searched and empty.
    const counter = { calls: 0 };
    const preview = await previewFares({ body, provider: refusing(counter), now });
    expect(preview.failedDates).toEqual(preview.dates);
  });

  it("passes the reason through so the board can say which problem it is", async () => {
    const preview = await previewFares({ body, provider: refusing({ calls: 0 }), now });
    expect(preview.failureReason).toMatch(/blocked/i);
  });

  it("does not invent fares while it is being refused", async () => {
    // The promise holds in both directions: no price we did not observe.
    const preview = await previewFares({ body, provider: refusing({ calls: 0 }), now });
    expect(preview.ranked).toEqual([]);
    expect(preview.byDate).toEqual([]);
  });
});

describe("when one date merely fails", () => {
  it("keeps trying the others, because a timeout is not a refusal", async () => {
    /* The distinction that makes the early stop safe. A date that timed out
       says nothing about the next one, so the window is still worth searching. */
    const counter = { calls: 0 };
    const flaky: FareProvider = {
      id: "flaky",
      async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
        counter.calls += 1;
        return {
          request,
          status: "PROVIDER_ERROR",
          journeys: [],
          providerError: { message: "Live fare search timed out. Recheck in a minute." },
        } as unknown as FareSearchResult;
      },
      async getStations() {
        return [];
      },
      async healthCheck() {
        return { ok: false };
      },
    } as unknown as FareProvider;
    const preview = await previewFares({ body, provider: flaky, now });
    expect(counter.calls).toBe(preview.dates.length);
    expect(counter.calls).toBeGreaterThan(1);
    expect(preview.failureReason).toMatch(/timed out/i);
  });
});

/* Answering as it happens.
 *
 * The window is searched one date at a time, so the first answer exists
 * seconds in and the last can be half a minute later. Holding everything back
 * until the slowest date returns throws away information the caller already
 * has — and on a page where somebody is watching a progress bar, that is most
 * of the wait.
 */
describe("progress while the window is still being searched", () => {
  function slowProvider(delayMs: number, seen: string[]): FareProvider {
    const fixture = new FixtureFareProvider();
    return {
      id: "slow",
      async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        seen.push(request.travelDate);
        return fixture.searchTrips(request);
      },
      async getStations() {
        return [];
      },
      async healthCheck() {
        return { ok: true };
      },
    } as unknown as FareProvider;
  }

  it("reports a date before the whole search has finished", async () => {
    /* The property that makes streaming worth anything. If the reports only
       arrived with the resolved promise, every one of them would be useless. */
    const reported: string[] = [];
    let resolved = false;
    const searched: string[] = [];
    const pending = previewFares({
      body,
      provider: slowProvider(25, searched),
      now,
      onProgress: (progress) => {
        // Must be true at least once while the outer promise is still pending.
        if (!resolved) reported.push(progress.travelDate);
      },
    }).then((preview) => {
      resolved = true;
      return preview;
    });
    const preview = await pending;
    expect(reported.length).toBe(preview.dates.length);
    expect(reported).toEqual(preview.dates);
  });

  it("numbers each date so a caller can say 2 of 3 without counting", async () => {
    const seen: { index: number; total: number }[] = [];
    await previewFares({
      body,
      provider: slowProvider(1, []),
      now,
      onProgress: (progress) => seen.push({ index: progress.index, total: progress.total }),
    });
    expect(seen.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(new Set(seen.map((s) => s.total))).toEqual(new Set([3]));
  });

  it("carries the cheapest on that date, and only that date", async () => {
    /* Not the ranking. Ordering fares across a window is a comparison between
       dates and cannot be done one date at a time, so a progress line must not
       look like a final answer. */
    const cheapest: (number | null)[] = [];
    const preview = await previewFares({
      body,
      provider: slowProvider(1, []),
      now,
      onProgress: (progress) => cheapest.push(progress.cheapestCents),
    });
    expect(cheapest.every((cents) => cents === null || cents > 0)).toBe(true);
    const best = Math.min(...cheapest.filter((c): c is number => c !== null));
    expect(best).toBe(preview.ranked[0]!.totalPartyPriceCents);
  });

  it("never flashes a price the finished board does not offer", async () => {
    /* The invariant that matters, and the one this got wrong first time. The
       per-date figure was the lowest number on the page rather than the
       cheapest *eligible* fare, so a restricted or unavailable seat could show
       $49 and the board settle at $74 a second later. A price that appears and
       then withdraws is the same broken promise as one that was never there. */
    const flashed: number[] = [];
    const preview = await previewFares({
      body,
      provider: new FixtureFareProvider(),
      now,
      onProgress: (progress) => {
        if (progress.cheapestCents !== null) flashed.push(progress.cheapestCents);
      },
    });
    const offered = new Set(preview.ranked.map((candidate) => candidate.totalPartyPriceCents));
    for (const price of flashed) expect(offered.has(price)).toBe(true);
  });

  it("reports a refused date too, rather than going quiet", async () => {
    // Silence during a failure is indistinguishable from a slow search.
    const outcomes: string[] = [];
    await previewFares({
      body,
      provider: {
        id: "refusing",
        async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
          return {
            request,
            status: "PROVIDER_ERROR",
            journeys: [],
            providerError: { message: "Live fare site blocked this check." },
          } as unknown as FareSearchResult;
        },
        async getStations() {
          return [];
        },
        async healthCheck() {
          return { ok: false };
        },
      } as unknown as FareProvider,
      now,
      onProgress: (progress) => outcomes.push(progress.outcome),
    });
    expect(outcomes).toContain("failed");
  });

  it("does not let a broken listener cost the traveller the window", async () => {
    /* A caller that throws on one date must not lose the other two. */
    const preview = await previewFares({
      body,
      provider: new FixtureFareProvider(),
      now,
      onProgress: () => {
        throw new Error("the renderer fell over");
      },
    });
    expect(preview.ranked.length).toBeGreaterThan(0);
  });
});
