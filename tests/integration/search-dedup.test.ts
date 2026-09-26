import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/db/memory-store";
import { RecordingMailer } from "@/lib/notifications/resend-mailer";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import { createWatchAndScan } from "@/lib/watches/create-watch";
import type { FareProvider } from "@/lib/providers/fare-provider";
import type { FareSearchRequest, FareSearchResult } from "@/lib/domain/types";

/* One browser run per corridor and date, however many people are watching it.
 *
 * Reuse already worked when dispatch ran watches one at a time: the second
 * watch on a corridor always found the first one's finished row. Fan-out broke
 * that — each watch now gets its own invocation, so two can start the same
 * search in the same second, both miss the cache, and both launch Chromium.
 * The cache was not wrong, it was just too late to help.
 */

/** A provider that takes a controllable amount of time and counts real calls. */
function countingProvider(latencyMs = 0) {
  const inner = new FixtureFareProvider();
  const calls: string[] = [];
  const provider: FareProvider = {
    id: inner.id,
    async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
      calls.push(`${request.originCode}-${request.destinationCode}-${request.travelDate}`);
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
      return inner.searchTrips(request);
    },
    getStations: () => inner.getStations(),
    healthCheck: () => inner.healthCheck(),
  };
  return { provider, calls };
}

const body = (userSuffix: string) => ({
  originCode: "BOS",
  destinationCode: "NYP",
  desiredTravelDate: "2026-10-09",
  // Exact date: one search per watch, so the arithmetic below is unambiguous.
  dateFlexibilityDays: 0 as const,
  currentBookedPriceCents: 12800 + userSuffix.length,
  passengerCount: 1,
});

describe("cross-watch search dedup", () => {
  it("serves a second watcher of the same corridor from cache", async () => {
    const repo = new MemoryRepository();
    const { provider, calls } = countingProvider();
    const now = new Date("2026-09-26T12:00:00.000Z");

    await createWatchAndScan({
      userId: "alice",
      email: "alice@example.com",
      body: body("alice"),
      repo,
      provider,
      mailer: new RecordingMailer(),
      now,
    });
    await createWatchAndScan({
      userId: "bob",
      email: "bob@example.com",
      body: body("bob"),
      repo,
      provider,
      mailer: new RecordingMailer(),
      now: new Date(now.getTime() + 60_000),
    });

    // Two travelers, two watches, one browser run.
    expect(calls).toHaveLength(1);

    // And the saving is counted, so the cost model can be checked rather than
    // asserted. One live search, one reuse.
    const usage = await repo.getUsage("2026-09-26");
    expect(usage?.reused).toBe(1);
    expect(usage?.requests).toBe(1);
  });

  it("re-searches once the cached result is no longer fresh", async () => {
    const repo = new MemoryRepository();
    const { provider, calls } = countingProvider();
    const now = new Date("2026-09-26T12:00:00.000Z");

    await createWatchAndScan({
      userId: "alice",
      email: "a@example.com",
      body: body("a"),
      repo,
      provider,
      mailer: new RecordingMailer(),
      now,
    });
    // Well past the 20-minute freshness window: a price from an hour ago is
    // not an answer about now.
    await createWatchAndScan({
      userId: "bob",
      email: "b@example.com",
      body: body("b"),
      repo,
      provider,
      mailer: new RecordingMailer(),
      now: new Date(now.getTime() + 60 * 60_000),
    });

    expect(calls).toHaveLength(2);
  });

  it("does not launch two browsers when two workers race for the same search", async () => {
    const repo = new MemoryRepository();
    // Slow enough that the second worker certainly starts before the first
    // finishes — the shape of two fan-out invocations landing together.
    const { provider, calls } = countingProvider(400);
    const now = new Date("2026-09-26T12:00:00.000Z");

    await Promise.all([
      createWatchAndScan({
        userId: "alice",
        email: "alice@example.com",
        body: body("alice"),
        repo,
        provider,
        mailer: new RecordingMailer(),
        now,
      }),
      createWatchAndScan({
        userId: "bob",
        email: "bob@example.com",
        body: body("bob"),
        repo,
        provider,
        mailer: new RecordingMailer(),
        now,
      }),
    ]);

    // This is the regression the fan-out split introduced. Before the in-flight
    // marker it was 2.
    expect(calls).toHaveLength(1);
  });

  it("still gives both racing watches a real board", async () => {
    const repo = new MemoryRepository();
    const { provider } = countingProvider(300);
    const now = new Date("2026-09-26T12:00:00.000Z");

    const [a, b] = await Promise.all([
      createWatchAndScan({
        userId: "alice",
        email: "alice@example.com",
        body: body("alice"),
        repo,
        provider,
        mailer: new RecordingMailer(),
        now,
      }),
      createWatchAndScan({
        userId: "bob",
        email: "bob@example.com",
        body: body("bob"),
        repo,
        provider,
        mailer: new RecordingMailer(),
        now,
      }),
    ]);

    // Waiting for a peer must not cost the waiter its results. Both cycles
    // completed and both have journeys behind them.
    for (const watch of [a, b]) {
      const cycle = await repo.getCycle(watch.lastCheckCycleId!);
      expect(cycle?.status).toBe("SUCCESS");
      expect(await repo.listJourneysForCycle(cycle!.id)).not.toHaveLength(0);
    }
  });
});
