import { describe, expect, it } from "vitest";
import { resolveMonitoringWindow, shouldCompleteWatch } from "@/lib/domain/monitoring";

describe("monitoring window", () => {
  it("supports 24h, 48h, and 72h from booked_at", () => {
    const bookedAt = new Date("2026-09-05T16:00:00.000Z");
    expect(
      resolveMonitoringWindow({
        bookedAt,
        preset: "24h",
        desiredTravelDate: "2026-09-20",
        flexibilityDays: 1,
        timeZone: "America/New_York",
      }).endAt?.toISOString(),
    ).toBe("2026-09-06T16:00:00.000Z");
    expect(
      resolveMonitoringWindow({
        bookedAt,
        preset: "48h",
        desiredTravelDate: "2026-09-20",
        flexibilityDays: 1,
        timeZone: "America/New_York",
      }).endAt?.toISOString(),
    ).toBe("2026-09-07T16:00:00.000Z");
    expect(
      resolveMonitoringWindow({
        bookedAt,
        preset: "72h",
        desiredTravelDate: "2026-09-20",
        flexibilityDays: 1,
        timeZone: "America/New_York",
      }).endAt?.toISOString(),
    ).toBe("2026-09-08T16:00:00.000Z");
  });

  it("completes when the window ends or no bookable dates remain", () => {
    expect(
      shouldCompleteWatch({
        now: new Date("2026-09-08T16:00:00.000Z"),
        monitorEndAt: new Date("2026-09-07T16:00:00.000Z"),
        desiredTravelDate: "2026-09-20",
        flexibilityDays: 1,
        timeZone: "America/New_York",
      }),
    ).toBe(true);
    expect(
      shouldCompleteWatch({
        now: new Date("2026-09-22T16:00:00.000Z"),
        monitorEndAt: null,
        desiredTravelDate: "2026-09-20",
        flexibilityDays: 1,
        timeZone: "America/New_York",
      }),
    ).toBe(true);
  });
});
