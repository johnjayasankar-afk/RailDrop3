import { describe, expect, it } from "vitest";
import {
  dueSlotsAt,
  formatBoardStamp,
  formatClock,
  formatInstantClock,
  nextSlotAfter,
  SLOT_HOURS,
} from "@/lib/domain/timezone";

describe("DST-safe slots", () => {
  it("treats 08/14/20 local wall times as due using IANA zones", () => {
    const edt = new Date("2026-03-08T12:05:00.000Z");
    const dueEdt = dueSlotsAt(edt, "America/New_York");
    expect(dueEdt.some((item) => item.slot === "MORNING" && item.localDate === "2026-03-08")).toBe(
      true,
    );

    const est = new Date("2026-11-01T13:05:00.000Z");
    const dueEst = dueSlotsAt(est, "America/New_York");
    expect(dueEst.some((item) => item.slot === "MORNING" && item.localDate === "2026-11-01")).toBe(
      true,
    );
  });

  it("does not mark a future slot due", () => {
    const beforeAfternoon = new Date("2026-09-20T15:00:00.000Z");
    const due = dueSlotsAt(beforeAfternoon, "America/New_York");
    expect(due.map((item) => item.slot)).toEqual(["MORNING"]);
    expect(nextSlotAfter(beforeAfternoon, "America/New_York").slot).toBe("AFTERNOON");
  });

  it("keeps slot hours stable", () => {
    expect(SLOT_HOURS).toEqual({ MORNING: 8, AFTERNOON: 14, EVENING: 20 });
  });

  it("stamps the board clock in the watch timezone", () => {
    expect(formatBoardStamp("2026-09-02T16:05:00.000Z", "America/New_York")).toMatch(/Sep 2/);
    expect(formatBoardStamp("2026-09-02T16:05:00.000Z", "America/New_York")).toMatch(/12:05/);
    expect(formatBoardStamp(null, "America/New_York")).toBeNull();
  });
});

describe("the read-at stamp", () => {
  it("renders an instant in its zone, not the UTC hour as a local one", () => {
    /* The regression: checkedAt is an ISO instant (…Z) and went through
       formatClock, which slices the hour out of the literal string. A reading
       taken at 4:12 PM in New York printed "8:12 PM" — four hours into the
       future, on the field that exists to say how stale the fare is. */
    expect(formatInstantClock("2026-10-01T20:12:00.000Z", "America/New_York")).toBe("4:12 PM EDT");
    expect(formatClock("2026-10-01T20:12:00.000Z")).toBe("8:12 PM");
  });

  it("says which zone it is, because a bare clock is how this hid", () => {
    expect(formatInstantClock("2026-01-15T20:12:00.000Z", "America/New_York")).toBe("3:12 PM EST");
    expect(formatInstantClock("2026-10-01T20:12:00.000Z", "America/Los_Angeles")).toBe(
      "1:12 PM PDT",
    );
  });

  it("falls back to the default zone rather than throwing on a bad one", () => {
    expect(formatInstantClock("2026-10-01T20:12:00.000Z", "Mars/Olympus")).toBe("4:12 PM EDT");
  });
});
