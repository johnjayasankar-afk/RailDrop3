import type { Cents } from './money';

export interface BenchmarkEvent {
  watchId: string;
  benchmarkVersion: number;
  amountCents: Cents;
}

export interface RealisedSavings {
  /** Money actually saved: the sum of every downward rebooking. */
  totalCents: Cents;
  /** How many trips contributed. */
  trips: number;
  /** How many rebookings were downward. */
  rebookings: number;
}

/**
 * What the user actually saved, as opposed to what was merely offered.
 *
 * "Total savings found" is the headline number every fare monitor shows, and
 * it costs nothing to be true — it only says a cheaper fare existed. This is
 * the harder, more honest number: the benchmark is what the user tells us they
 * paid, so a rebooking to a lower amount is money that genuinely changed hands
 * in their favour.
 *
 * Two rules keep it honest:
 *
 *   1. Only *downward* moves count. Rebooking to a more expensive flexible
 *      fare is a real choice people make, and netting it off against a
 *      genuine saving would understate one and overstate the other; counting
 *      it as a saving would be a lie. It contributes zero.
 *   2. Versions are walked in order per trip, so a trip rebooked three times
 *      contributes each downward step rather than only its endpoints — and a
 *      row arriving out of order cannot invent a saving.
 */
export function realisedSavings(events: BenchmarkEvent[]): RealisedSavings {
  const byWatch = new Map<string, BenchmarkEvent[]>();
  for (const event of events) {
    const list = byWatch.get(event.watchId);
    if (list) list.push(event);
    else byWatch.set(event.watchId, [event]);
  }

  let totalCents = 0;
  let trips = 0;
  let rebookings = 0;

  for (const list of byWatch.values()) {
    const ordered = [...list].sort((a, b) => a.benchmarkVersion - b.benchmarkVersion);
    let watchTotal = 0;

    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1] as BenchmarkEvent;
      const current = ordered[i] as BenchmarkEvent;
      const delta = previous.amountCents - current.amountCents;
      if (delta > 0) {
        watchTotal += delta;
        rebookings += 1;
      }
    }

    if (watchTotal > 0) {
      totalCents += watchTotal;
      trips += 1;
    }
  }

  return { totalCents, trips, rebookings };
}
