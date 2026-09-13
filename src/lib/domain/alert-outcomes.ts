import type { Cents } from './money';

/**
 * What happened after each alert.
 *
 * An alert history that only lists what was offered leaves the most important
 * question unanswered: did any of it lead anywhere? The benchmark ledger
 * already records every rebooking, so the sequence is knowable without asking
 * the user anything.
 *
 * A deliberate line: this reports **sequence, not cause**. "You rebooked after
 * this alert, at $66 less" is a fact. "This alert saved you $66" is a claim
 * about why somebody acted, which the data cannot support and which this
 * product does not make anywhere else.
 */

export interface AlertLike {
  id: string;
  watchId: string;
  createdAt: string;
}

export interface RebookingLike {
  watchId: string;
  createdAt: string;
  /** The benchmark before this rebooking. */
  fromCents: Cents;
  /** The benchmark after it. */
  toCents: Cents;
}

export type AlertOutcome =
  { kind: 'REBOOKED'; at: string; dropCents: Cents; hoursAfter: number } | { kind: 'NONE' };

/**
 * Attribute each rebooking to the most recent alert that preceded it.
 *
 * Attribution is to the *latest* alert before the rebooking, not the earliest:
 * if three alerts fire over a week and the user acts after the third, crediting
 * the first would misstate which price they actually responded to. A rebooking
 * with no alert before it is attributed to nothing at all.
 */
export function attributeOutcomes(
  alerts: readonly AlertLike[],
  rebookings: readonly RebookingLike[],
): Map<string, AlertOutcome> {
  const outcomes = new Map<string, AlertOutcome>(
    alerts.map((alert) => [alert.id, { kind: 'NONE' }]),
  );

  const byWatch = new Map<string, AlertLike[]>();
  for (const alert of alerts) {
    const list = byWatch.get(alert.watchId);
    if (list) list.push(alert);
    else byWatch.set(alert.watchId, [alert]);
  }
  for (const list of byWatch.values()) {
    list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  for (const rebooking of rebookings) {
    const candidates = byWatch.get(rebooking.watchId);
    if (!candidates) continue;

    const rebookedAt = Date.parse(rebooking.createdAt);
    if (Number.isNaN(rebookedAt)) continue;

    let latest: AlertLike | null = null;
    for (const alert of candidates) {
      const alertedAt = Date.parse(alert.createdAt);
      if (Number.isNaN(alertedAt) || alertedAt > rebookedAt) break;
      latest = alert;
    }
    if (!latest) continue;

    // Only a downward move is reported. Rebooking to a dearer flexible fare is
    // a real choice, and calling it an outcome of a price-drop alert would
    // read as a saving it is not.
    const dropCents = rebooking.fromCents - rebooking.toCents;
    if (dropCents <= 0) continue;

    const existing = outcomes.get(latest.id);
    // Several rebookings after one alert: keep the first, which is the one
    // that actually followed it.
    if (existing && existing.kind === 'REBOOKED' && Date.parse(existing.at) <= rebookedAt) continue;

    outcomes.set(latest.id, {
      kind: 'REBOOKED',
      at: rebooking.createdAt,
      dropCents,
      hoursAfter: Math.max(0, (rebookedAt - Date.parse(latest.createdAt)) / 3_600_000),
    });
  }

  return outcomes;
}

/** Sequence, never causation. */
export function describeOutcome(outcome: AlertOutcome): string | null {
  if (outcome.kind !== 'REBOOKED') return null;
  if (outcome.hoursAfter < 1) return 'Rebooked within the hour';
  if (outcome.hoursAfter < 48) return `Rebooked ${Math.round(outcome.hoursAfter)} hours later`;
  return `Rebooked ${Math.round(outcome.hoursAfter / 24)} days later`;
}
