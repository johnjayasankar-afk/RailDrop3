import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/db/memory-store";
import { RecordingMailer } from "@/lib/notifications/resend-mailer";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import { createWatchAndScan } from "@/lib/watches/create-watch";
import type { FareProvider } from "@/lib/providers/fare-provider";
import type { FareSearchRequest, FareSearchResult, JourneyOption } from "@/lib/domain/types";

/* A misparse must not reach a person.
 *
 * "We never invent a price" held as a promise about fabrication — nothing in
 * the codebase synthesises a fare. It did not hold as a promise about accuracy.
 * A scraper that misread a page and reported $0.42 for Boston to New York would
 * have been ranked first, drawn on the board as a $127 saving, and put in an
 * email with a link to go and book it. The only thing between a parsed number
 * and somebody's inbox was that it was a number.
 *
 * These drive real cycles with a provider that returns bad data, and assert on
 * what came out the other end.
 */

const body = {
  originCode: "BOS",
  destinationCode: "NYP",
  desiredTravelDate: "2026-10-09",
  dateFlexibilityDays: 0 as const,
  currentBookedPriceCents: 12_800,
  alertEmail: "traveler@example.com",
};

const now = new Date("2026-09-26T12:00:00.000Z");

/** Wraps the fixtures and lets a test corrupt what comes back. */
function corruptingProvider(corrupt: (journeys: JourneyOption[]) => JourneyOption[]) {
  const inner = new FixtureFareProvider();
  const provider: FareProvider = {
    id: inner.id,
    async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
      const result = await inner.searchTrips(request);
      return { ...result, journeys: corrupt(result.journeys) };
    },
    getStations: () => inner.getStations(),
    healthCheck: () => inner.healthCheck(),
  };
  return provider;
}

/** Rewrites the cheapest fare's price, leaving everything else alone. */
function repriceCheapest(cents: number) {
  return (journeys: JourneyOption[]) => {
    let done = false;
    return journeys.map((journey) => ({
      ...journey,
      fares: journey.fares.map((fare) => {
        if (done) return fare;
        done = true;
        return { ...fare, totalPartyPriceCents: cents, pricePerTravelerCents: cents };
      }),
    }));
  };
}

async function run(provider: FareProvider) {
  const repo = new MemoryRepository();
  const mailer = new RecordingMailer();
  const watch = await createWatchAndScan({
    userId: "u1",
    email: "traveler@example.com",
    body,
    repo,
    provider,
    mailer,
    now,
  });
  const cycle = await repo.getCycle(watch.lastCheckCycleId!);
  const journeys = await repo.listJourneysForCycle(cycle!.id);
  const prices = journeys.flatMap((stored) =>
    stored.option.fares.map((fare) => fare.totalPartyPriceCents),
  );
  return { repo, mailer, watch, cycle, journeys, prices };
}

describe("one implausible fare among good ones", () => {
  it("never stores it", async () => {
    const { prices } = await run(corruptingProvider(repriceCheapest(42)));
    expect(prices).not.toContain(42);
    expect(prices.length).toBeGreaterThan(0);
  });

  it("never emails it", async () => {
    const { mailer } = await run(corruptingProvider(repriceCheapest(42)));
    for (const sent of mailer.sent) {
      expect(sent.text).not.toContain("$0.42");
      expect(sent.html).not.toContain("$0.42");
    }
  });

  it("never makes it the headline saving", async () => {
    const { watch } = await run(corruptingProvider(repriceCheapest(42)));
    expect(watch.bestPriceCents).not.toBe(42);
    if (watch.bestPriceCents !== null) expect(watch.bestPriceCents).toBeGreaterThan(300);
  });

  it("keeps the fares that were fine", async () => {
    // Dropping one bad row must not throw away the search.
    const clean = await run(new FixtureFareProvider());
    const dirty = await run(corruptingProvider(repriceCheapest(42)));
    expect(dirty.prices.length).toBe(clean.prices.length - 1);
    expect(dirty.cycle?.status).toBe("SUCCESS");
  });

  it("rejects an absurdly large price the same way", async () => {
    const { prices } = await run(corruptingProvider(repriceCheapest(9_999_999)));
    expect(prices).not.toContain(9_999_999);
  });
});

describe("a journey that does not answer the question we asked", () => {
  it("is dropped even when its price is perfectly reasonable", async () => {
    /* The shape of the St. Albans / San Francisco lookup bug: a code that
       resolves two ways and a provider that quietly answers about the wrong
       one. The fare is plausible. The journey is not ours. */
    const { journeys } = await run(
      corruptingProvider((all) =>
        all.map((journey, index) => (index === 0 ? { ...journey, originCode: "SAC" } : journey)),
      ),
    );
    expect(journeys.every((stored) => stored.option.originCode !== "SAC")).toBe(true);
  });

  it("drops a train that arrives before it leaves", async () => {
    const { journeys } = await run(
      corruptingProvider((all) =>
        all.map((journey, index) =>
          index === 0
            ? {
                ...journey,
                arrivalAt: journey.departureAt,
                departureAt: journey.arrivalAt,
                durationMinutes: null,
              }
            : journey,
        ),
      ),
    );
    for (const stored of journeys) {
      expect(Date.parse(stored.option.arrivalAt)).toBeGreaterThan(
        Date.parse(stored.option.departureAt),
      );
    }
  });
});

describe("a parser that has broken", () => {
  /** Everything priced at a penny: the page changed and nothing is being read. */
  const allBroken = corruptingProvider((journeys) =>
    journeys.map((journey) => ({
      ...journey,
      fares: journey.fares.map((fare) => ({
        ...fare,
        totalPartyPriceCents: 1,
        pricePerTravelerCents: 1,
      })),
    })),
  );

  it("stores nothing at all, rather than the rows that happened to pass", async () => {
    /* The trap this exists for. A broken parser does not fail uniformly: some
       rows are obviously wrong and some have errors that land inside the
       bounds. The second kind is the one that gets emailed. */
    const { journeys } = await run(allBroken);
    expect(journeys).toHaveLength(0);
  });

  it("calls the date failed, not empty", async () => {
    // "Nothing cheaper is listed" is a claim about the market. A search we
    // could not read gives us no basis for one.
    const { cycle } = await run(allBroken);
    expect(cycle?.datesFailed).toContain("2026-10-09");
    expect(cycle?.datesSucceeded).not.toContain("2026-10-09");
    expect(cycle?.status).not.toBe("SUCCESS");
  });

  it("sends no email", async () => {
    const { mailer } = await run(allBroken);
    expect(mailer.sent).toHaveLength(0);
  });

  it("records why, where the board can show it", async () => {
    const { repo, cycle } = await run(allBroken);
    const snapshots = await repo.listDateSnapshots(cycle!.id);
    const failed = snapshots.find((snapshot) => snapshot.status === "PROVIDER_ERROR");
    expect(failed?.errorMessage).toMatch(/plausibility check/i);
    expect(failed?.errorMessage).toMatch(/price_too_low/);
  });

  it("does not claim a best price it could not read", async () => {
    const { watch } = await run(allBroken);
    expect(watch.bestPriceCents).toBeNull();
  });
});

describe("an ordinary search", () => {
  it("is untouched by any of this", async () => {
    const { prices, cycle, journeys } = await run(new FixtureFareProvider());
    expect(journeys.length).toBeGreaterThan(0);
    expect(cycle?.status).toBe("SUCCESS");
    expect(prices.every((price) => price !== null && price > 300)).toBe(true);
  });
});
