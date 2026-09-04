import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPersistedMemoryRepository } from "@/lib/db/local-persist";
import type { WatchRecord } from "@/lib/db/models";

function stubWatch(id: string): WatchRecord {
  return {
    id,
    userId: "user-1",
    originCode: "BOS",
    destinationCode: "NYP",
    desiredTravelDate: "2026-09-23",
    dateFlexibilityDays: 0,
    preferredDepartureTime: null,
    passengerCount: 1,
    bookedTrainNumber: null,
    bookedDepartureAt: null,
    bookedFareFamily: "FLEXIBLE",
    travelClass: "COACH",
    currentBookedPriceCents: 25000,
    includeRestrictedFares: false,
    includeThruway: false,
    minimumSavingsCents: 100,
    bookedAt: "2026-09-03T00:00:00.000Z",
    monitorStartAt: "2026-09-03T00:00:00.000Z",
    monitorEndAt: null,
    monitorPreset: "48h",
    timezone: "America/New_York",
    alertEmail: "john@example.com",
    status: "ACTIVE",
    lastCheckCycleId: null,
    lastCheckedAt: null,
    nextCheckSlot: null,
    nextCheckAtLabel: null,
    bestPriceCents: null,
    bestSavingsCents: null,
    lastOpportunity: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
  };
}

describe("local persist", () => {
  it("writes watches to disk and hydrates them after a restart", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "raildrop-persist-"));
    const filePath = path.join(dir, "raildrop-local.json");
    try {
      const first = createPersistedMemoryRepository(filePath);
      await first.createWatch(stubWatch("watch-1"));
      const saved = JSON.parse(readFileSync(filePath, "utf8")) as {
        watches: Array<{ id: string }>;
      };
      expect(saved.watches.map((watch) => watch.id)).toEqual(["watch-1"]);

      const second = createPersistedMemoryRepository(filePath);
      const restored = await second.getWatch("watch-1");
      expect(restored?.originCode).toBe("BOS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
