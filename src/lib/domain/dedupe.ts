/**
 * Global, cycle-wide search deduplication.
 *
 * Two watches whose travel windows overlap must not each pay for the shared dates.
 *   Watch A: Sep 19, 20, 21
 *   Watch B: Sep 20, 21, 22
 *   → 4 external calls, not 6.
 */

import type { PlannedSearch, SearchPlan } from './search-planner';
import type { FareSearchRequest } from './types';

export interface BatchPlan {
  /** One entry per distinct canonical key, in stable order. */
  uniqueSearches: PlannedSearch[];
  /** watchId → the canonical keys that watch needs. */
  assignments: Map<string, string[]>;
  /** How many searches were requested in total, before collapsing. */
  requestedCount: number;
  /** requestedCount − uniqueSearches.length. Persisted as an observability metric. */
  savedCalls: number;
}

export function planBatch(plans: SearchPlan[]): BatchPlan {
  const uniqueByKey = new Map<string, PlannedSearch>();
  const assignments = new Map<string, string[]>();
  let requestedCount = 0;

  for (const plan of plans) {
    const keys: string[] = [];
    for (const search of plan.searches) {
      requestedCount += 1;
      if (!uniqueByKey.has(search.canonicalKey)) {
        uniqueByKey.set(search.canonicalKey, search);
      }
      keys.push(search.canonicalKey);
    }
    // A watch may legitimately appear once; merge rather than overwrite so a
    // caller passing two plans for one watch still gets a correct assignment.
    const existing = assignments.get(plan.watchId) ?? [];
    assignments.set(plan.watchId, [...existing, ...keys]);
  }

  const uniqueSearches = [...uniqueByKey.values()];
  return {
    uniqueSearches,
    assignments,
    requestedCount,
    savedCalls: requestedCount - uniqueSearches.length,
  };
}

/**
 * The displacement of a shared search differs per watch (Sep 20 is D for watch A
 * but D-1 for watch B), so displacement is resolved per watch, never cached.
 */
export function displacementFor(plan: SearchPlan, canonicalKeyValue: string): number | null {
  const match = plan.searches.find((s) => s.canonicalKey === canonicalKeyValue);
  return match ? match.searchDate.displacementDays : null;
}

export function requestFromKey(key: string): FareSearchRequest {
  const [originCode, destinationCode, date, passengers] = key.split('|');
  if (!originCode || !destinationCode || !date || !passengers) {
    throw new Error(`Malformed canonical key: ${key}`);
  }
  return { originCode, destinationCode, date, passengers: Number(passengers) };
}
