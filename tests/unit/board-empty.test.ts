import { describe, expect, it } from "vitest";
import { emptyBoardState, type EmptyBoardInput } from "@/lib/domain/board-empty";

/* The board said "No other trains for this filter." for every empty board.
 *
 * True when you have filtered everything out; false the rest of the time. And
 * one of the times it is false now matters a great deal: a search we could not
 * read looks exactly like a corridor with nothing cheaper, and those are
 * opposite claims. One is about the market. The other is about us.
 */

function input(patch: Partial<EmptyBoardInput> = {}): EmptyBoardInput {
  return {
    scanning: false,
    unreadableDates: 0,
    failedDates: 0,
    totalDates: 5,
    rankedCount: 12,
    visibleCount: 0,
    filtersActive: false,
    watchStatus: "ACTIVE",
    daysUntilTravel: 14,
    nextCheckLabel: "8:00 PM",
    ...patch,
  };
}

describe("what the board says when it is empty", () => {
  it("nothing cheaper is the ordinary case, and it is about the market", () => {
    const state = emptyBoardState(input());
    expect(state.reason).toBe("none-cheaper");
    expect(state.ourFault).toBe(false);
    expect(state.body).toContain("12 trains are listed");
    expect(state.body).toContain("8:00 PM");
  });

  it("distinguishes nothing listed from nothing cheaper", () => {
    // "No trains are listed" and "none of them are cheaper" are different facts
    // about the corridor, and the second implies the first is false.
    const state = emptyBoardState(input({ rankedCount: 0 }));
    expect(state.reason).toBe("no-inventory");
    expect(state.body).toMatch(/not a problem at our end/i);
  });

  it("blames us when we could not read the listings", () => {
    /* The one that matters. This must never read as "nothing is cheaper" — we
       have no basis for a claim about the market from a search we could not
       parse. */
    const state = emptyBoardState(input({ unreadableDates: 5, visibleCount: 0 }));
    expect(state.reason).toBe("unreadable");
    expect(state.ourFault).toBe(true);
    expect(state.body).toMatch(/problem at our end/i);
    expect(state.body).toMatch(/not a sold-out corridor/i);
    expect(state.body).not.toMatch(/nothing cheaper|none of them beat/i);
  });

  it("says how much of the window was unreadable when only part was", () => {
    const state = emptyBoardState(input({ unreadableDates: 2, totalDates: 5 }));
    expect(state.body).toContain("2 of 5 days");
    expect(state.ourFault).toBe(true);
  });

  it("blames us when every date failed outright", () => {
    const state = emptyBoardState(input({ rankedCount: 0, failedDates: 5, totalDates: 5 }));
    expect(state.reason).toBe("unreadable");
    expect(state.ourFault).toBe(true);
    expect(state.action).toBe("recheck");
  });

  it("says the reader hid these rows, not that the corridor is empty", () => {
    // Telling someone the corridor is empty when they narrowed it to one train
    // is both wrong and slightly insulting.
    const state = emptyBoardState(input({ filtersActive: true, rankedCount: 12 }));
    expect(state.reason).toBe("filtered");
    expect(state.action).toBe("clear-filters");
    expect(state.body).toContain("12 trains are listed");
  });

  it("does not blame filters when there was nothing to filter", () => {
    const state = emptyBoardState(input({ filtersActive: true, rankedCount: 0 }));
    expect(state.reason).toBe("no-inventory");
  });

  it("says it is looking while it is looking", () => {
    expect(emptyBoardState(input({ scanning: true })).reason).toBe("scanning");
    expect(emptyBoardState(input({ scanning: true })).action).toBeNull();
  });
});

describe("watches that are not watching", () => {
  it("says paused, and offers to resume", () => {
    const state = emptyBoardState(input({ watchStatus: "PAUSED" }));
    expect(state.reason).toBe("paused");
    expect(state.action).toBe("resume");
    expect(state.body).toMatch(/nothing is being missed on purpose/i);
  });

  it("says finished, and offers a new one", () => {
    const state = emptyBoardState(input({ watchStatus: "COMPLETED" }));
    expect(state.reason).toBe("completed");
    expect(state.action).toBe("new-watch");
  });

  it("says the train has gone once the date has passed", () => {
    const state = emptyBoardState(input({ daysUntilTravel: -1 }));
    expect(state.reason).toBe("departed");
    expect(state.body).toMatch(/price history is still here/i);
  });

  it("never claims to still be watching a paused or finished trip", () => {
    for (const patch of [
      { watchStatus: "PAUSED" as const },
      { watchStatus: "COMPLETED" as const },
      { daysUntilTravel: -3 },
    ]) {
      const state = emptyBoardState(input(patch));
      expect(state.body, state.reason).not.toMatch(
        /still watching|we look again|write the moment/i,
      );
    }
  });
});

describe("the order of the branches is the design", () => {
  it("puts an unreadable search ahead of any claim about inventory", () => {
    // We do not know what is listed, so we must not imply anything about it.
    const state = emptyBoardState(input({ unreadableDates: 3, rankedCount: 0 }));
    expect(state.reason).toBe("unreadable");
  });

  it("puts a departed trip ahead of a paused one", () => {
    // "Paused" invites you to resume. There is nothing to resume.
    const state = emptyBoardState(input({ daysUntilTravel: -1, watchStatus: "PAUSED" }));
    expect(state.reason).toBe("departed");
  });

  it("puts scanning ahead of everything, because the rest is not settled yet", () => {
    const state = emptyBoardState(
      input({ scanning: true, unreadableDates: 5, watchStatus: "PAUSED" }),
    );
    expect(state.reason).toBe("scanning");
  });

  it("puts a paused watch ahead of filters", () => {
    const state = emptyBoardState(input({ watchStatus: "PAUSED", filtersActive: true }));
    expect(state.reason).toBe("paused");
  });
});

describe("every state is usable", () => {
  const cases: Array<[string, Partial<EmptyBoardInput>]> = [
    ["ordinary", {}],
    ["scanning", { scanning: true }],
    ["unreadable", { unreadableDates: 5 }],
    ["part unreadable", { unreadableDates: 2 }],
    ["all failed", { rankedCount: 0, failedDates: 5 }],
    ["departed", { daysUntilTravel: -2 }],
    ["completed", { watchStatus: "COMPLETED" as const }],
    ["paused", { watchStatus: "PAUSED" as const }],
    ["filtered", { filtersActive: true }],
    ["no inventory", { rankedCount: 0 }],
    ["no next check known", { nextCheckLabel: null }],
    ["one train", { rankedCount: 1 }],
    ["zero dates", { totalDates: 0, rankedCount: 0 }],
  ];

  for (const [name, patch] of cases) {
    it(`says something real for: ${name}`, () => {
      const state = emptyBoardState(input(patch));
      expect(state.title.length, name).toBeGreaterThan(3);
      expect(state.body.length, name).toBeGreaterThan(30);
      // No half-built sentences from a missing value.
      expect(state.body, name).not.toMatch(/undefined|null|NaN/);
      expect(state.title, name).not.toMatch(/undefined|null|NaN/);
    });
  }

  it("uses singular English for one train", () => {
    expect(emptyBoardState(input({ rankedCount: 1 })).body).toContain("1 train is listed");
  });

  it("only offers an action that could change the outcome", () => {
    // A recheck button on a paused watch does nothing. Offering it is worse
    // than offering nothing.
    expect(emptyBoardState(input({ watchStatus: "PAUSED" })).action).toBe("resume");
    expect(emptyBoardState(input()).action).toBeNull();
    expect(emptyBoardState(input({ rankedCount: 0 })).action).toBeNull();
  });
});
