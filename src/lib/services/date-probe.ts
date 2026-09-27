import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { canonicalKey } from '@/lib/domain/search-planner';
import type { FareSearchRequest } from '@/lib/domain/types';
import type { WatchRow } from '@/lib/db/types';
import { createLogger, describeError } from '@/lib/log';
import { ProviderError, type FareProvider } from '@/lib/providers/fare-provider';
import { checkBudget, recordProviderFailure, recordProviderSuccess } from './usage';

const logger = createLogger({ component: 'date-probe' });

export interface ProbeResult {
  probed: number;
  succeeded: number;
  failed: number;
  /** Set when the budget stopped some or all of the scan. */
  budgetMessage: string | null;
}

/**
 * Price a set of dates once, outside the monitoring window.
 *
 * Runs the same provider and the same accounting as a scheduled check, so the
 * spend is visible in `provider_requests` like any other — but it creates no
 * cycle, evaluates no eligibility and raises no alert. A fare on a date the
 * user never opted to monitor is not eligible under the rules the rest of the
 * product enforces, and quietly alerting on one would break that contract.
 *
 * Failures are recorded as failures. A date the provider could not answer for
 * shows as a gap in the calendar, never as "nothing available" — the same rule
 * the price chart follows.
 */
export async function runDateProbe(
  db: SupabaseClient,
  provider: FareProvider,
  watch: WatchRow,
  dates: readonly string[],
  now: Date = new Date(),
): Promise<ProbeResult> {
  if (dates.length === 0) {
    return { probed: 0, succeeded: 0, failed: 0, budgetMessage: null };
  }

  // The same ceiling every other search passes through. A probe is a bigger
  // single ask than a scheduled check, so it is exactly the thing that should
  // be refused when the month's budget is nearly gone.
  const budget = await checkBudget(db, dates.length, now);
  const executable = dates.slice(0, budget.allowance);
  const budgetMessage =
    executable.length < dates.length
      ? `Checked ${executable.length} of ${dates.length} dates — ${budget.reason ?? 'the provider budget was reached.'}`
      : null;

  let succeeded = 0;
  let failed = 0;

  for (const date of executable) {
    const request: FareSearchRequest = {
      originCode: watch.origin_code.toUpperCase(),
      destinationCode: watch.destination_code.toUpperCase(),
      date,
      passengers: watch.passengers,
    };
    const requestId = randomUUID();
    const startedAt = Date.now();
    const recordInput = {
      dispatchRunId: null,
      providerId: provider.id,
      canonicalKey: canonicalKey(request),
      request,
      servedCycles: 1,
    };

    try {
      const result = await provider.search(request, { requestId, watchId: watch.id });
      await recordProviderSuccess(db, recordInput, {
        httpStatus: result.meta.httpStatus,
        latencyMs: result.meta.latencyMs,
        journeysReturned: result.journeys.length,
        creditsCharged: result.meta.creditsCharged,
        creditsRemaining: result.meta.creditsRemaining,
        schemaAliases: result.meta.schemaAliases,
        attempts: 1,
      });

      const prices = result.journeys.flatMap((journey) =>
        journey.fares.map((fare) => fare.partyTotalCents),
      );
      const cheapest = prices.length > 0 ? Math.min(...prices) : null;

      await upsertProbe(db, watch, date, {
        status: cheapest === null ? 'NO_AVAILABILITY' : 'SUCCESS',
        cheapestTotalCents: cheapest,
        journeysReturned: result.journeys.length,
        errorKind: null,
      });
      succeeded += 1;
    } catch (error) {
      await recordProviderFailure(db, recordInput, error, Date.now() - startedAt, 1);
      await upsertProbe(db, watch, date, {
        status: 'FAILED',
        cheapestTotalCents: null,
        journeysReturned: 0,
        errorKind: error instanceof ProviderError ? error.kind : 'UNKNOWN',
      });
      failed += 1;
      logger.warn('date probe failed', { watch_id: watch.id, date, ...describeError(error) });
    }
  }

  logger.info('date probe complete', {
    watch_id: watch.id,
    probed: executable.length,
    succeeded,
    failed,
  });

  return { probed: executable.length, succeeded, failed, budgetMessage };
}

async function upsertProbe(
  db: SupabaseClient,
  watch: WatchRow,
  travelDate: string,
  fields: {
    status: 'SUCCESS' | 'NO_AVAILABILITY' | 'FAILED';
    cheapestTotalCents: number | null;
    journeysReturned: number;
    errorKind: string | null;
  },
): Promise<void> {
  // One row per date: re-probing replaces the answer rather than stacking
  // stale ones the calendar would have to disambiguate.
  const { error } = await db.from('date_probes').upsert(
    {
      watch_id: watch.id,
      user_id: watch.user_id,
      travel_date: travelDate,
      status: fields.status,
      cheapest_total_cents: fields.cheapestTotalCents,
      journeys_returned: fields.journeysReturned,
      error_kind: fields.errorKind,
      probed_at: new Date().toISOString(),
    },
    { onConflict: 'watch_id,travel_date' },
  );

  if (error) {
    logger.error('could not store a date probe', {
      watch_id: watch.id,
      date: travelDate,
      error: error.message,
    });
  }
}
