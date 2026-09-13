import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_THRESHOLDS,
  convenienceToleranceCents,
  decideAlert,
  isWithinCooldown,
  nextAlertState,
} from '@/lib/domain/alert-comparator';
import { convenienceScore } from '@/lib/domain/ranking';
import type { AlertState, Opportunity } from '@/lib/domain/types';
import { makeCandidate, makeWatch } from '../helpers/factories';

const watch = makeWatch({ benchmarkCents: 12800 });
const NOW = new Date('2026-09-02T18:00:00.000Z');
const LONG_AGO = '2026-09-02T10:00:00.000Z';

function opportunity(opts: {
  cents: number;
  displacement?: number;
  date?: string;
  transfers?: number;
  ambiguous?: boolean;
}): Opportunity {
  const date = opts.date ?? '2026-09-20';
  const candidate = makeCandidate({
    displacementDays: opts.displacement ?? 0,
    journey: {
      providerJourneyId: `j-${opts.cents}-${date}`,
      travelDate: date,
      departureLocal: `${date}T07:05`,
      arrivalLocal: `${date}T11:14`,
      transfers: opts.transfers ?? 0,
    },
    fare: { amountCents: opts.cents, partyTotalCents: opts.cents },
  });
  return {
    candidate,
    totalCents: opts.cents,
    savingsCents: 12800 - opts.cents,
    displacementDays: opts.displacement ?? 0,
    convenienceScore: convenienceScore(candidate, watch),
    signature: `${date}|179|${date}T07:05|FLEXIBLE|COACH`,
    pricingAmbiguous: opts.ambiguous ?? false,
  };
}

const fresh: AlertState = {
  lastAlertedAt: null,
  lastBestTotalCents: null,
  lastBestSignature: null,
  lastBestConvenienceScore: null,
};

describe('target price', () => {
  // The same train at a different price — the realistic steady state, and the
  // one where a target must not turn every wobble into an email.
  const SAME_TRAIN = '2026-09-20|179|2026-09-20T07:05|FLEXIBLE|COACH';
  const settled = (cents: number, at = LONG_AGO): AlertState => ({
    lastAlertedAt: at,
    lastBestTotalCents: cents,
    lastBestSignature: SAME_TRAIN,
    lastBestConvenienceScore: convenienceScore(
      makeCandidate({
        displacementDays: 0,
        journey: {
          providerJourneyId: 'j-settled',
          travelDate: '2026-09-20',
          departureLocal: '2026-09-20T07:05',
          arrivalLocal: '2026-09-20T11:14',
          transfers: 0,
        },
        fare: { amountCents: cents, partyTotalCents: cents },
      }),
      watch,
    ),
  });

  it('alerts the moment the best total crosses the target', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 7900 })],
      state: settled(9500),
      cycleStatus: 'SUCCESS',
      now: NOW,
      targetPriceCents: 8000,
    });
    expect(decision.shouldAlert).toBe(true);
    expect(decision.reason).toBe('TARGET_REACHED');
    expect(decision.dedupeKey).toContain('TARGET_REACHED');
  });

  it('fires even when the drop is far too small to be material on its own', () => {
    // 9500 -> 7999 would normally be a PRICE_DROP; 8001 -> 7999 would not be
    // anything at all. Crossing the line the user named still has to speak.
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 7999 })],
      state: settled(8001),
      cycleStatus: 'SUCCESS',
      now: NOW,
      targetPriceCents: 8000,
    });
    expect(decision.shouldAlert).toBe(true);
    expect(decision.reason).toBe('TARGET_REACHED');
  });

  it('fires through the cooldown, because crossing the target is the whole ask', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 7900 })],
      state: settled(9500, NOW.toISOString()),
      cycleStatus: 'SUCCESS',
      now: NOW,
      targetPriceCents: 8000,
    });
    expect(decision.shouldAlert).toBe(true);
    expect(decision.reason).toBe('TARGET_REACHED');
  });

  it('does not re-fire on every check once the fare is already under target', () => {
    // The single most important property: a fare oscillating a dollar below
    // the target must not generate an alert per check for the rest of the week.
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 7899 })],
      state: settled(7900),
      cycleStatus: 'SUCCESS',
      now: NOW,
      targetPriceCents: 8000,
    });
    expect(decision.shouldAlert).toBe(false);
    expect(decision.suppressedReason).toBe('NO_MATERIAL_CHANGE');
  });

  it('still reports an ordinary material drop that happens below the target', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 6900 })],
      state: settled(7900),
      cycleStatus: 'SUCCESS',
      now: NOW,
      targetPriceCents: 8000,
    });
    expect(decision.shouldAlert).toBe(true);
    expect(decision.reason).toBe('PRICE_DROP');
  });

  it('reports a first-ever find under the target as TARGET_REACHED, not FIRST_DROP', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 7400 })],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: NOW,
      targetPriceCents: 8000,
    });
    expect(decision.shouldAlert).toBe(true);
    expect(decision.reason).toBe('TARGET_REACHED');
  });

  it('leaves a first find above the target as an ordinary FIRST_DROP', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 9900 })],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: NOW,
      targetPriceCents: 8000,
    });
    expect(decision.shouldAlert).toBe(true);
    expect(decision.reason).toBe('FIRST_DROP');
  });

  it('never fires on a failed cycle, target or not', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 100 })],
      state: settled(9500),
      cycleStatus: 'FAILED',
      now: NOW,
      targetPriceCents: 8000,
    });
    expect(decision.shouldAlert).toBe(false);
    expect(decision.suppressedReason).toBe('CYCLE_FAILED');
  });

  it('never fires on an unresolved party price, target or not', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 100, ambiguous: true })],
      state: settled(9500),
      cycleStatus: 'SUCCESS',
      now: NOW,
      targetPriceCents: 8000,
    });
    expect(decision.shouldAlert).toBe(false);
    expect(decision.suppressedReason).toBe('AMBIGUOUS_PARTY_PRICING');
  });

  it('is inert when no target is set', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 7899 })],
      state: settled(7900),
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(decision.reason).not.toBe('TARGET_REACHED');
  });
});

describe('alert comparator', () => {
  it('alerts on the first qualifying opportunity', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 7400 })],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(decision.shouldAlert).toBe(true);
    expect(decision.reason).toBe('FIRST_DROP');
    expect(decision.dedupeKey).toContain('FIRST_DROP');
  });

  it('does not alert when there is nothing qualifying', () => {
    const decision = decideAlert({
      opportunities: [],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(decision.shouldAlert).toBe(false);
    expect(decision.suppressedReason).toBe('NO_QUALIFYING_OPPORTUNITY');
  });

  it('does not re-alert on an identical option set at an identical price', () => {
    const best = opportunity({ cents: 7400 });
    const decision = decideAlert({
      opportunities: [best],
      state: {
        lastAlertedAt: LONG_AGO,
        lastBestTotalCents: 7400,
        lastBestSignature: best.signature,
        lastBestConvenienceScore: best.convenienceScore,
      },
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(decision.shouldAlert).toBe(false);
    expect(decision.suppressedReason).toBe('NO_MATERIAL_CHANGE');
  });

  it('alerts on a material price drop but not a trivial one', () => {
    // Prior alert was the same itinerary shape, so convenience is unchanged and
    // only the price dimension is under test.
    const previouslyAlerted = opportunity({ cents: 8000 });
    const prior: AlertState = {
      lastAlertedAt: LONG_AGO,
      lastBestTotalCents: previouslyAlerted.totalCents,
      lastBestSignature: previouslyAlerted.signature,
      lastBestConvenienceScore: previouslyAlerted.convenienceScore,
    };

    const material = decideAlert({
      opportunities: [opportunity({ cents: 7400 })], // $6 cheaper
      state: prior,
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(material.reason).toBe('PRICE_DROP');

    const trivial = decideAlert({
      opportunities: [opportunity({ cents: 7800 })], // $2 cheaper
      state: prior,
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(trivial.shouldAlert).toBe(false);
    expect(trivial.suppressedReason).toBe('NO_MATERIAL_CHANGE');
  });

  it('alerts again when a similarly priced option is materially more convenient', () => {
    // The spec's example: $89 one day early was already alerted; $90 on the
    // exact desired day now exists. Nominally $1 dearer, but a better trip.
    const alerted = opportunity({ cents: 8900, displacement: -1, date: '2026-09-19' });
    const exactDay = opportunity({ cents: 9000, displacement: 0, date: '2026-09-20' });

    const decision = decideAlert({
      opportunities: [exactDay],
      state: {
        lastAlertedAt: LONG_AGO,
        lastBestTotalCents: alerted.totalCents,
        lastBestSignature: alerted.signature,
        lastBestConvenienceScore: alerted.convenienceScore,
      },
      cycleStatus: 'SUCCESS',
      now: NOW,
    });

    expect(decision.shouldAlert).toBe(true);
    expect(decision.reason).toBe('BETTER_CONVENIENCE');
  });

  it('does not alert when a more convenient option costs materially more', () => {
    const alerted = opportunity({ cents: 8900, displacement: -1, date: '2026-09-19' });
    const pricier = opportunity({ cents: 9500, displacement: 0, date: '2026-09-20' }); // +$6

    const decision = decideAlert({
      opportunities: [pricier],
      state: {
        lastAlertedAt: LONG_AGO,
        lastBestTotalCents: alerted.totalCents,
        lastBestSignature: alerted.signature,
        lastBestConvenienceScore: alerted.convenienceScore,
      },
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(decision.shouldAlert).toBe(false);
    expect(decision.suppressedReason).toBe('NO_MATERIAL_CHANGE');
  });

  it('respects the cooldown, but lets an urgent drop through', () => {
    const recent = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    const state: AlertState = {
      lastAlertedAt: recent,
      lastBestTotalCents: 12000,
      lastBestSignature: 'old',
      lastBestConvenienceScore: 40,
    };

    const modest = decideAlert({
      opportunities: [opportunity({ cents: 11000 })], // $10 drop
      state,
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(modest.shouldAlert).toBe(false);
    expect(modest.suppressedReason).toBe('COOLDOWN');

    const urgent = decideAlert({
      opportunities: [opportunity({ cents: 8000 })], // $40 drop
      state,
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(urgent.shouldAlert).toBe(true);
    expect(urgent.reason).toBe('PRICE_DROP');
  });

  it('alerts when a small drop comes with a materially better trip', () => {
    const alerted = opportunity({ cents: 7600, displacement: -1, date: '2026-09-19' });
    const better = opportunity({ cents: 7400, displacement: 0, date: '2026-09-20' });
    const decision = decideAlert({
      opportunities: [better],
      state: {
        lastAlertedAt: LONG_AGO,
        lastBestTotalCents: alerted.totalCents,
        lastBestSignature: alerted.signature,
        lastBestConvenienceScore: alerted.convenienceScore,
      },
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(decision.shouldAlert).toBe(true);
    expect(decision.reason).toBe('BETTER_CONVENIENCE');
  });

  it('never alerts on a failed or skipped cycle', () => {
    for (const status of ['FAILED', 'SKIPPED_BUDGET', 'SKIPPED_EXPIRED'] as const) {
      const decision = decideAlert({
        opportunities: [opportunity({ cents: 7400 })],
        state: fresh,
        cycleStatus: status,
        now: NOW,
      });
      expect(decision.shouldAlert).toBe(false);
      expect(decision.suppressedReason).toBe('CYCLE_FAILED');
    }
  });

  it('still alerts on a partially successful cycle', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 7400 })],
      state: fresh,
      cycleStatus: 'PARTIAL_SUCCESS',
      now: NOW,
    });
    expect(decision.shouldAlert).toBe(true);
  });

  it('refuses to alert on arithmetically untrustworthy party pricing', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 7400, ambiguous: true })],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    expect(decision.shouldAlert).toBe(false);
    expect(decision.suppressedReason).toBe('AMBIGUOUS_PARTY_PRICING');
  });

  it('aborts when the benchmark changed while the cycle was in flight', () => {
    const decision = decideAlert({
      opportunities: [opportunity({ cents: 7400 })],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: NOW,
      benchmarkChanged: true,
    });
    expect(decision.shouldAlert).toBe(false);
    expect(decision.suppressedReason).toBe('BENCHMARK_CHANGED');
  });

  it('produces a stable dedupe key so a retried cycle cannot double-send', () => {
    const a = decideAlert({
      opportunities: [opportunity({ cents: 7400 })],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: NOW,
    });
    const b = decideAlert({
      opportunities: [opportunity({ cents: 7400 })],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: new Date(NOW.getTime() + 5 * 60_000),
    });
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });

  it('computes the convenience price tolerance as the tighter of absolute and relative', () => {
    expect(convenienceToleranceCents(8900, DEFAULT_ALERT_THRESHOLDS)).toBe(200);
    expect(convenienceToleranceCents(3000, DEFAULT_ALERT_THRESHOLDS)).toBe(90);
  });

  it('tracks cooldown windows', () => {
    expect(isWithinCooldown(null, NOW, 60)).toBe(false);
    expect(isWithinCooldown(new Date(NOW.getTime() - 30 * 60_000).toISOString(), NOW, 60)).toBe(
      true,
    );
    expect(isWithinCooldown(new Date(NOW.getTime() - 90 * 60_000).toISOString(), NOW, 60)).toBe(
      false,
    );
  });

  it('captures the state to persist after alerting', () => {
    const best = opportunity({ cents: 7400 });
    expect(nextAlertState(best, NOW)).toEqual({
      lastAlertedAt: NOW.toISOString(),
      lastBestTotalCents: 7400,
      lastBestSignature: best.signature,
      lastBestConvenienceScore: best.convenienceScore,
    });
  });
});

describe('dedupe key carries benchmark identity', () => {
  it('produces a different key after a rebook, so a real drop is not suppressed forever', () => {
    const best = opportunity({ cents: 7400 });

    // Before the rebook.
    const first = decideAlert({
      opportunities: [best],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: NOW,
      benchmarkVersion: 1,
    });

    // The user rebooks: alert state is reset (which is what re-enters
    // FIRST_DROP), the benchmark version is bumped, and the SAME fare at the
    // SAME price still qualifies against the new benchmark.
    const afterRebook = decideAlert({
      opportunities: [best],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: NOW,
      benchmarkVersion: 2,
    });

    expect(first.shouldAlert).toBe(true);
    expect(afterRebook.shouldAlert).toBe(true);
    // Identical keys would collide on `unique (watch_id, dedupe_key)`, the insert
    // would be swallowed, and the user would never hear about this drop.
    expect(afterRebook.dedupeKey).not.toBe(first.dedupeKey);
    expect(first.dedupeKey).toContain(':v1:');
    expect(afterRebook.dedupeKey).toContain(':v2:');
  });

  it('is still stable across retries of the same cycle', () => {
    const a = decideAlert({
      opportunities: [opportunity({ cents: 7400 })],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: NOW,
      benchmarkVersion: 3,
    });
    const b = decideAlert({
      opportunities: [opportunity({ cents: 7400 })],
      state: fresh,
      cycleStatus: 'SUCCESS',
      now: new Date(NOW.getTime() + 60_000),
      benchmarkVersion: 3,
    });
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });
});
