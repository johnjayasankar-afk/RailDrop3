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

/* The one claim this product must never make without having looked.
 *
 * A reuse serves a completed row's journeys from the cache. Both repositories
 * returned `[]` when there was no cache entry — the same value they return for
 * a search that genuinely found nothing — and check-cycle handed that straight
 * on as a result carrying the row's own SUCCESS status. A traveler was told
 * "no cheaper fare on this date" about a date nobody had looked at.
 *
 * Everything around it is careful about exactly this. A deadline skip is
 * recorded as PROVIDER_ERROR so a paused check cannot read as a quiet market
 * (check-cycle.ts, "Not attempted"); `empty-result.ts` exists to separate
 * "no trains" from "failed read". The cache miss walked past all of it,
 * because a missing payload and an empty one were the same array.
 *
 * The payload can go missing for ordinary reasons: search_cache is a separate
 * table from provider_requests, so any partial write, retention sweep, restore
 * or manual cleanup leaves a completed row pointing at nothing.
 */
describe("a cache miss is not an observation", () => {
  it("re-searches instead of reporting an empty market", async () => {
    const repo = new MemoryRepository();
    const { provider, calls } = countingProvider();
    const now = new Date("2026-09-26T12:00:00.000Z");

    const first = await createWatchAndScan({
      userId: "alice",
      email: "alice@example.com",
      body: body("alice"),
      repo,
      provider,
      mailer: new RecordingMailer(),
      now,
    });
    expect(calls).toHaveLength(1);
    expect(first).toBeTruthy();

    /* Lose the payload, keep the completed row. Simulated through the
       repository rather than by adding a delete method the product does not
       need: search_cache is a separate table from provider_requests, so a
       partial write, a retention sweep, a restore or a manual cleanup all
       leave a completed row pointing at nothing, and every one of them reaches
       this code as exactly this — the row is found, the payload is not. */
    const lostCache = new Proxy(repo, {
      get(target, property, receiver) {
        if (property === "getCachedJourneys") return async () => null;
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    // Inside the freshness window, so the planner still wants to reuse it.
    const second = await createWatchAndScan({
      userId: "bob",
      email: "bob@example.com",
      body: body("bob"),
      repo: lostCache,
      provider,
      mailer: new RecordingMailer(),
      now: new Date(now.getTime() + 60_000),
    });

    // The point: it looked, rather than reporting the hole as an empty board.
    expect(calls).toHaveLength(2);
    /* And it came back with a real observation rather than a blank. This is
       the assertion that would have failed loudest on the old code: a served
       cache miss produced SUCCESS with zero journeys, so the watch recorded a
       completed check and no best price — indistinguishable, from here and
       from the board, from a corridor with nothing on it. */
    expect(second.lastCheckedAt).toBeTruthy();
    expect(second.bestPriceCents).toBeGreaterThan(0);
  });

  it("still distinguishes a cached empty result from a missing one", async () => {
    const repo = new MemoryRepository();
    await repo.cacheJourneys("req-empty", []);
    expect(await repo.getCachedJourneys("req-empty")).toEqual([]);
    expect(await repo.getCachedJourneys("req-never-written")).toBeNull();
  });
});
