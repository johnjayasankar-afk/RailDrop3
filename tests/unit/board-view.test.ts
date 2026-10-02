import { describe, expect, it } from "vitest";
import {
  narrow,
  orphanedHeadline,
  parseClock,
  viewIsNarrowed,
  WHOLE_BOARD,
  type BoardView,
} from "@/lib/domain/board-view";
import type { RankedCandidate } from "@/lib/domain/types";

/* Narrowing the board you already paid for, without the ways it can lie. */

const fare = (over: {
  date?: string;
  depart?: string;
  transfers?: number;
  price?: number;
}): RankedCandidate =>
  ({
    journey: {
      id: `${over.date}-${over.depart}`,
      searchedTravelDate: over.date ?? "2026-10-09",
      departureAt: over.depart ?? "2026-10-09T08:00:00",
      arrivalAt: "2026-10-09T12:00:00",
      serviceName: "Northeast Regional",
      trainNumber: "95",
      transferCount: over.transfers ?? 0,
      durationMinutes: 240,
    },
    fare: { id: "f" },
    totalPartyPriceCents: over.price ?? 10_000,
    savingsCents: 0,
  }) as unknown as RankedCandidate;

const board = [
  fare({ date: "2026-10-08", depart: "2026-10-08T07:00:00", price: 9100 }),
  fare({ date: "2026-10-09", depart: "2026-10-09T08:00:00", price: 16_700 }),
  fare({ date: "2026-10-09", depart: "2026-10-09T19:00:00", price: 21_100, transfers: 1 }),
];

const view = (over: Partial<BoardView> = {}): BoardView => ({ ...WHOLE_BOARD, ...over });

describe("narrowing a board already paid for", () => {
  it("leaves the whole board alone by default", () => {
    expect(narrow(board, WHOLE_BOARD)).toHaveLength(3);
    expect(viewIsNarrowed(WHOLE_BOARD)).toBe(false);
  });

  it("narrows to one date", () => {
    const only = narrow(board, view({ date: "2026-10-09" }));
    expect(only).toHaveLength(2);
    expect(only.every((c) => c.journey.searchedTravelDate === "2026-10-09")).toBe(true);
  });

  it("narrows to nonstop", () => {
    expect(narrow(board, view({ nonstopOnly: true }))).toHaveLength(2);
  });

  it("does not empty the board on a half-typed time", () => {
    /* filterBoard treats an unparseable non-empty string as "match nothing":
       the regex fails and every candidate returns false. So the board went
       blank on the first keystroke of "17:00" — at "1", at "17", and at
       "17:" — and came back only on the last character. */
    for (const half of ["1", "17", "17:", "5pm", "noon"]) {
      expect(parseClock(half), half).toBeNull();
      expect(narrow(board, view({ departAfter: half })), half).toHaveLength(3);
    }
    expect(parseClock("17:00")).toBe("17:00");
    expect(narrow(board, view({ departAfter: "17:00" }))).toHaveLength(1);
  });

  it("will not filter on the reader's own private figure", () => {
    /* savingsCents is derived from what the reader typed into "what you
       paid". No control and no URL may select it. */
    const withSavings = board.map(
      (c) => ({ ...c, savingsCents: 0 }) as unknown as RankedCandidate,
    );
    expect(narrow(withSavings, WHOLE_BOARD)).toHaveLength(3);
    expect(Object.keys(WHOLE_BOARD)).not.toContain("savingsOnly");
  });

  it("knows when the headline fare is not in what is shown", () => {
    /* The headline stays bound to the whole reading, so a filter can leave
       "$91 · cheapest of 34 listed" directly above a list with no $91 in it. */
    const cheapest = board[0]!;
    const filtered = narrow(board, view({ date: "2026-10-09" }));
    expect(orphanedHeadline(filtered, cheapest)).toBe(cheapest);
    expect(orphanedHeadline(narrow(board, WHOLE_BOARD), cheapest)).toBeNull();
    expect(orphanedHeadline(filtered, undefined)).toBeNull();
  });
});
