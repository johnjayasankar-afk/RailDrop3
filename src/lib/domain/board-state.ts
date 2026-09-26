/* Everything the board remembers about how you are looking at it.
 *
 * Eighteen `useState` calls used to hold this, and the same transition was
 * written twice in most cases — once for the keyboard shortcut and once for the
 * click handler — so pin, hide, undo and clear each had two implementations
 * free to drift apart. They had. `clearFilters()` and the Escape key still
 * disagree about whether clearing filters also clears the compare selection;
 * that disagreement is preserved below as two distinct actions rather than
 * quietly resolved, because Phase 1 is a refactor and choosing between them is
 * a product decision.
 *
 * Pure: no clock, no storage, no DOM. Persisting pins and scrolling the focused
 * row are effects of dispatching, and belong to the component.
 */

import type { BoardSort, ServiceFilter, TimeBucket } from "./board-tools";

export interface BoardState {
  /** Lift the five-row cap on the board. */
  showAll: boolean;
  /** An ISO date, or "all". */
  dateFilter: string;
  service: ServiceFilter;
  bucket: TimeBucket | "all";
  savingsOnly: boolean;
  pinnedOnly: boolean;
  sort: BoardSort;
  /** Free-text train-number search. */
  trainQuery: string;
  /** "" or HH:MM. */
  departAfter: string;
  /** "" or HH:MM. */
  arriveBefore: string;
  /** Minutes, or null for no cap. */
  durationCap: number | null;
  /** Adds 30 minutes of slack to `arriveBefore`. */
  arriveBuffer: boolean;
  hideDeparted: boolean;
  zen: boolean;
  /** Persisted per watch by the component. */
  pins: string[];
  /** Doubles as the undo stack: the last entry is the next to come back. */
  hiddenKeys: string[];
  /** At most two, for the compare panel. */
  picked: string[];
  focusKey: string | null;
  /**
   * Whether a person chose the focused row, or the board did.
   *
   * The board focuses your train — or the cheapest option — as soon as it
   * loads, so `focusKey` is almost never null and cannot be used to decide
   * whether focus is worth putting in a shareable URL. Without this, every
   * first visit to every board rewrote its own address bar with a row nobody
   * had picked, and "Copy link" always claimed to be copying a view.
   */
  focusIntent: boolean;
}

export const initialBoardState: BoardState = {
  showAll: false,
  dateFilter: "all",
  service: "all",
  bucket: "all",
  savingsOnly: false,
  pinnedOnly: false,
  sort: "rank",
  trainQuery: "",
  departAfter: "",
  arriveBefore: "",
  durationCap: null,
  arriveBuffer: false,
  hideDeparted: false,
  zen: false,
  pins: [],
  hiddenKeys: [],
  picked: [],
  focusKey: null,
  focusIntent: false,
};

export type BoardAction =
  | { type: "SET_DATE"; date: string }
  | { type: "SET_SERVICE"; service: ServiceFilter }
  | { type: "SET_BUCKET"; bucket: TimeBucket | "all" }
  | { type: "TOGGLE_BUCKET"; bucket: TimeBucket }
  | { type: "TOGGLE_SAVINGS_ONLY" }
  | { type: "TOGGLE_PINNED_ONLY" }
  | { type: "SET_SORT"; sort: BoardSort }
  | { type: "SET_TRAIN_QUERY"; query: string }
  | { type: "SET_DEPART_AFTER"; time: string }
  | { type: "SET_ARRIVE_BEFORE"; time: string }
  | { type: "SET_DURATION_CAP"; minutes: number | null }
  | { type: "TOGGLE_ARRIVE_BUFFER" }
  | { type: "TOGGLE_HIDE_DEPARTED" }
  /** The button flips between "Show all options" and "Show top 5". */
  | { type: "TOGGLE_SHOW_ALL" }
  | { type: "TOGGLE_ZEN" }
  | { type: "SET_FOCUS"; key: string | null }
  /** The board choosing a starting row on load. Not a choice anyone made. */
  | { type: "AUTO_FOCUS"; key: string }
  /** J and K. `keys` is the board's current navigable order. */
  | { type: "MOVE_FOCUS"; direction: "next" | "previous"; keys: readonly string[] }
  | { type: "TOGGLE_PIN"; key: string }
  /** Rehydrating from storage, which is not a user action. */
  | { type: "LOAD_PINS"; pins: string[] }
  /**
   * Adopting a whole state from a shared link, once, on mount.
   *
   * Separate from LOAD_PINS because a link carries the entire view and not one
   * field of it, and separate from the individual setters because replaying
   * fourteen actions to restore one URL would fire fourteen renders and
   * fourteen history writes.
   */
  | { type: "HYDRATE"; state: BoardState }
  | { type: "HIDE"; key: string; nextFocus: string | null }
  | { type: "UNDO_HIDE" }
  /** "Show N hidden" brings the whole stack back at once, unlike undo. */
  | { type: "UNHIDE_ALL" }
  | { type: "TOGGLE_PICK"; key: string }
  /** The "Clear filters" button. Leaves the compare selection alone. */
  | { type: "CLEAR_FILTERS" }
  /** Escape. Clears the compare selection and focus as well. */
  | { type: "RESET_VIEW" };

/** The fields both reset paths clear. */
const CLEARED_FILTERS = {
  dateFilter: "all",
  service: "all",
  bucket: "all",
  savingsOnly: false,
  pinnedOnly: false,
  sort: "rank",
  trainQuery: "",
  departAfter: "",
  arriveBefore: "",
  durationCap: null,
  arriveBuffer: false,
  hiddenKeys: [],
  hideDeparted: false,
  focusKey: null,
  focusIntent: false,
} as const satisfies Partial<BoardState>;

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "SET_DATE":
      return { ...state, dateFilter: action.date };

    case "SET_SERVICE":
      return { ...state, service: action.service };

    case "SET_BUCKET":
      return { ...state, bucket: action.bucket };

    case "TOGGLE_BUCKET":
      // The bucket price cards toggle; the "When" chips set. Both exist.
      return { ...state, bucket: state.bucket === action.bucket ? "all" : action.bucket };

    case "TOGGLE_SAVINGS_ONLY":
      return { ...state, savingsOnly: !state.savingsOnly };

    case "TOGGLE_PINNED_ONLY":
      return { ...state, pinnedOnly: !state.pinnedOnly };

    case "SET_SORT":
      return { ...state, sort: action.sort };

    case "SET_TRAIN_QUERY":
      return { ...state, trainQuery: action.query };

    case "SET_DEPART_AFTER":
      return { ...state, departAfter: action.time };

    case "SET_ARRIVE_BEFORE":
      return { ...state, arriveBefore: action.time };

    case "SET_DURATION_CAP":
      return { ...state, durationCap: action.minutes };

    case "TOGGLE_ARRIVE_BUFFER":
      return { ...state, arriveBuffer: !state.arriveBuffer };

    case "TOGGLE_HIDE_DEPARTED":
      return { ...state, hideDeparted: !state.hideDeparted };

    case "TOGGLE_SHOW_ALL":
      return { ...state, showAll: !state.showAll };

    case "TOGGLE_ZEN":
      return { ...state, zen: !state.zen };

    case "SET_FOCUS":
      return { ...state, focusKey: action.key, focusIntent: action.key !== null };

    case "AUTO_FOCUS":
      // Deliberately leaves focusIntent alone: a row the board picked is not
      // part of the view anyone would share.
      return { ...state, focusKey: action.key };

    case "MOVE_FOCUS": {
      if (action.keys.length === 0) return state;
      return {
        ...state,
        focusKey: focusAfterMove(action.keys, state.focusKey, action.direction),
        focusIntent: true,
      };
    }

    case "TOGGLE_PIN":
      return {
        ...state,
        pins: state.pins.includes(action.key)
          ? state.pins.filter((key) => key !== action.key)
          : [...state.pins, action.key],
      };

    case "LOAD_PINS":
      return { ...state, pins: action.pins };

    case "HYDRATE":
      return {
        ...action.state,
        // A link that names no row does not un-focus the board. The board picks
        // a sensible first focus on mount (your train, else the cheapest), and
        // a URL carrying filters but no `x` should keep it rather than leave
        // the keyboard with nowhere to start — but it stays the board's choice,
        // so it does not go back into the URL.
        focusKey: action.state.focusKey ?? state.focusKey,
        focusIntent: action.state.focusKey !== null,
      };

    case "HIDE":
      if (state.hiddenKeys.includes(action.key)) return state;
      return {
        ...state,
        hiddenKeys: [...state.hiddenKeys, action.key],
        focusKey: action.nextFocus,
      };

    case "UNDO_HIDE": {
      const last = state.hiddenKeys[state.hiddenKeys.length - 1];
      if (!last) return state;
      // Focus follows the row back onto the board, and they asked for it.
      return {
        ...state,
        hiddenKeys: state.hiddenKeys.slice(0, -1),
        focusKey: last,
        focusIntent: true,
      };
    }

    case "UNHIDE_ALL":
      if (state.hiddenKeys.length === 0) return state;
      // Focus is left alone: nothing was focused by hiding, so nothing is owed
      // it back. Undo differs, because it restores one specific row.
      return { ...state, hiddenKeys: [] };

    case "TOGGLE_PICK":
      return {
        ...state,
        picked: state.picked.includes(action.key)
          ? state.picked.filter((key) => key !== action.key)
          : // Hard cap of two: the compare panel is a pair.
            [...state.picked, action.key].slice(-2),
      };

    case "CLEAR_FILTERS":
      // Note: leaves `picked`. RESET_VIEW does not. Preserved, not endorsed.
      return { ...state, ...CLEARED_FILTERS };

    case "RESET_VIEW":
      return { ...state, ...CLEARED_FILTERS, picked: [] };
  }
}

/**
 * Where J or K lands focus.
 *
 * Exported because the component also has to scroll that row into view, and a
 * second copy of this arithmetic would eventually scroll to a different row
 * than the one it highlighted.
 *
 * Clamps rather than wrapping. From nothing focused, "next" starts at the top
 * and "previous" at the bottom.
 */
export function focusAfterMove(
  keys: readonly string[],
  focusKey: string | null,
  direction: "next" | "previous",
): string | null {
  if (keys.length === 0) return null;
  const current = focusKey ? keys.indexOf(focusKey) : -1;
  if (direction === "next") {
    return keys[Math.min(keys.length - 1, current + 1)] ?? keys[0] ?? null;
  }
  const from = focusKey && current >= 0 ? current : keys.length;
  return keys[Math.max(0, from - 1)] ?? keys[0] ?? null;
}

/** Whether any filter is off its default — drives "Clear filters" and the census line. */
export function filtersActive(state: BoardState): boolean {
  return (
    state.dateFilter !== "all" ||
    state.service !== "all" ||
    state.bucket !== "all" ||
    state.savingsOnly ||
    state.pinnedOnly ||
    // A non-default sort counts: "Clear filters" restores rank order too.
    state.sort !== "rank" ||
    state.trainQuery.trim() !== "" ||
    state.departAfter !== "" ||
    state.arriveBefore !== "" ||
    state.durationCap !== null ||
    state.arriveBuffer ||
    state.hiddenKeys.length > 0 ||
    state.hideDeparted
  );
}

/** Whether a time or duration constraint is in play. */
export function clockFiltersActive(state: BoardState): boolean {
  return state.departAfter !== "" || state.arriveBefore !== "" || state.durationCap !== null;
}
