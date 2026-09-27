import { describe, expect, it } from "vitest";
import { previewFares } from "@/lib/watches/preview-fares";
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
