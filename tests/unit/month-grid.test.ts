import { describe, expect, it } from "vitest";
import { monthGrid, monthOf, moveByKey, shiftMonth } from "@/lib/domain/month-grid";

/* The month a date picker draws.
 *
 * All of it is UTC arithmetic, for the same reason the rest of calendar.ts is:
 * a picker built on local Date parts drifts on the two days a year the clocks
 * change, and a travel window that quietly loses a day is a wrong answer that
 * looks like a right one.
 */

const today = "2026-09-28";

describe("paging between months", () => {
  it("crosses a year boundary in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("survives a jump of more than a year", () => {
    expect(shiftMonth("2026-05", 14)).toBe("2027-07");
    expect(shiftMonth("2026-05", -17)).toBe("2024-12");
  });

  it("reads the month off a date", () => {
    expect(monthOf("2026-10-04")).toBe("2026-10");
  });
});

describe("the grid", () => {
  const grid = monthGrid({ month: "2026-10", selected: "2026-10-04", today });

  it("is always six complete weeks", () => {
    /* A month that fits in five would make the popover change height as you
       page, moving the buttons out from under the cursor. */
    expect(grid.weeks).toHaveLength(6);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
  });

  it("starts on the Sunday on or before the first", () => {
    const first = grid.weeks[0]![0]!;
    expect(new Date(`${first.iso}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(first.iso <= "2026-10-01").toBe(true);
  });

  it("runs the month's days in order with no gaps", () => {
    const inMonth = grid.weeks.flat().filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0]!.iso).toBe("2026-10-01");
    expect(inMonth.at(-1)!.iso).toBe("2026-10-31");
  });

  it("marks the borrowed days from either side", () => {
    const borrowed = grid.weeks.flat().filter((cell) => !cell.inMonth);
    expect(borrowed.length).toBe(42 - 31);
    expect(borrowed.every((cell) => !cell.iso.startsWith("2026-10"))).toBe(true);
  });

  it("marks today and the selection", () => {
    const flat = grid.weeks.flat();
    expect(flat.filter((cell) => cell.isSelected).map((c) => c.iso)).toEqual(["2026-10-04"]);
    const september = monthGrid({ month: "2026-09", selected: null, today });
    expect(
      september.weeks
        .flat()
        .filter((cell) => cell.isToday)
        .map((c) => c.iso),
    ).toEqual([today]);
  });

  it("marks today even when it is a day borrowed from the month before", () => {
    /* October 2026 begins on a Thursday, so its first row borrows 27-30
       September and today is one of them. Marking it only when it belongs to
       the month on display would drop the ring on exactly the view where
       someone is looking for it. */
    const borrowed = grid.weeks.flat().filter((cell) => cell.isToday);
    expect(borrowed.map((c) => c.iso)).toEqual([today]);
    expect(borrowed[0]!.inMonth).toBe(false);
  });

  it("handles February in a leap year", () => {
    const leap = monthGrid({ month: "2028-02", selected: null, today });
    const inMonth = leap.weeks.flat().filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth.at(-1)!.iso).toBe("2028-02-29");
  });

  it("handles a month that needs six rows", () => {
    // A 31-day month starting on a Friday spills into a sixth week.
    const may = monthGrid({ month: "2026-05", selected: null, today });
    expect(may.weeks.flat().filter((cell) => cell.inMonth)).toHaveLength(31);
  });
});

describe("the selectable range", () => {
  it("disables days before the minimum but still draws them", () => {
    /* Drawing them matters: leaving a hole would misalign the rest of the week
       and the column headings would stop meaning anything. */
    const grid = monthGrid({ month: "2026-09", selected: null, today, min: today });
    const flat = grid.weeks.flat();
    expect(flat.find((c) => c.iso === "2026-09-27")!.disabled).toBe(true);
    expect(flat.find((c) => c.iso === "2026-09-28")!.disabled).toBe(false);
    expect(flat).toHaveLength(42);
  });

  it("disables days after the maximum", () => {
    const grid = monthGrid({ month: "2026-10", selected: null, today, max: "2026-10-15" });
    const flat = grid.weeks.flat();
    expect(flat.find((c) => c.iso === "2026-10-15")!.disabled).toBe(false);
    expect(flat.find((c) => c.iso === "2026-10-16")!.disabled).toBe(true);
  });

  it("still allows paging into the month that contains the boundary", () => {
    /* The edge day being out of range must not lock the month holding it —
       a minimum of the 20th has to leave the 20th reachable. */
    const grid = monthGrid({ month: "2026-10", selected: null, today, min: "2026-09-20" });
    expect(grid.canGoPrev).toBe(true);
  });

  it("stops paging past a month that is entirely out of range", () => {
    const grid = monthGrid({ month: "2026-10", selected: null, today, min: "2026-10-01" });
    expect(grid.canGoPrev).toBe(false);
  });
});

describe("arrow keys", () => {
  it("moves by day and by week", () => {
    expect(moveByKey("2026-10-04", "ArrowRight")).toBe("2026-10-05");
    expect(moveByKey("2026-10-04", "ArrowLeft")).toBe("2026-10-03");
    expect(moveByKey("2026-10-04", "ArrowDown")).toBe("2026-10-11");
    expect(moveByKey("2026-10-04", "ArrowUp")).toBe("2026-09-27");
  });

  it("returns null for a key it does not handle", () => {
    // So the caller can leave Tab alone. A picker that eats Tab is a trap.
    expect(moveByKey("2026-10-04", "Tab")).toBeNull();
    expect(moveByKey("2026-10-04", "a")).toBeNull();
  });

  it("refuses to leave the range instead of clamping to its edge", () => {
    /* Clamping makes a held-down arrow look stuck rather than finished. */
    expect(moveByKey("2026-09-28", "ArrowLeft", { min: "2026-09-28" })).toBe("2026-09-28");
    expect(moveByKey("2026-10-15", "ArrowRight", { max: "2026-10-15" })).toBe("2026-10-15");
  });
});
