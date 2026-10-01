import { describe, expect, it } from "vitest";
import { dateOutcomes, windowWasPartial } from "@/lib/domain/date-outcomes";

/* The colophon's counts have to add up.
 *
 * It prints "Dates requested N" and then the outcomes, and the only reason it
 * exists is to let a reader check that the page is accounting for everything
 * it looked at. A reader who subtracts is entitled to get zero.
 *
 * They did not add up. Unreadable dates were pushed into failedDates as well,
 * so one bad date of three rendered as "Answered 2 · Not answered 1 ·
 * Unreadable 1" — four outcomes for three dates, the same date claimed twice
 * and claimed as two things that are opposites. Separately, a date the
 * provider answered for with an empty board appeared in no array at all, so
 * it appeared in no row and the reader was left with an unexplained date.
 */

const preview = (over: Partial<Parameters<typeof dateOutcomes>[0]>) => ({
  dates: ["2026-10-08", "2026-10-09", "2026-10-10"],
  byDate: [] as Array<readonly [string, unknown]>,
  failedDates: [] as string[],
  unreadableDates: [] as string[],
  ...over,
});

describe("the four outcomes partition the window", () => {
  it("adds up when every date answered", () => {
    const out = dateOutcomes(
      preview({
        byDate: [
          ["2026-10-08", {}],
          ["2026-10-09", {}],
          ["2026-10-10", {}],
        ],
      }),
    );
    expect(out).toEqual({ answered: 3, empty: 0, failed: 0, unreadable: 0 });
    expect(out.answered + out.empty + out.failed + out.unreadable).toBe(3);
  });

  it("counts an unreadable date once, not twice", () => {
    const out = dateOutcomes(
      preview({
        byDate: [
          ["2026-10-08", {}],
          ["2026-10-10", {}],
        ],
        unreadableDates: ["2026-10-09"],
      }),
    );
    expect(out).toEqual({ answered: 2, empty: 0, failed: 0, unreadable: 1 });
  });

  it("still counts it once if a caller puts it in both arrays", () => {
    // The exact shape of the bug: the two sets overlapped at the source.
    const out = dateOutcomes(
      preview({
        byDate: [
          ["2026-10-08", {}],
          ["2026-10-10", {}],
        ],
        unreadableDates: ["2026-10-09"],
        failedDates: ["2026-10-09"],
      }),
    );
    expect(out).toEqual({ answered: 2, empty: 0, failed: 0, unreadable: 1 });
    expect(out.answered + out.empty + out.failed + out.unreadable).toBe(3);
  });

  it("gives an empty board its own row rather than losing it", () => {
    /* A date read cleanly with nothing for sale is not a date that failed.
       It used to appear in no array, so it appeared in no row and the four
       counts came up one short of the window. */
    const out = dateOutcomes(
      preview({ byDate: [["2026-10-08", {}]], failedDates: ["2026-10-10"] }),
    );
    expect(out).toEqual({ answered: 1, empty: 1, failed: 1, unreadable: 0 });
    expect(out.answered + out.empty + out.failed + out.unreadable).toBe(3);
  });

  it("adds up for every mixture of outcomes", () => {
    const dates = ["a", "b", "c", "d"];
    for (const failed of [[], ["b"], ["b", "c"]]) {
      for (const unreadable of [[], ["c"], ["c", "d"]]) {
        for (const answered of [[], ["a"], ["a", "b"]]) {
          const out = dateOutcomes({
            dates,
            byDate: answered.map((d) => [d, {}] as const),
            failedDates: failed,
            unreadableDates: unreadable,
          });
          expect(
            out.answered + out.empty + out.failed + out.unreadable,
            `${failed}/${unreadable}/${answered}`,
          ).toBe(dates.length);
        }
      }
    }
  });

  it("knows when a claim about the window would be partial", () => {
    expect(windowWasPartial({ answered: 3, empty: 0, failed: 0, unreadable: 0 })).toBe(false);
    // Nothing listed is a complete reading, not a gap in it.
    expect(windowWasPartial({ answered: 2, empty: 1, failed: 0, unreadable: 0 })).toBe(false);
    expect(windowWasPartial({ answered: 2, empty: 0, failed: 1, unreadable: 0 })).toBe(true);
    expect(windowWasPartial({ answered: 2, empty: 0, failed: 0, unreadable: 1 })).toBe(true);
  });
});
