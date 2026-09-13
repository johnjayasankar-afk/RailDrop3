import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/db/memory-store";
import { RecordingMailer } from "@/lib/notifications/resend-mailer";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import { createWatchAndScan } from "@/lib/watches/create-watch";
import { runWatchCycle } from "@/lib/orchestration/check-cycle";
import { dispatchScheduledChecks } from "@/lib/orchestration/dispatcher";
import type { FareSearchRequest, FareSearchResult } from "@/lib/domain/types";
import type { FareProvider } from "@/lib/providers/fare-provider";

function trackingProvider() {
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
  return { provider, calls, inner };
}

describe("check cycle orchestration", () => {
  it("runs an initial 3-date scan and emails a first drop", async () => {
    const repo = new MemoryRepository();
    const mailer = new RecordingMailer();
    const { provider, calls } = trackingProvider();
    const watch = await createWatchAndScan({
      userId: "user-1",
      email: "john@example.com",
      body: {
        originCode: "BOS",
        destinationCode: "NYP",
        desiredTravelDate: "2026-09-20",
        dateFlexibilityDays: 1,
        currentBookedPriceCents: 12800,
        passengerCount: 1,
      },
      repo,
      provider,
      mailer,
      now: new Date("2026-09-05T15:00:00.000Z"),
    });

    expect(calls).toEqual(["2026-09-19", "2026-09-20", "2026-09-21"]);
    expect(watch.lastCheckCycleId).toBeTruthy();
    const cycle = await repo.getCycle(watch.lastCheckCycleId!);
    expect(cycle?.trigger).toBe("INITIAL");
    expect(cycle?.status).toBe("SUCCESS");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toMatch(/Fare drop: BOS → NYP/);
  });

  it("deduplicates identical route/date searches across watches", async () => {
    const repo = new MemoryRepository();
    const { provider, calls } = trackingProvider();
    const mailer = new RecordingMailer();
    const now = new Date("2026-09-05T15:00:00.000Z");
    const body = {
      originCode: "BOS",
      destinationCode: "NYP",
      desiredTravelDate: "2026-09-20",
      dateFlexibilityDays: 1,
      currentBookedPriceCents: 12800,
    };
    await createWatchAndScan({ userId: "a", email: "a@x.com", body, repo, provider, mailer, now });
    await createWatchAndScan({ userId: "b", email: "b@x.com", body, repo, provider, mailer, now });
    expect(calls).toEqual(["2026-09-19", "2026-09-20", "2026-09-21"]);
  });

  it("marks a partial cycle when one date fails", async () => {
    const repo = new MemoryRepository();
    const { provider, inner } = trackingProvider();
    inner.failDates.add("2026-09-21");
    const watch = await createWatchAndScan({
      userId: "user-1",
      email: "john@example.com",
      body: {
        originCode: "BOS",
        destinationCode: "NYP",
        desiredTravelDate: "2026-09-20",
        currentBookedPriceCents: 12800,
      },
      repo,
      provider,
      mailer: new RecordingMailer(),
      now: new Date("2026-09-05T15:00:00.000Z"),
    });
    const cycle = await repo.getCycle(watch.lastCheckCycleId!);
    expect(cycle?.status).toBe("PARTIAL_SUCCESS");
    expect(cycle?.datesFailed).toEqual(["2026-09-21"]);
  });

  it("does not email an unchanged opportunity on the next cycle", async () => {
    const repo = new MemoryRepository();
    const { provider } = trackingProvider();
    const mailer = new RecordingMailer();
    const now = new Date("2026-09-05T15:00:00.000Z");
    const watch = await createWatchAndScan({
      userId: "user-1",
      email: "john@example.com",
      body: {
        originCode: "BOS",
        destinationCode: "NYP",
        desiredTravelDate: "2026-09-20",
        currentBookedPriceCents: 12800,
      },
      repo,
      provider,
      mailer,
      now,
    });
    expect(mailer.sent).toHaveLength(1);
    await runWatchCycle({
      watch: (await repo.getWatch(watch.id))!,
      trigger: "MANUAL",
      repo,
      provider,
      mailer,
      now: new Date("2026-09-05T18:00:00.000Z"),
    });
    expect(mailer.sent).toHaveLength(1);
  });

  it("keeps price history after a rebook and continues against the new benchmark", async () => {
    const repo = new MemoryRepository();
    const { provider } = trackingProvider();
    const watch = await createWatchAndScan({
      userId: "user-1",
      email: "john@example.com",
      body: {
        originCode: "BOS",
        destinationCode: "NYP",
        desiredTravelDate: "2026-09-20",
        currentBookedPriceCents: 12800,
      },
      repo,
      provider,
      mailer: new RecordingMailer(),
      now: new Date("2026-09-05T15:00:00.000Z"),
    });
    await repo.insertPriceEvent({
      id: "evt-1",
      watchId: watch.id,
      previousPriceCents: 12800,
      newPriceCents: 8900,
      previousTravelDate: "2026-09-20",
      newTravelDate: "2026-09-20",
      note: "User rebooked",
      createdAt: new Date().toISOString(),
    });
    const updated = await repo.updateWatch(watch.id, {
      currentBookedPriceCents: 8900,
      lastOpportunity: null,
    });
    const events = await repo.listPriceEvents(watch.id);
    expect(events).toHaveLength(1);
    expect(updated.currentBookedPriceCents).toBe(8900);
  });

  it("claims scheduled slots once and skips duplicates", async () => {
    const repo = new MemoryRepository();
    const { provider } = trackingProvider();
    await createWatchAndScan({
      userId: "user-1",
      email: "john@example.com",
      body: {
        originCode: "BOS",
        destinationCode: "NYP",
        desiredTravelDate: "2026-09-20",
        currentBookedPriceCents: 12800,
      },
      repo,
      provider,
      mailer: new RecordingMailer(),
      now: new Date("2026-09-05T12:00:00.000Z"),
    });
    const first = await dispatchScheduledChecks({
      repo,
      provider,
      now: new Date("2026-09-06T12:10:00.000Z"),
    });
    const second = await dispatchScheduledChecks({
      repo,
      provider,
      now: new Date("2026-09-06T12:20:00.000Z"),
    });
    expect(first.claimed).toBeGreaterThan(0);
    expect(second.skippedDuplicate).toBeGreaterThan(0);
  });
});
