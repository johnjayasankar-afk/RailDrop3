import { describe, expect, it } from "vitest";
import {
  boardReducer,
  clockFiltersActive,
  filtersActive,
  initialBoardState,
  type BoardAction,
  type BoardState,
} from "@/lib/domain/board-state";

const run = (actions: BoardAction[], from: BoardState = initialBoardState): BoardState =>
  actions.reduce(boardReducer, from);

describe("boardReducer — purity", () => {
  it("never mutates the state it was given", () => {
    const before = { ...initialBoardState, pins: ["a"], hiddenKeys: ["b"], picked: ["c"] };
    const snapshot = JSON.parse(JSON.stringify(before));
    boardReducer(before, { type: "TOGGLE_PIN", key: "z" });
    boardReducer(before, { type: "HIDE", key: "z", nextFocus: null });
    boardReducer(before, { type: "TOGGLE_PICK", key: "z" });
    boardReducer(before, { type: "RESET_VIEW" });
    expect(before).toEqual(snapshot);
  });

  it("returns the same object when an action cannot apply", () => {
    // Referential equality matters: it is what lets memoised children skip work.
    const state = { ...initialBoardState, focusKey: "a" };
    expect(boardReducer(state, { type: "MOVE_FOCUS", direction: "next", keys: [] })).toBe(state);
    expect(boardReducer(state, { type: "UNDO_HIDE" })).toBe(state);
    const hidden = { ...initialBoardState, hiddenKeys: ["a"] };
    expect(boardReducer(hidden, { type: "HIDE", key: "a", nextFocus: null })).toBe(hidden);
  });
});

describe("boardReducer — filters", () => {
  it("sets each filter independently", () => {
    const state = run([
      { type: "SET_DATE", date: "2026-09-20" },
      { type: "SET_SERVICE", service: "acela" },
      { type: "SET_SORT", sort: "price" },
      { type: "SET_TRAIN_QUERY", query: "2155" },
      { type: "SET_DEPART_AFTER", time: "08:00" },
      { type: "SET_ARRIVE_BEFORE", time: "18:00" },
      { type: "SET_DURATION_CAP", minutes: 240 },
    ]);
    expect(state).toMatchObject({
      dateFilter: "2026-09-20",
      service: "acela",
      sort: "price",
      trainQuery: "2155",
      departAfter: "08:00",
      arriveBefore: "18:00",
      durationCap: 240,
    });
  });

  it("toggles the booleans both ways", () => {
    for (const type of [
      "TOGGLE_SAVINGS_ONLY",
      "TOGGLE_PINNED_ONLY",
      "TOGGLE_ARRIVE_BUFFER",
      "TOGGLE_HIDE_DEPARTED",
      "TOGGLE_ZEN",
    ] as const) {
      const on = boardReducer(initialBoardState, { type });
      const off = boardReducer(on, { type });
      expect(off).toEqual(initialBoardState);
    }
  });

  it("keeps SET_BUCKET and TOGGLE_BUCKET distinct, because both controls exist", () => {
    // The bucket price cards toggle; the "When" chips set. Collapsing them
    // would make clicking the active price card a no-op.
    const set = run([
      { type: "SET_BUCKET", bucket: "morning" },
      { type: "SET_BUCKET", bucket: "morning" },
    ]);
    expect(set.bucket).toBe("morning");

    const toggled = run([
      { type: "TOGGLE_BUCKET", bucket: "morning" },
      { type: "TOGGLE_BUCKET", bucket: "morning" },
    ]);
    expect(toggled.bucket).toBe("all");
  });

  it("switches buckets rather than clearing when a different one is toggled", () => {
    const state = run([
      { type: "TOGGLE_BUCKET", bucket: "morning" },
      { type: "TOGGLE_BUCKET", bucket: "evening" },
    ]);
    expect(state.bucket).toBe("evening");
  });

  it("toggles between all options and the top five", () => {
    expect(boardReducer(initialBoardState, { type: "TOGGLE_SHOW_ALL" }).showAll).toBe(true);
    expect(run([{ type: "TOGGLE_SHOW_ALL" }, { type: "TOGGLE_SHOW_ALL" }]).showAll).toBe(false);
  });
});

describe("boardReducer — focus", () => {
  const keys = ["a", "b", "c"];

  it("starts at the top when moving down from nothing focused", () => {
    expect(
      boardReducer(initialBoardState, { type: "MOVE_FOCUS", direction: "next", keys }).focusKey,
    ).toBe("a");
  });

  it("starts at the bottom when moving up from nothing focused", () => {
    expect(
      boardReducer(initialBoardState, { type: "MOVE_FOCUS", direction: "previous", keys }).focusKey,
    ).toBe("c");
  });

  it("clamps rather than wrapping at both ends", () => {
    // J on the last row stays put; it does not jump back to the top.
    const atEnd = run(
      [
        { type: "MOVE_FOCUS", direction: "next", keys },
        { type: "MOVE_FOCUS", direction: "next", keys },
        { type: "MOVE_FOCUS", direction: "next", keys },
        { type: "MOVE_FOCUS", direction: "next", keys },
      ],
      initialBoardState,
    );
    expect(atEnd.focusKey).toBe("c");

    const atStart = run([
      { type: "SET_FOCUS", key: "a" },
      { type: "MOVE_FOCUS", direction: "previous", keys },
      { type: "MOVE_FOCUS", direction: "previous", keys },
    ]);
    expect(atStart.focusKey).toBe("a");
  });

  it("falls back to the first key when the focused row has left the board", () => {
    // A filter can remove the focused row between renders.
    const state = { ...initialBoardState, focusKey: "gone" };
    expect(boardReducer(state, { type: "MOVE_FOCUS", direction: "next", keys }).focusKey).toBe("a");
  });

  it("clears focus", () => {
    expect(
      run([
        { type: "SET_FOCUS", key: "b" },
        { type: "SET_FOCUS", key: null },
      ]).focusKey,
    ).toBe(null);
  });
});

describe("boardReducer — pins", () => {
  it("toggles a pin on and off", () => {
    const on = boardReducer(initialBoardState, { type: "TOGGLE_PIN", key: "a" });
    expect(on.pins).toEqual(["a"]);
    expect(boardReducer(on, { type: "TOGGLE_PIN", key: "a" }).pins).toEqual([]);
  });

  it("keeps pins in the order they were added", () => {
    expect(
      run([
        { type: "TOGGLE_PIN", key: "b" },
        { type: "TOGGLE_PIN", key: "a" },
      ]).pins,
    ).toEqual(["b", "a"]);
  });

  it("replaces the whole set when rehydrating from storage", () => {
    const state = run([
      { type: "TOGGLE_PIN", key: "a" },
      { type: "LOAD_PINS", pins: ["x", "y"] },
    ]);
    expect(state.pins).toEqual(["x", "y"]);
  });
});

describe("boardReducer — hide and undo", () => {
  it("hides a row and moves focus to the row given", () => {
    const state = boardReducer(initialBoardState, { type: "HIDE", key: "a", nextFocus: "b" });
    expect(state.hiddenKeys).toEqual(["a"]);
    expect(state.focusKey).toBe("b");
  });

  it("undoes in reverse order and refocuses what came back", () => {
    const state = run([
      { type: "HIDE", key: "a", nextFocus: "b" },
      { type: "HIDE", key: "b", nextFocus: "c" },
    ]);
    const first = boardReducer(state, { type: "UNDO_HIDE" });
    expect(first.hiddenKeys).toEqual(["a"]);
    expect(first.focusKey).toBe("b");

    const second = boardReducer(first, { type: "UNDO_HIDE" });
    expect(second.hiddenKeys).toEqual([]);
    expect(second.focusKey).toBe("a");
  });

  it("brings the whole stack back at once, which undo does not", () => {
    const state = run([
      { type: "HIDE", key: "a", nextFocus: null },
      { type: "HIDE", key: "b", nextFocus: null },
    ]);
    expect(boardReducer(state, { type: "UNHIDE_ALL" }).hiddenKeys).toEqual([]);
    expect(boardReducer(initialBoardState, { type: "UNHIDE_ALL" })).toBe(initialBoardState);
  });

  it("does nothing when there is nothing to undo", () => {
    expect(boardReducer(initialBoardState, { type: "UNDO_HIDE" })).toBe(initialBoardState);
  });

  it("never hides the same row twice, so undo cannot get stuck", () => {
    const once = boardReducer(initialBoardState, { type: "HIDE", key: "a", nextFocus: null });
    expect(boardReducer(once, { type: "HIDE", key: "a", nextFocus: null }).hiddenKeys).toEqual([
      "a",
    ]);
  });
});

describe("boardReducer — compare selection", () => {
  it("holds at most two, dropping the oldest", () => {
    const state = run([
      { type: "TOGGLE_PICK", key: "a" },
      { type: "TOGGLE_PICK", key: "b" },
      { type: "TOGGLE_PICK", key: "c" },
    ]);
    expect(state.picked).toEqual(["b", "c"]);
  });

  it("deselects a row that is already picked", () => {
    const state = run([
      { type: "TOGGLE_PICK", key: "a" },
      { type: "TOGGLE_PICK", key: "b" },
      { type: "TOGGLE_PICK", key: "a" },
    ]);
    expect(state.picked).toEqual(["b"]);
  });
});

describe("boardReducer — the two reset paths", () => {
  const dirty = (): BoardState =>
    run([
      { type: "SET_DATE", date: "2026-09-20" },
      { type: "SET_SERVICE", service: "acela" },
      { type: "TOGGLE_BUCKET", bucket: "morning" },
      { type: "TOGGLE_SAVINGS_ONLY" },
      { type: "TOGGLE_PINNED_ONLY" },
      { type: "SET_SORT", sort: "price" },
      { type: "SET_TRAIN_QUERY", query: "2155" },
      { type: "SET_DEPART_AFTER", time: "08:00" },
      { type: "SET_ARRIVE_BEFORE", time: "18:00" },
      { type: "SET_DURATION_CAP", minutes: 240 },
      { type: "TOGGLE_ARRIVE_BUFFER" },
      { type: "TOGGLE_HIDE_DEPARTED" },
      { type: "HIDE", key: "h", nextFocus: "f" },
      { type: "TOGGLE_PICK", key: "p" },
      { type: "TOGGLE_PIN", key: "keep" },
      { type: "TOGGLE_ZEN" },
      { type: "TOGGLE_SHOW_ALL" },
    ]);

  it("clears every filter", () => {
    const state = boardReducer(dirty(), { type: "CLEAR_FILTERS" });
    expect(filtersActive(state)).toBe(false);
    expect(state.focusKey).toBe(null);
  });

  it("keeps pins, zen and showAll through both resets — they are not filters", () => {
    for (const type of ["CLEAR_FILTERS", "RESET_VIEW"] as const) {
      const state = boardReducer(dirty(), { type });
      expect(state.pins).toEqual(["keep"]);
      expect(state.zen).toBe(true);
      expect(state.showAll).toBe(true);
    }
  });

  it("differs on the compare selection, which is the known inconsistency", () => {
    // The "Clear filters" button leaves a comparison in place; Escape drops it.
    // Preserved from the pre-refactor behaviour rather than silently unified —
    // picking one is a product decision, recorded in docs/AUDIT.md.
    expect(boardReducer(dirty(), { type: "CLEAR_FILTERS" }).picked).toEqual(["p"]);
    expect(boardReducer(dirty(), { type: "RESET_VIEW" }).picked).toEqual([]);
  });
});

describe("filtersActive", () => {
  it("is false for a fresh board", () => {
    expect(filtersActive(initialBoardState)).toBe(false);
  });

  it("counts a non-default sort", () => {
    expect(filtersActive({ ...initialBoardState, sort: "price" })).toBe(true);
  });

  it("counts the arrive buffer, which is easy to forget", () => {
    expect(filtersActive({ ...initialBoardState, arriveBuffer: true })).toBe(true);
  });

  it("ignores whitespace typed into the train search", () => {
    expect(filtersActive({ ...initialBoardState, trainQuery: "   " })).toBe(false);
  });

  it("does not count pins, zen, showAll or focus", () => {
    expect(
      filtersActive({
        ...initialBoardState,
        pins: ["a"],
        zen: true,
        showAll: true,
        focusKey: "a",
        picked: ["a"],
      }),
    ).toBe(false);
  });

  it("counts every remaining filter on its own", () => {
    const cases: Array<Partial<BoardState>> = [
      { dateFilter: "2026-09-20" },
      { service: "acela" },
      { bucket: "morning" },
      { savingsOnly: true },
      { pinnedOnly: true },
      { trainQuery: "95" },
      { departAfter: "08:00" },
      { arriveBefore: "18:00" },
      { durationCap: 240 },
      { hideDeparted: true },
      { hiddenKeys: ["a"] },
    ];
    for (const patch of cases) {
      expect(filtersActive({ ...initialBoardState, ...patch }), JSON.stringify(patch)).toBe(true);
    }
  });
});

describe("clockFiltersActive", () => {
  it("is true only for time and duration constraints", () => {
    expect(clockFiltersActive(initialBoardState)).toBe(false);
    expect(clockFiltersActive({ ...initialBoardState, departAfter: "08:00" })).toBe(true);
    expect(clockFiltersActive({ ...initialBoardState, arriveBefore: "18:00" })).toBe(true);
    expect(clockFiltersActive({ ...initialBoardState, durationCap: 240 })).toBe(true);
    expect(clockFiltersActive({ ...initialBoardState, savingsOnly: true })).toBe(false);
  });
});

describe("focus intent", () => {
  it("does not claim intent for a row the board picked on load", () => {
    const next = boardReducer(initialBoardState, { type: "AUTO_FOCUS", key: "j1:f1" });
    expect(next.focusKey).toBe("j1:f1");
    expect(next.focusIntent).toBe(false);
  });

  it("claims intent when a row is focused directly", () => {
    const next = boardReducer(initialBoardState, { type: "SET_FOCUS", key: "j1:f1" });
    expect(next.focusIntent).toBe(true);
  });

  it("claims intent when J or K moves focus", () => {
    const auto = boardReducer(initialBoardState, { type: "AUTO_FOCUS", key: "j1:f1" });
    const moved = boardReducer(auto, {
      type: "MOVE_FOCUS",
      direction: "next",
      keys: ["j1:f1", "j2:f2"],
    });
    expect(moved.focusKey).toBe("j2:f2");
    expect(moved.focusIntent).toBe(true);
  });

  it("drops intent along with focus when the view is reset", () => {
    const moved = boardReducer(initialBoardState, { type: "SET_FOCUS", key: "j1:f1" });
    expect(boardReducer(moved, { type: "RESET_VIEW" }).focusIntent).toBe(false);
    expect(boardReducer(moved, { type: "CLEAR_FILTERS" }).focusIntent).toBe(false);
  });

  it("claims intent when undo brings a row back", () => {
    const hidden = boardReducer(
      { ...initialBoardState, hiddenKeys: ["j1:f1"] },
      { type: "UNDO_HIDE" },
    );
    expect(hidden.focusKey).toBe("j1:f1");
    expect(hidden.focusIntent).toBe(true);
  });

  it("does not claim intent when clearing focus", () => {
    const moved = boardReducer(initialBoardState, { type: "SET_FOCUS", key: "j1:f1" });
    expect(boardReducer(moved, { type: "SET_FOCUS", key: null }).focusIntent).toBe(false);
  });
});

describe("HYDRATE", () => {
  it("adopts a whole state from a link", () => {
    const linked: BoardState = {
      ...initialBoardState,
      dateFilter: "2026-10-04",
      sort: "price",
      zen: true,
      pins: ["j1:f1"],
    };
    expect(boardReducer(initialBoardState, { type: "HYDRATE", state: linked })).toEqual(linked);
  });

  it("replaces rather than merges, so an absent field reads as its default", () => {
    const dirty: BoardState = { ...initialBoardState, service: "acela", savingsOnly: true };
    const linked: BoardState = { ...initialBoardState, sort: "price" };
    const next = boardReducer(dirty, { type: "HYDRATE", state: linked });
    expect(next.service).toBe("all");
    expect(next.savingsOnly).toBe(false);
    expect(next.sort).toBe("price");
  });

  it("keeps the board's own focus when the link names no row", () => {
    // The board focuses your train on mount; a link carrying only filters must
    // not leave the keyboard with nowhere to start.
    const focused: BoardState = { ...initialBoardState, focusKey: "yours:f1" };
    const linked: BoardState = { ...initialBoardState, sort: "price" };
    const next = boardReducer(focused, { type: "HYDRATE", state: linked });
    expect(next.focusKey).toBe("yours:f1");
    // Still the board's choice, so it does not go back into the URL.
    expect(next.focusIntent).toBe(false);
  });

  it("prefers the link's focus when it has one", () => {
    const focused: BoardState = { ...initialBoardState, focusKey: "yours:f1" };
    const linked: BoardState = {
      ...initialBoardState,
      focusKey: "shared:f2",
      focusIntent: true,
    };
    const next = boardReducer(focused, { type: "HYDRATE", state: linked });
    expect(next.focusKey).toBe("shared:f2");
    expect(next.focusIntent).toBe(true);
  });
});
