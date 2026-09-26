import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/db/memory-store";
import { RecordingMailer } from "@/lib/notifications/resend-mailer";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import { createWatchAndScan } from "@/lib/watches/create-watch";
import { resetConfigCache } from "@/lib/config";
import type { FareProvider } from "@/lib/providers/fare-provider";
import type { FareSearchRequest, FareSearchResult } from "@/lib/domain/types";

/* A spent budget pauses checks. It must never look like a quiet market.
 *
 * The ceiling used to be a number on the settings page that nothing enforced.
 * What makes it delicate is not the arithmetic, it is the reporting: a date
 * nobody searched has to read as "we did not look", never as "nothing cheaper
 * was found". Those are opposite claims and only one of them is true.
 */

function countingProvider() {
  const inner = new FixtureFareProvider();
  const calls: string[] = [];
  const provider: FareProvider = {
    id: inner.id,
    async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
      calls.push(request.travelDate);
      return inner.searchTrips(request);
    },
    getStations: () => inner.getStations(),
    healthCheck: () => inner.healthCheck(),
  };
  return { provider, calls };
}

const now = new Date("2026-09-26T12:00:00.000Z");
const body = {
  originCode: "BOS",
  destinationCode: "NYP",
  desiredTravelDate: "2026-10-09",
  dateFlexibilityDays: 1 as const,
  currentBookedPriceCents: 12800,
  passengerCount: 1,
};

async function withDailyCap<T>(cap: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.PROVIDER_DAILY_SEARCH_BUDGET;
  if (cap === undefined) delete process.env.PROVIDER_DAILY_SEARCH_BUDGET;
  else process.env.PROVIDER_DAILY_SEARCH_BUDGET = cap;
  resetConfigCache();
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PROVIDER_DAILY_SEARCH_BUDGET;
    else process.env.PROVIDER_DAILY_SEARCH_BUDGET = previous;
    resetConfigCache();
  }
}

describe("provider budget", () => {
  it("searches freely when no ceiling is configured", async () => {
    await withDailyCap(undefined, async () => {
      const repo = new MemoryRepository();
      const { provider, calls } = countingProvider();
      await createWatchAndScan({
        userId: "u1",
        email: "a@example.com",
        body,
        repo,
        provider,
        mailer: new RecordingMailer(),
        now,
      });
      // ±1 day is three dates, all searched.
      expect(calls).toHaveLength(3);
    });
  });

  it("stops searching once the day's ceiling is spent", async () => {
    await withDailyCap("2", async () => {
      const repo = new MemoryRepository();
      const { provider, calls } = countingProvider();
      // Spend the allowance before the cycle runs.
      await repo.incrementUsage("2026-09-26", 4, 2, 2, 0, 0);

      const watch = await createWatchAndScan({
        userId: "u1",
        email: "a@example.com",
        body,
        repo,
        provider,
        mailer: new RecordingMailer(),
        now,
      });

      expect(calls).toHaveLength(0);

      const cycle = await repo.getCycle(watch.lastCheckCycleId!);
      // Every date failed for want of budget, so the cycle is an error — not a
      // cycle that looked and found nothing.
      expect(cycle?.status).toBe("PROVIDER_ERROR");
      expect(cycle?.datesSucceeded).toEqual([]);
      expect(cycle?.datesFailed).toHaveLength(3);
    });
  });

  it("says the budget is why, rather than implying an empty market", async () => {
    await withDailyCap("1", async () => {
      const repo = new MemoryRepository();
      const { provider } = countingProvider();
      await repo.incrementUsage("2026-09-26", 2, 1, 1, 0, 0);

      const watch = await createWatchAndScan({
        userId: "u1",
        email: "a@example.com",
        body,
        repo,
        provider,
        mailer: new RecordingMailer(),
        now,
      });

      const snapshots = await repo.listDateSnapshots(watch.lastCheckCycleId!);
      expect(snapshots).not.toHaveLength(0);
      for (const snapshot of snapshots) {
        expect(snapshot.status).toBe("PROVIDER_ERROR");
        // The words matter: this is the difference between "we paused" and
        // "there is nothing cheaper", which a traveler would act on.
        expect(snapshot.errorMessage ?? "").toMatch(/budget/i);
        expect(snapshot.status).not.toBe("NO_INVENTORY");
      }
    });
  });

  it("sends no alert from a cycle that never looked", async () => {
    await withDailyCap("1", async () => {
      const repo = new MemoryRepository();
      const { provider } = countingProvider();
      const mailer = new RecordingMailer();
      await repo.incrementUsage("2026-09-26", 2, 1, 1, 0, 0);

      await createWatchAndScan({
        userId: "u1",
        email: "a@example.com",
        body,
        repo,
        provider,
        mailer,
        now,
      });

      // An alert from a cycle with no observations would be inventing one.
      expect(mailer.sent).toHaveLength(0);
    });
  });
});
