/* Why the board is empty, which is six different facts.
 *
 * It said "No other trains for this filter." for all of them. That sentence is
 * true when you have filtered everything out and false the rest of the time,
 * and one of the times it is false now matters a great deal: a search we could
 * not read looks identical to a corridor with nothing cheaper, and those are
 * opposite claims. One says the market has nothing for you. The other says we
 * failed. Only one of them is ours to make.
 *
 * Each state gets a title, a body, and the one action that actually helps —
 * which is sometimes nothing, and says so rather than offering a button that
 * cannot change the outcome.
 *
 * Pure, because the interesting part is the decision and not the markup: the
 * ordering matters (a paused watch showing "we are still looking" would be a
 * lie) and ordering is exactly the kind of thing that rots silently.
 */

export type EmptyReason =
  | "scanning"
  | "unreadable"
  | "departed"
  | "completed"
  | "paused"
  | "filtered"
  | "no-inventory"
  | "none-cheaper";

export interface EmptyBoard {
  reason: EmptyReason;
  /** Short, in the board's voice. */
  title: string;
  body: string;
  /** The one thing worth doing. Null when nothing the reader can do helps. */
  action: "clear-filters" | "recheck" | "resume" | "new-watch" | null;
  /** Whether this is the product failing rather than the market being quiet. */
  ourFault: boolean;
}

export interface EmptyBoardInput {
  /** A check is in flight right now. */
  scanning: boolean;
  /** Dates we reached and could not parse. See fare-sanity. */
  unreadableDates: number;
  /** Dates the provider failed outright. */
  failedDates: number;
  totalDates: number;
  /** Rows before the filters ran. */
  rankedCount: number;
  /** Rows after. */
  visibleCount: number;
  filtersActive: boolean;
  watchStatus: "ACTIVE" | "PAUSED" | "COMPLETED";
  /** Days until travel; negative once it has gone. */
  daysUntilTravel: number;
  /** When the next scheduled check lands, already formatted. */
  nextCheckLabel: string | null;
}

export function emptyBoardState(input: EmptyBoardInput): EmptyBoard {
  /* Order is the design. Each branch assumes every branch above it is false,
   * and moving one changes what the board claims. */

  if (input.scanning) {
    return {
      reason: "scanning",
      title: "Looking now",
      body: "Reading the live board for each day in your window. This takes a few seconds per day.",
      action: null,
      ourFault: false,
    };
  }

  /* Before anything about inventory. We do not know what is listed, so we must
   * not imply anything about it. */
  if (input.unreadableDates > 0 && input.visibleCount === 0) {
    const all = input.unreadableDates >= input.totalDates;
    return {
      reason: "unreadable",
      title: all ? "We could not read this corridor" : "We could not read part of this window",
      body: all
        ? "The last check reached the fare listings but could not make sense of them, so we are not showing any of it. This is a problem at our end — not a sold-out corridor. Nothing has been lost; the next check will try again."
        : `${input.unreadableDates} of ${input.totalDates} days came back unreadable on the last check, and nothing that did come back is cheaper than your booking. The unreadable days are our problem, not a sold-out corridor.`,
      action: "recheck",
      ourFault: true,
    };
  }

  if (input.daysUntilTravel < 0) {
    return {
      reason: "departed",
      title: "That train has gone",
      body: "This trip's travel date has passed, so there is nothing left to watch. The price history is still here if you want it.",
      action: "new-watch",
      ourFault: false,
    };
  }

  if (input.watchStatus === "COMPLETED") {
    return {
      reason: "completed",
      title: "Finished watching",
      body: "This watch has run its course. Everything it found is still on record; it is simply not looking any more.",
      action: "new-watch",
      ourFault: false,
    };
  }

  if (input.watchStatus === "PAUSED") {
    return {
      reason: "paused",
      title: "Paused",
      body: "We are not checking this trip at the moment, so the board is whatever it was when you paused. Nothing is being missed on purpose.",
      action: "resume",
      ourFault: false,
    };
  }

  /* Filters before inventory: the reader hid these rows themselves, and telling
   * them the corridor is empty when they narrowed it to one train would be
   * both wrong and slightly insulting. */
  if (input.filtersActive && input.rankedCount > 0) {
    return {
      reason: "filtered",
      title: "Nothing matches these filters",
      body: `${input.rankedCount} ${input.rankedCount === 1 ? "train is" : "trains are"} listed for this window — none of them fit what you have narrowed it to.`,
      action: "clear-filters",
      ourFault: false,
    };
  }

  if (input.rankedCount === 0 && input.failedDates >= input.totalDates && input.totalDates > 0) {
    return {
      reason: "unreadable",
      title: "The last check did not get through",
      body: "Every day in your window failed on the last check, so there is nothing to show. This is a problem at our end. We will try again on the next scheduled check.",
      action: "recheck",
      ourFault: true,
    };
  }

  if (input.rankedCount === 0) {
    return {
      reason: "no-inventory",
      title: "Nothing listed yet",
      body: nextCheckSentence(
        "No trains are listed for this window on the live board right now. That is what the corridor is showing, not a problem at our end.",
        input.nextCheckLabel,
      ),
      action: null,
      ourFault: false,
    };
  }

  return {
    reason: "none-cheaper",
    title: "Nothing cheaper yet",
    body: nextCheckSentence(
      `${input.rankedCount} ${input.rankedCount === 1 ? "train is" : "trains are"} listed, and none of them beat what you paid. Keep the ticket you have.`,
      input.nextCheckLabel,
    ),
    action: null,
    ourFault: false,
  };
}

function nextCheckSentence(body: string, nextCheckLabel: string | null): string {
  return nextCheckLabel
    ? `${body} We look again at ${nextCheckLabel} and will write the moment that changes.`
    : `${body} We are still watching and will write the moment that changes.`;
}
