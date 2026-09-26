/* When to speak, and when to stay quiet.
 *
 * The old comparator was one-directional: it asked whether the newest
 * observation beat the previous observation, and if qualifying options
 * vanished it kept the old fingerprint. Trace what that does.
 *
 *   A traveler is told about $47 on a $128 booking.
 *   The $47 sells out.
 *   A $60 appears — still $68 below what they paid.
 *   The comparator asks: is 60 at least 100 cents below 47? No.
 *   Verdict: unchanged. Silence.
 *
 * So the traveler sits on an email about a fare that no longer exists and is
 * never told about the one that does. That is the product's central promise
 * failing quietly, which is the worst way for it to fail.
 *
 * The root cause is that one field was doing two jobs. What we last *observed*
 * and what we last *told someone* are different facts, and comparing against
 * the wrong one produces exactly the silence above. They are separate here,
 * and every comparison that decides whether to speak is made against what the
 * traveler was actually told.
 */

import type { OpportunityFingerprint } from "./types";

export type AlertReason =
  /** Nothing qualified before; something does now. */
  | "first_qualifying"
  /** Meaningfully cheaper than the fare we told them about. */
  | "better_price"
  /** The fare we told them about is gone. Said once. */
  | "opportunity_lost"
  /** Something qualifies again after we said it was gone. */
  | "new_opportunity"
  /** Still qualifies, materially worse than quoted, and departure is close. */
  | "worse_but_qualifying"
  /** Last call: a qualifying fare still exists and they never acted. */
  | "departure_imminent"
  /** Nothing qualifies and we already said so. */
  | "no_qualifying"
  /** Qualifies, but nothing worth another email. */
  | "unchanged";

export interface AlertState {
  /** The fingerprint of the fare the traveler was actually told about. */
  lastAlerted: OpportunityFingerprint | null;
  /** Whether we have already said the alerted fare disappeared. */
  lostNotified: boolean;
  /** Whether the final last-call has been sent. */
  imminentNotified: boolean;
}

export interface AlertDecisionDetail {
  notify: boolean;
  reason: AlertReason;
  /** What lastAlerted becomes after this decision is acted on. */
  nextAlerted: OpportunityFingerprint | null;
  nextLostNotified: boolean;
  nextImminentNotified: boolean;
  /** Plain sentence for the audit trail, readable months later. */
  explanation: string;
}

export const DEFAULT_IMPROVEMENT_CENTS = 100;

/** Inside this many hours of departure, a standing opportunity earns a last call. */
export const DEPARTURE_IMMINENT_HOURS = 24;

export function initialAlertState(): AlertState {
  return { lastAlerted: null, lostNotified: false, imminentNotified: false };
}

export function decideAlert(input: {
  state: AlertState;
  /** What this cycle actually found. Null when nothing qualifies. */
  observed: OpportunityFingerprint | null;
  /** Null when departure is unknown. */
  hoursToDeparture: number | null;
  /** Per-watch; how much cheaper is worth another email. */
  improvementCents?: number;
  imminentWindowHours?: number;
}): AlertDecisionDetail {
  const improvement = input.improvementCents ?? DEFAULT_IMPROVEMENT_CENTS;
  const imminentWindow = input.imminentWindowHours ?? DEPARTURE_IMMINENT_HOURS;
  const { state, observed } = input;
  const alerted = state.lastAlerted;

  const keep = {
    nextAlerted: alerted,
    nextLostNotified: state.lostNotified,
    nextImminentNotified: state.imminentNotified,
  };

  // ── Nothing qualifies now ────────────────────────────────────────────────
  if (!observed) {
    // We told them about a fare and it is gone. Say so, once. Silence here is
    // what left travelers holding a stale email.
    if (alerted && !state.lostNotified) {
      return {
        notify: true,
        reason: "opportunity_lost",
        nextAlerted: alerted,
        nextLostNotified: true,
        nextImminentNotified: state.imminentNotified,
        explanation: `The ${money(alerted.bestPriceCents)} option we told you about is no longer listed, and nothing else qualifies right now.`,
      };
    }
    return {
      ...keep,
      notify: false,
      reason: "no_qualifying",
      explanation: alerted
        ? "Nothing qualifies, and we have already said the previous option went."
        : "Nothing qualifies yet, and we have never told you otherwise.",
    };
  }

  // ── Something qualifies ──────────────────────────────────────────────────
  if (!alerted) {
    return {
      notify: true,
      reason: "first_qualifying",
      nextAlerted: observed,
      nextLostNotified: false,
      nextImminentNotified: false,
      explanation: `First qualifying option: ${money(observed.bestPriceCents)} on ${observed.bestTravelDate}.`,
    };
  }

  // We had told them it was gone, and now there is something again. This is a
  // new opportunity, not a first one — the wording to the traveler differs.
  if (state.lostNotified) {
    return {
      notify: true,
      reason: "new_opportunity",
      nextAlerted: observed,
      nextLostNotified: false,
      nextImminentNotified: state.imminentNotified,
      explanation: `A qualifying option is listed again: ${money(observed.bestPriceCents)} on ${observed.bestTravelDate}.`,
    };
  }

  // Compared against what they were TOLD, not against the last thing we saw.
  const delta = alerted.bestPriceCents - observed.bestPriceCents;

  if (delta >= improvement) {
    return {
      notify: true,
      reason: "better_price",
      nextAlerted: observed,
      nextLostNotified: false,
      nextImminentNotified: state.imminentNotified,
      explanation: `${money(observed.bestPriceCents)} is ${money(delta)} below the ${money(alerted.bestPriceCents)} we told you about.`,
    };
  }

  // Materially worse than quoted, and time is running out: worth saying so,
  // because the number they are holding is no longer the number available.
  const near = input.hoursToDeparture !== null && input.hoursToDeparture <= imminentWindow;
  if (near && -delta >= improvement) {
    return {
      notify: true,
      reason: "worse_but_qualifying",
      nextAlerted: observed,
      nextLostNotified: false,
      nextImminentNotified: state.imminentNotified,
      explanation: `The cheapest qualifying option is now ${money(observed.bestPriceCents)}, ${money(-delta)} above the ${money(alerted.bestPriceCents)} we told you about, and departure is close.`,
    };
  }

  // Last call: still worth acting on, still unacted on, nearly gone.
  if (near && !state.imminentNotified) {
    return {
      notify: true,
      reason: "departure_imminent",
      nextAlerted: observed,
      nextLostNotified: false,
      nextImminentNotified: true,
      explanation: `Last call: ${money(observed.bestPriceCents)} still qualifies and departure is within ${imminentWindow} hours.`,
    };
  }

  return {
    ...keep,
    notify: false,
    reason: "unchanged",
    explanation: `${money(observed.bestPriceCents)} is not ${money(improvement)} better than the ${money(alerted.bestPriceCents)} we told you about.`,
  };
}

function money(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = abs / 100;
  const text = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${text}`;
}
