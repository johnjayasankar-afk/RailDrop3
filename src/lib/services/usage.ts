import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { createLogger } from '@/lib/log';
import type { FareSearchRequest } from '@/lib/domain/types';
import { ProviderError } from '@/lib/providers/fare-provider';

const logger = createLogger({ component: 'usage' });

export interface UsageSummary {
  requests: number;
  successes: number;
  failures: number;
  creditsUsed: number;
  avgLatencyMs: number;
  dedupeFanoutSaved: number;
  budget: number;
  creditsPerSearch: number;
  usedPct: number;
  softStopPct: number;
  hardStopPct: number;
  projectedMonthEnd: number;
  softStopped: boolean;
  hardStopped: boolean;
  periodStart: string;
}

export interface BudgetDecision {
  allowed: boolean;
  /** How many searches may run right now. */
  allowance: number;
  reason: string | null;
  summary: UsageSummary;
}

/** Postgres numeric may arrive as a string; never silently treat it as zero. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysInCurrentMonth(now: Date): number {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

export async function getUsageSummary(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<UsageSummary> {
  const env = getServerEnv();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  // Aggregate in Postgres, NOT by summing rows in JS.
  //
  // PostgREST silently caps a response at max-rows (1000 by default). Summing
  // client-side meant that once a month exceeded that many provider calls the
  // total froze at an arbitrary subset, usedPct never approached 1.0, and the
  // budget hard stop - the only thing between a retry loop and unbounded spend -
  // could never fire. One aggregated row is always exact.
  const { data, error } = await db.rpc('provider_usage_since', { p_since: periodStart });
  if (error) throw new Error(`Failed to read provider usage: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        requests: number | string;
        successes: number | string;
        failures: number | string;
        credits_used: number | string;
        avg_latency_ms: number | string;
        dedupe_fanout_saved: number | string;
      }
    | undefined;

  const requests = toNumber(row?.requests) ?? 0;
  const successes = toNumber(row?.successes) ?? 0;
  const failures = toNumber(row?.failures) ?? 0;
  const creditsUsed = toNumber(row?.credits_used) ?? 0;
  const avgLatencyMs = Math.round(toNumber(row?.avg_latency_ms) ?? 0);
  const dedupeFanoutSaved = toNumber(row?.dedupe_fanout_saved) ?? 0;

  const budget = env.monthlyCreditBudget;
  const usedPct = budget > 0 ? creditsUsed / budget : 0;
  const dayOfMonth = now.getUTCDate();
  const projectedMonthEnd =
    dayOfMonth > 0 ? (creditsUsed / dayOfMonth) * daysInCurrentMonth(now) : creditsUsed;

  return {
    requests,
    successes,
    failures,
    creditsUsed,
    avgLatencyMs,
    dedupeFanoutSaved,
    budget,
    creditsPerSearch: env.creditsPerSearch,
    usedPct,
    softStopPct: env.budgetSoftStopPct,
    hardStopPct: env.budgetHardStopPct,
    projectedMonthEnd: Math.round(projectedMonthEnd),
    softStopped: usedPct >= env.budgetSoftStopPct,
    hardStopped: usedPct >= env.budgetHardStopPct,
    periodStart,
  };
}

/**
 * Lifetime-ish spend attributable to one user, for the per-user ceiling.
 *
 * maxActiveWatchesPerUser counted only ACTIVE rows, so create -> initial scan ->
 * delete -> repeat had no ceiling at all and could drain a shared credit pool
 * while cascade-deleting the evidence.
 */
export async function getUserSearchCount(
  db: SupabaseClient,
  userId: string,
  since: Date,
): Promise<number> {
  const { data, error } = await db.rpc('user_credits_since', {
    p_user_id: userId,
    p_since: since.toISOString(),
  });
  if (error) return 0;
  return toNumber(data) ?? 0;
}

/**
 * Decide how many searches this dispatch may perform. Two independent ceilings:
 * the monthly credit budget, and a hard per-dispatch cap that holds even if the
 * budget maths is somehow wrong.
 */
export async function checkBudget(
  db: SupabaseClient,
  plannedSearches: number,
  now: Date = new Date(),
): Promise<BudgetDecision> {
  const env = getServerEnv();
  const summary = await getUsageSummary(db, now);

  if (summary.hardStopped) {
    return {
      allowed: false,
      allowance: 0,
      reason: `Monthly credit budget exhausted (${summary.creditsUsed}/${summary.budget}).`,
      summary,
    };
  }

  const remainingCredits = Math.max(
    0,
    summary.budget * env.budgetHardStopPct - summary.creditsUsed,
  );
  const affordable = Math.floor(remainingCredits / Math.max(1, env.creditsPerSearch));
  const allowance = Math.min(plannedSearches, affordable, env.maxSearchesPerDispatch);

  if (allowance < plannedSearches) {
    logger.warn('provider search allowance reduced', {
      planned: plannedSearches,
      allowance,
      credits_used: summary.creditsUsed,
      budget: summary.budget,
    });
  }

  return {
    allowed: allowance > 0,
    allowance,
    reason: allowance < plannedSearches ? 'Budget or per-dispatch ceiling reached.' : null,
    summary,
  };
}

export interface RecordRequestInput {
  dispatchRunId: string | null;
  providerId: string;
  canonicalKey: string;
  request: FareSearchRequest;
  servedCycles: number;
}

export async function recordProviderSuccess(
  db: SupabaseClient,
  input: RecordRequestInput,
  meta: {
    httpStatus: number | null;
    latencyMs: number;
    journeysReturned: number;
    creditsCharged: number | null;
    creditsRemaining: number | null;
    schemaAliases: string[];
    attempts: number;
  },
): Promise<string | null> {
  const env = getServerEnv();
  const { data, error } = await db
    .from('provider_requests')
    .insert({
      dispatch_run_id: input.dispatchRunId,
      provider_id: input.providerId,
      canonical_key: input.canonicalKey,
      origin_code: input.request.originCode,
      destination_code: input.request.destinationCode,
      travel_date: input.request.date,
      passengers: input.request.passengers,
      status: 'SUCCESS',
      http_status: meta.httpStatus,
      latency_ms: meta.latencyMs,
      attempts: meta.attempts,
      journeys_returned: meta.journeysReturned,
      credits_charged: meta.creditsCharged,
      credits_estimated: env.creditsPerSearch,
      credits_remaining: meta.creditsRemaining,
      served_cycles: input.servedCycles,
      schema_aliases: meta.schemaAliases,
    })
    .select('id')
    .single();

  if (error) {
    logger.error('failed to record provider success', { error: error.message });
    return null;
  }
  return (data as { id: string }).id;
}

export async function recordProviderFailure(
  db: SupabaseClient,
  input: RecordRequestInput,
  error: unknown,
  latencyMs: number,
  attempts: number,
): Promise<string | null> {
  const env = getServerEnv();
  const providerError = error instanceof ProviderError ? error : null;
  const { data, error: dbError } = await db
    .from('provider_requests')
    .insert({
      dispatch_run_id: input.dispatchRunId,
      provider_id: input.providerId,
      canonical_key: input.canonicalKey,
      origin_code: input.request.originCode,
      destination_code: input.request.destinationCode,
      travel_date: input.request.date,
      passengers: input.request.passengers,
      status: 'FAILED',
      error_kind: providerError?.kind ?? 'NETWORK',
      error_message:
        error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      http_status: providerError?.httpStatus ?? null,
      latency_ms: latencyMs,
      attempts,
      journeys_returned: 0,
      // A failed call may still have been charged; the estimate is the honest
      // upper bound until a header says otherwise.
      credits_estimated: providerError?.kind === 'CIRCUIT_OPEN' ? 0 : env.creditsPerSearch,
      served_cycles: input.servedCycles,
    })
    .select('id')
    .single();

  if (dbError) {
    logger.error('failed to record provider failure', { error: dbError.message });
    return null;
  }
  return (data as { id: string }).id;
}

/**
 * Durable circuit check: consecutive recent hard failures across ALL instances,
 * which an in-process breaker cannot see in a serverless deployment.
 */
export async function isProviderCircuitOpen(db: SupabaseClient): Promise<boolean> {
  const env = getServerEnv();
  const since = new Date(Date.now() - env.circuitCooldownMinutes * 60_000).toISOString();
  const { data, error } = await db
    .from('provider_requests')
    .select('status, error_kind')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(env.circuitFailures);

  if (error || !data || data.length < env.circuitFailures) return false;

  return (data as Array<{ status: string; error_kind: string | null }>).every(
    (row) =>
      row.status === 'FAILED' &&
      row.error_kind !== 'STALE_INPUT' &&
      row.error_kind !== 'BAD_REQUEST',
  );
}
