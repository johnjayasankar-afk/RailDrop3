import { describe, expect, it } from "vitest";
import {
  generateSearchDates,
  dateOffsetDays,
  formatDaysUntil,
  daysUntilFlap,
} from "@/lib/domain/calendar";

describe("search dates", () => {
  it("supports exact date, ±1, and ±2", () => {
    expect(generateSearchDates("2026-09-20", 0, "2026-09-01").dates).toEqual(["2026-09-20"]);
    expect(generateSearchDates("2026-09-20", 1, "2026-09-01").dates).toEqual([
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
    ]);
    expect(generateSearchDates("2026-09-20", 2, "2026-09-01").dates).toEqual([
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
    ]);
  });

  it("crosses month and year boundaries", () => {
    expect(generateSearchDates("2026-10-01", 1, "2026-09-01").dates).toEqual([
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
    expect(generateSearchDates("2027-01-01", 1, "2026-12-01").dates).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("handles leap year", () => {
    expect(generateSearchDates("2028-02-29", 1, "2028-02-01").dates).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("skips dates that have already passed", () => {
    const window = generateSearchDates("2026-09-20", 1, "2026-09-20");
    expect(window.dates).toEqual(["2026-09-20", "2026-09-21"]);
    expect(window.skippedPastDates).toEqual(["2026-09-19"]);
  });

  it("computes date offsets", () => {
    expect(dateOffsetDays("2026-09-20", "2026-09-19")).toBe(-1);
    expect(dateOffsetDays("2026-09-20", "2026-09-20")).toBe(0);
    expect(dateOffsetDays("2026-09-20", "2026-09-21")).toBe(1);
  });

  it("describes how far travel day is", () => {
    expect(formatDaysUntil("2026-09-02", "2026-09-02")).toBe("Travels today");
    expect(formatDaysUntil("2026-09-03", "2026-09-02")).toBe("Travels tomorrow");
    expect(formatDaysUntil("2026-09-10", "2026-09-02")).toBe("Departs in 8 days");
    expect(formatDaysUntil("2026-09-01", "2026-09-02")).toBe("Travel date passed");
    expect(daysUntilFlap("2026-09-02", "2026-09-02")).toBe("TODAY");
    expect(daysUntilFlap("2026-09-03", "2026-09-02")).toBe("1 DAY");
    expect(daysUntilFlap("2026-09-10", "2026-09-02")).toBe("8 DAYS");
  });
});
