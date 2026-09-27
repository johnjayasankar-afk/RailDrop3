/**
 * AlertComparator — decides whether this cycle's result deserves an email.
 *
 * Alerts must be meaningful, not noisy. Every "no" carries a reason.
 */

import type { Cents } from './money';
import type { AlertDecision, AlertState, CycleStatus, Opportunity } from './types';

export interface AlertThresholds {
  /** A drop must beat this to re-alert. Default $5.00. */
  materialDropCents: Cents;
  /** A drop this large bypasses the cooldown. Default $30.00. */
  urgentDropCents: Cents;
  /** Minutes between alerts for the same watch. Default 60. */
  cooldownMinutes: number;
  /** Convenience score improvement required to justify a same-price alert. */
  convenienceDelta: number;
  /** Absolute price increase tolerated for a convenience alert. Default $2.00. */
  priceToleranceCents: Cents;
  /** Relative price increase tolerated for a convenience alert. Default 3%. */
  priceTolerancePct: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  materialDropCents: 500,
  urgentDropCents: 3000,
  cooldownMinutes: 60,
  convenienceDelta: 15,
  priceToleranceCents: 200,
  priceTolerancePct: 0.03,
};

export interface AlertComparatorInput {
  /** Qualifying opportunities, already ranked (index 0 is best). */
  opportunities: Opportunity[];
  state: AlertState;
  cycleStatus: CycleStatus;
  now: Date;
  thresholds?: Partial<AlertThresholds>;
  /** True when the user rebooked while this cycle was in flight. */
  benchmarkChanged?: boolean;
  /**
   * Bumped on every rebook. It MUST be part of the dedupe key: the key is
   * unique for the life of the watch, and a rebook resets the alert state to
   * exactly the state that re-enters the FIRST_DROP branch. Without it, the
   * post-rebook alert collides with the pre-rebook one, the insert is rejected,
   * the state is never advanced, and the user is never told about a genuine
   * drop again - silently, forever.
   */
  benchmarkVersion?: number;
  /**
   * Optional per-trip target. When the best total reaches it, that is an alert
   * in its own right — the user asked to be told at this number, not merely
   * when something got materially cheaper than the last thing we mentioned.
   */
  targetPriceCents?: Cents | null;
}

function suppress(
  reason: NonNullable<AlertDecision['suppressedReason']>,
  best: Opportunity | null,
): AlertDecision {
  return { shouldAlert: false, reason: null, suppressedReason: reason, dedupeKey: null, best };
}

export function dedupeKeyFor(reason: string, best: Opportunity, benchmarkVersion = 1): string {
  return `${reason}:v${benchmarkVersion}:${best.signature}:${best.totalCents}`;
}

/** Price increase we will tolerate when the alternative is materially more convenient. */
export function convenienceToleranceCents(lastBest: Cents, t: AlertThresholds): Cents {
  return Math.min(t.priceToleranceCents, Math.floor(lastBest * t.priceTolerancePct));
}

export function decideAlert(input: AlertComparatorInput): AlertDecision {
  const t = { ...DEFAULT_ALERT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const { opportunities, state, cycleStatus, now } = input;
  const version = input.benchmarkVersion ?? 1;

  // A failed cycle knows nothing. It must never be reported as "no drop" either.
  if (
    cycleStatus === 'FAILED' ||
    cycleStatus === 'SKIPPED_BUDGET' ||
    cycleStatus === 'SKIPPED_EXPIRED'
  ) {
    return suppress('CYCLE_FAILED', null);
  }
  if (input.benchmarkChanged) return suppress('BENCHMARK_CHANGED', null);

  const best = opportunities[0] ?? null;
  if (!best) return suppress('NO_QUALIFYING_OPPORTUNITY', null);

  // Never assert savings we cannot arithmetically trust (party pricing unresolved).
  if (best.pricingAmbiguous) return suppress('AMBIGUOUS_PARTY_PRICING', best);

  const lastBest = state.lastBestTotalCents;

  // 0. Target reached.
  //
  //    Checked before the drop rules because it answers a different question.
  //    A watch that has been quietly sitting at "no material change" for days
  //    must still speak the moment it crosses the number the user named.
  //
  //    It fires on the *crossing*, not on every check below the line: once the
  //    last alert was already at or under the target, the ordinary drop rules
  //    take over again, so a fare oscillating a dollar under the target cannot
  //    generate an alert per check.
  const target = input.targetPriceCents ?? null;
  if (target !== null && best.totalCents <= target && (lastBest === null || lastBest > target)) {
    return {
      shouldAlert: true,
      reason: 'TARGET_REACHED',
      suppressedReason: null,
      dedupeKey: dedupeKeyFor('TARGET_REACHED', best, version),
      best,
    };
  }

  // 1. First qualifying opportunity for this watch.
  if (lastBest === null || state.lastBestSignature === null) {
    return {
      shouldAlert: true,
      reason: 'FIRST_DROP',
      suppressedReason: null,
      dedupeKey: dedupeKeyFor('FIRST_DROP', best, version),
      best,
    };
  }

  const drop = lastBest - best.totalCents;
  const withinCooldown = isWithinCooldown(state.lastAlertedAt, now, t.cooldownMinutes);

  // 2. Materially cheaper than the last thing we told them about.
  if (drop >= t.materialDropCents) {
    if (withinCooldown && drop < t.urgentDropCents) return suppress('COOLDOWN', best);
    return {
      shouldAlert: true,
      reason: 'PRICE_DROP',
      suppressedReason: null,
      dedupeKey: dedupeKeyFor('PRICE_DROP', best, version),
      best,
    };
  }

  // 3. Similar price, materially better trip.
  //    e.g. we alerted $89 one day early; now $90 exists on the exact desired day.
  const lastConvenience = state.lastBestConvenienceScore ?? Number.NEGATIVE_INFINITY;
  const convenienceGain = best.convenienceScore - lastConvenience;
  const priceIncrease = best.totalCents - lastBest;
  const tolerated = convenienceToleranceCents(lastBest, t);

  if (convenienceGain >= t.convenienceDelta && priceIncrease <= tolerated) {
    if (best.signature === state.lastBestSignature) return suppress('NO_MATERIAL_CHANGE', best);
    if (withinCooldown) return suppress('COOLDOWN', best);
    return {
      shouldAlert: true,
      reason: 'BETTER_CONVENIENCE',
      suppressedReason: null,
      dedupeKey: dedupeKeyFor('BETTER_CONVENIENCE', best, version),
      best,
    };
  }

  return suppress('NO_MATERIAL_CHANGE', best);
}

export function isWithinCooldown(
  lastAlertedAt: string | null,
  now: Date,
  cooldownMinutes: number,
): boolean {
  if (!lastAlertedAt) return false;
  const last = new Date(lastAlertedAt).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < cooldownMinutes * 60_000;
}

/** The state to persist after a successful alert. */
export function nextAlertState(best: Opportunity, now: Date): AlertState {
  return {
    lastAlertedAt: now.toISOString(),
    lastBestTotalCents: best.totalCents,
    lastBestSignature: best.signature,
    lastBestConvenienceScore: best.convenienceScore,
  };
}
