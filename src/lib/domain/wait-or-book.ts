/* "Should I switch now, or wait?"
 *
 * The one question the board exists to answer and the one it never answered. It
 * showed a traveler sixty fares and a savings figure and left the timing to
 * them, which is the hard part: Amtrak's cheapest buckets sell out, flexible
 * fares drift, and the cost of waiting is not symmetric with the cost of acting
 * early.
 *
 * Three rules govern everything below, and they are the reason this file is
 * long comments and short arithmetic.
 *
 * It never states a future price. Not a range, not a likelihood, not "fares
 * usually rise closer to departure". The product's promise is that it never
 * invents a fare, and a predicted one is still invented. Every sentence here is
 * about what has already been observed or what is arithmetically true now.
 *
 * It says how sure it is, and it is usually not very. A recommendation from two
 * observations of one corridor is a guess; saying so is the difference between
 * advice and a horoscope. Confidence comes from how much was actually seen.
 *
 * It is a recommendation, not an instruction, and the traveler's own money is
 * the tiebreak. Where the evidence is thin the advice defaults to the reversible
 * action — watching costs nothing, a change fee does not come back.
 */

import type { FareHistory } from "./fare-history";
import { recentDirection, volatility } from "./fare-history";
import { corridorEvidence, fareStanding, type CorridorStats } from "./corridor-stats";

export type Call = "BOOK_NOW" | "HOLD" | "WATCH_CLOSELY";
export type Confidence = "low" | "moderate" | "high";

export interface WaitOrBook {
  call: Call;
  /** Four or five words for the badge. */
  label: string;
  /** One or two sentences a person can act on, in plain English. */
  reason: string;
  confidence: Confidence;
  /** Why the confidence is what it is. Shown, not hidden in a tooltip. */
  basis: string;
}

export interface WaitOrBookInput {
  /** Cheapest listed now, in cents. Null when nothing qualifies. */
  bestCents: number | null;
  /** What the traveler paid. */
  bookedCents: number;
  /** Their entered change fee. 0 means "not entered", not "free". */
  changeFeeCents: number;
  /** Null when the departure is unknown. */
  hoursToDeparture: number | null;
  history: FareHistory;
  /**
   * What this route has cost across every watch, or null if we have too little.
   *
   * A different kind of evidence from `history`, and weaker for this purpose:
   * the corridor describes the route over weeks, the history describes this
   * departure over hours. It can lift a first-look recommendation out of "we
   * have looked once" — it can never make one confident, because knowing what
   * a route usually costs is not knowing what tomorrow morning's train will do.
   */
  corridor?: CorridorStats | null;
}

/** Inside this, inventory decisions are being made without you. */
const IMMINENT_HOURS = 24;
/** Far enough out that a few more checks cost nothing. */
const DISTANT_HOURS = 72;
/** Above this relative swing the corridor is genuinely unsettled. */
const VOLATILE = 0.25;
/** Below this, a saving is not worth the friction of changing a ticket. */
const MARGINAL_CENTS = 500;

export function waitOrBook(input: WaitOrBookInput): WaitOrBook {
  const { bestCents, bookedCents, changeFeeCents, hoursToDeparture, history, corridor } = input;

  /* Nothing to decide. Said plainly rather than dressed as a recommendation —
   * "HOLD" here would imply we are holding out for something we have seen. */
  if (bestCents === null || bestCents >= bookedCents) {
    /* A dead end, unless the corridor has something to say about it.
     *
     * "Keep the ticket you have" was the whole answer, and it is the least
     * useful true sentence in the product. If this route routinely goes for
     * half what they paid, that is worth knowing even on a day when nothing
     * cheaper is listed — it is the difference between "nothing today" and
     * "you are above this route's normal price and we are watching". */
    const standing = corridor ? fareStanding(bookedCents, corridor) : null;
    if (standing && (standing.standing === "well-above" || standing.standing === "above")) {
      return {
        call: "HOLD",
        label: "Nothing today, but keep watching",
        reason: `No listed fare is below what you paid right now. ${standing.verdict}`,
        confidence: corridorEvidence(corridor) === "good" ? "moderate" : "low",
        basis: standing.basis,
      };
    }
    return {
      call: "HOLD",
      label: "Nothing to switch to",
      reason:
        "No listed fare is below what you paid. Keep the ticket you have; we will keep looking." +
        (standing ? ` ${standing.verdict}` : ""),
      confidence: "high",
      basis: standing
        ? standing.basis
        : "This is what the board is showing right now, not a forecast.",
    };
  }

  const gross = bookedCents - bestCents;
  const net = gross - changeFeeCents;
  const evidence = confidenceFrom(history, corridor);

  /* The fee eats it. Arithmetic, not judgement, so it outranks everything else
   * — there is no timing at which changing for a loss becomes right. */
  if (changeFeeCents > 0 && net <= 0) {
    return {
      call: "HOLD",
      label: "The fee eats the saving",
      reason: `The cheapest listed fare is ${usd(gross)} below what you paid, and the change fee you entered is ${usd(changeFeeCents)}. Switching would cost you ${usd(Math.abs(net))}.`,
      confidence: "high",
      basis: "Arithmetic on your own numbers, not an estimate.",
    };
  }

  if (net > 0 && net < MARGINAL_CENTS) {
    return {
      call: "HOLD",
      label: "Barely worth it",
      reason: `Switching nets you ${usd(net)} after the fee you entered. That is real, but it is small enough that the errand may not be worth it — we will tell you if it gets better.`,
      confidence: evidence.confidence,
      basis: evidence.basis,
    };
  }

  /* Close to departure, the asymmetry decides it. Waiting can only be right if
   * something cheaper appears, and there are fewer checks left in which it
   * could. Note what this does not say: not that prices rise near departure —
   * we have not measured that and would not assert it. */
  if (hoursToDeparture !== null && hoursToDeparture <= IMMINENT_HOURS) {
    return {
      call: "BOOK_NOW",
      label: "Book it",
      reason: `You travel in under a day and ${usd(net)} is on the table after the fee you entered. There is little time left for a better fare to appear, and the cheap buckets are the ones that go first. Confirm on Amtrak.`,
      confidence: evidence.points >= 2 ? "high" : "moderate",
      basis:
        evidence.points >= 2
          ? `Based on ${evidence.points} checks of this corridor, and on how close you are to departure.`
          : "Based mostly on how close you are to departure; we have not watched this corridor for long.",
    };
  }

  const swing = volatility(history);
  const { direction, moves } = recentDirection(history);

  /* Falling, with room to keep falling. The only branch that advises waiting on
   * the strength of a trend, and it is hedged hard: a trend is not a promise,
   * and the fare it is trending toward may sell out instead of arriving. */
  if (
    direction === "down" &&
    moves.length >= 2 &&
    hoursToDeparture !== null &&
    hoursToDeparture > DISTANT_HOURS
  ) {
    return {
      call: "WATCH_CLOSELY",
      label: "Falling — give it a day",
      reason: `The last ${moves.length} changes we saw were all downward, and you are ${Math.round(hoursToDeparture / 24)} days out. ${usd(net)} is already available if you want it; waiting is a bet that this continues, and it may not. We will email you if it drops again.`,
      confidence: evidence.confidence === "high" ? "moderate" : "low",
      basis: `${evidence.basis} A direction is not a prediction — we are describing what happened, not what will.`,
    };
  }

  if (direction === "up" && moves.length >= 2) {
    return {
      call: "BOOK_NOW",
      label: "Take it",
      reason: `The last ${moves.length} changes we saw were upward, and ${usd(net)} is still on the table after the fee you entered. Confirm on Amtrak before it moves again.`,
      confidence: evidence.confidence,
      basis: `${evidence.basis} We are describing what happened, not predicting the next move.`,
    };
  }

  if (swing >= VOLATILE && history.points.length >= 4) {
    return {
      call: "WATCH_CLOSELY",
      label: "Unsettled — watch it",
      reason: `This corridor has been moving a lot: we have seen it between ${usd(history.lowest!.cents)} and ${usd(history.highest!.cents)}. ${usd(net)} is available now. If you can hold, we check three times a day and will write the moment it drops.`,
      confidence: evidence.confidence,
      basis: evidence.basis,
    };
  }

  /* A good, quiet saving. The default, and deliberately the one that recommends
   * acting: the traveler came here because they wanted a cheaper ticket, and
   * they have one. */
  return {
    call: "BOOK_NOW",
    label: "Worth switching",
    reason: `${usd(net)} after the fee you entered, and this corridor has been steady in what we have seen. Confirm the fare and the change rules on Amtrak before you switch.`,
    confidence: evidence.confidence,
    basis: evidence.basis,
  };
}

/**
 * How much the product has actually seen, turned into a confidence.
 *
 * Deliberately conservative. Six observations over two days is "moderate", not
 * "high" — it is six looks at one corridor, and calling that high confidence
 * would be borrowing authority the data does not carry.
 */
function confidenceFrom(
  history: FareHistory,
  corridor?: CorridorStats | null,
): {
  confidence: Confidence;
  basis: string;
  points: number;
} {
  const points = history.points.length;
  const hours = Math.round(history.spanHours);
  if (points <= 1) {
    /* The cold start, which used to be the weakest moment in the product: a
     * brand-new watch said "this is the first look" and shrugged, while the
     * product had been scraping this exact route for somebody else all week.
     *
     * The corridor cannot make a first look confident — it describes the route,
     * not this departure — so it lifts low to moderate and no further, and the
     * basis says exactly which kind of evidence it is. */
    const strength = corridorEvidence(corridor);
    if (strength !== "none" && corridor) {
      return {
        confidence: strength === "good" ? "moderate" : "low",
        basis: `This is our first look at your trip, but we have ${corridor.count} checks of this route over ${corridor.spanDays} days: it has run ${usd(corridor.low)} to ${usd(corridor.high)}, typically around ${usd(corridor.median)}. That describes the route, not your particular train.`,
        points,
      };
    }
    return {
      confidence: "low",
      basis:
        points === 0
          ? "We have no price history for this trip yet — this is the first look."
          : "We have looked once. One observation is not a pattern.",
      points,
    };
  }
  if (points < 4 || hours < 12) {
    return {
      confidence: "low",
      basis: `Based on ${points} checks over ${hours < 1 ? "under an hour" : `${hours}h`}. That is not much to go on.`,
      points,
    };
  }
  if (points < 10 || hours < 48) {
    return {
      confidence: "moderate",
      basis: `Based on ${points} checks over ${hours}h of watching this corridor.`,
      points,
    };
  }
  return {
    confidence: "high",
    basis: `Based on ${points} checks over ${Math.round(hours / 24)} days of watching this corridor.`,
    points,
  };
}

function usd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toFixed(2)}`;
}
