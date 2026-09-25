import { describe, expect, it } from "vitest";
import {
  extensionWindow,
  resolveMonitoringWindow,
  shouldCompleteWatch,
} from "@/lib/domain/monitoring";

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

describe("extensionWindow", () => {
  // Lives in the domain layer because reading the clock inside a React render
  // body is an impurity the compiler rejects — and because "+48h" is a claim
  // about the traveler's monitoring window, which deserves a test.
  const now = new Date("2026-09-20T12:00:00.000Z");

  it("starts now and ends the requested number of hours later", () => {
    expect(extensionWindow("24h", now)).toEqual({
      monitorStartAt: "2026-09-20T12:00:00.000Z",
      monitorEndAt: "2026-09-21T12:00:00.000Z",
    });
    expect(extensionWindow("48h", now).monitorEndAt).toBe("2026-09-22T12:00:00.000Z");
    expect(extensionWindow("72h", now).monitorEndAt).toBe("2026-09-23T12:00:00.000Z");
  });

  it("crosses a DST boundary by absolute hours, not wall clock", () => {
    // US DST ends 2026-11-01. 48 real hours from the 31st is the 2nd at the
    // same UTC instant; a naive date-arithmetic version would drift an hour.
    const before = new Date("2026-10-31T12:00:00.000Z");
    expect(extensionWindow("48h", before).monitorEndAt).toBe("2026-11-02T12:00:00.000Z");
  });
});
