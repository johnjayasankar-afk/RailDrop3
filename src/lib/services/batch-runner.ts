import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { todayInTimeZone } from '@/lib/domain/dates';
import { planSearches, type SearchPlan } from '@/lib/domain/search-planner';
import { planBatch, requestFromKey } from '@/lib/domain/dedupe';
import { evaluateEligibility, type DatedResult } from '@/lib/domain/eligibility';
import { buildOpportunities } from '@/lib/domain/opportunity';
import { isMonitoringOpen } from '@/lib/domain/schedule';
import type {
  CheckTrigger,
  CycleStatus,
  FareSearchResult,
  Opportunity,
  Watch,
} from '@/lib/domain/types';
import { createLogger, describeError } from '@/lib/log';
import { getServerEnv } from '@/lib/env';
import { ProviderError, type FareProvider } from '@/lib/providers/fare-provider';
import { journeyToRow } from './mappers';
import { checkBudget, recordProviderFailure, recordProviderSuccess } from './usage';
import { processAlert, type AlertOutcome } from './alerts';

const logger = createLogger({ component: 'batch-runner' });

export interface WatchJob {
  watch: Watch;
  trigger: CheckTrigger;
  scheduledRunId: string | null;
  recipientEmail: string | null;
  /**
   * A cycle row already inserted as an atomic reservation (manual checks).
   * The runner adopts it instead of inserting a second one.
   */
  reservedCycleId?: string | null;
  /** Which attempt of a reclaimed scheduled run this is, for lease fencing. */
  attempt?: number | null;
}

export interface BatchOptions {
  db: SupabaseClient;
  provider: FareProvider;
  dispatchRunId: string | null;
  now?: Date;
  concurrency?: number;
  sendEmails?: boolean;
}

export interface CycleOutcome {
  watchId: string;
  cycleId: string | null;
  status: CycleStatus;
  datesTotal: number;
  datesSucceeded: number;
  datesFailed: number;
  bestTotalCents: number | null;
  qualifyingOptions: number;
  alert: AlertOutcome | null;
  error: string | null;
}

export interface BatchResult {
  cycles: CycleOutcome[];
  searchesRequested: number;
  searchesExecuted: number;
  searchesSaved: number;
  creditsCharged: number;
  alertsCreated: number;
  emailsSent: number;
  errors: number;
}

type SearchOutcome =
  | { ok: true; result: FareSearchResult; providerRequestId: string | null }
  | { ok: false; error: unknown; providerRequestId: string | null };

/** Bounded-concurrency map that preserves input order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index] as T;
      results[index] = await fn(item, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runBatch(jobs: WatchJob[], options: BatchOptions): Promise<BatchResult> {
  const env = getServerEnv();
  const now = options.now ?? new Date();
  const { db, provider, dispatchRunId } = options;

  const empty: BatchResult = {
    cycles: [],
    searchesRequested: 0,
    searchesExecuted: 0,
    searchesSaved: 0,
    creditsCharged: 0,
    alertsCreated: 0,
    emailsSent: 0,
    errors: 0,
  };
  if (jobs.length === 0) return empty;

  // 1. Plan every watch's searches, dropping windows that have expired.
  const plans = new Map<string, SearchPlan>();
  const runnable: WatchJob[] = [];
  const expired: WatchJob[] = [];

  for (const job of jobs) {
    // Monitoring is re-validated at EXECUTION time, not only at scheduling time.
    if (
      job.trigger !== 'MANUAL' &&
      job.trigger !== 'INITIAL' &&
      !isMonitoringOpen(job.watch, now)
    ) {
      expired.push(job);
      continue;
    }
    const today = todayInTimeZone(now, job.watch.timezone);
    const plan = planSearches(job.watch, today);
    if (plan.searches.length === 0) {
      expired.push(job);
      continue;
    }
    plans.set(job.watch.id, plan);
    runnable.push(job);
  }

  const cycles: CycleOutcome[] = [];

  for (const job of expired) {
    const cycleId = await createCycle(db, job, dispatchRunId, now);
    await finishCycle(db, cycleId, {
      status: 'SKIPPED_EXPIRED',
      datesTotal: 0,
      datesSucceeded: 0,
      datesFailed: 0,
      journeysReturned: 0,
      eligibleCandidates: 0,
      qualifyingOptions: 0,
      bestTotalCents: null,
      bestSavingsCents: null,
      alertSuppressedReason: 'CYCLE_FAILED',
      startedAt: now,
    });
    cycles.push({
      watchId: job.watch.id,
      cycleId,
      status: 'SKIPPED_EXPIRED',
      datesTotal: 0,
      datesSucceeded: 0,
      datesFailed: 0,
      bestTotalCents: null,
      qualifyingOptions: 0,
      alert: null,
      error: null,
    });
  }

  if (runnable.length === 0) return { ...empty, cycles };

  // 2. Collapse the union of every watch's searches. Overlapping travel windows
  //    share their dates instead of each paying for them.
  const batch = planBatch([...plans.values()]);

  // 3. Budget gate BEFORE any external call.
  const budget = await checkBudget(db, batch.uniqueSearches.length, now);
  if (!budget.allowed) {
    for (const job of runnable) {
      const cycleId = await createCycle(db, job, dispatchRunId, now);
      await finishCycle(db, cycleId, {
        status: 'SKIPPED_BUDGET',
        datesTotal: plans.get(job.watch.id)?.searches.length ?? 0,
        datesSucceeded: 0,
        datesFailed: 0,
        journeysReturned: 0,
        eligibleCandidates: 0,
        qualifyingOptions: 0,
        bestTotalCents: null,
        bestSavingsCents: null,
        alertSuppressedReason: 'CYCLE_FAILED',
        errorKind: 'BUDGET',
        errorMessage: budget.reason,
        startedAt: now,
      });
      cycles.push({
        watchId: job.watch.id,
        cycleId,
        status: 'SKIPPED_BUDGET',
        datesTotal: 0,
        datesSucceeded: 0,
        datesFailed: 0,
        bestTotalCents: null,
        qualifyingOptions: 0,
        alert: null,
        error: budget.reason,
      });
    }
    logger.warn('batch skipped: provider budget', { reason: budget.reason });
    return {
      ...empty,
      cycles,
      searchesRequested: batch.requestedCount,
      searchesSaved: batch.savedCalls,
    };
  }

  const executable = batch.uniqueSearches.slice(0, budget.allowance);

  // 4. Count how many cycles each unique call serves (dedupe fan-out metric).
  const servedCount = new Map<string, number>();
  for (const keys of batch.assignments.values()) {
    for (const key of new Set(keys)) servedCount.set(key, (servedCount.get(key) ?? 0) + 1);
  }

  // 5. Execute each UNIQUE search exactly once.
  let creditsCharged = 0;
  const outcomes = new Map<string, SearchOutcome>();

  const executed = await mapPool(executable, options.concurrency ?? 3, async (planned) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const recordInput = {
      dispatchRunId,
      providerId: provider.id,
      canonicalKey: planned.canonicalKey,
      request: planned.request,
      servedCycles: servedCount.get(planned.canonicalKey) ?? 1,
    };

    try {
      const result = await provider.search(planned.request, { requestId });
      const providerRequestId = await recordProviderSuccess(db, recordInput, {
        httpStatus: result.meta.httpStatus,
        latencyMs: result.meta.latencyMs,
        journeysReturned: result.journeys.length,
        creditsCharged: result.meta.creditsCharged,
        creditsRemaining: result.meta.creditsRemaining,
        schemaAliases: result.meta.schemaAliases,
        attempts: 1,
      });
      creditsCharged += result.meta.creditsCharged ?? env.creditsPerSearch;
      logger.info('provider search ok', {
        provider_request_id: requestId,
        canonical_key: planned.canonicalKey,
        journeys: result.journeys.length,
        latency_ms: result.meta.latencyMs,
      });
      return {
        key: planned.canonicalKey,
        outcome: { ok: true, result, providerRequestId } as SearchOutcome,
      };
    } catch (error) {
      const providerRequestId = await recordProviderFailure(
        db,
        recordInput,
        error,
        Date.now() - startedAt,
        1,
      );
      if (!(error instanceof ProviderError) || error.kind !== 'CIRCUIT_OPEN') {
        creditsCharged += env.creditsPerSearch;
      }
      logger.error('provider search failed', {
        provider_request_id: requestId,
        canonical_key: planned.canonicalKey,
        ...describeError(error),
      });
      return {
        key: planned.canonicalKey,
        outcome: { ok: false, error, providerRequestId } as SearchOutcome,
      };
    }
  });

  for (const { key, outcome } of executed) outcomes.set(key, outcome);

  // Anything the budget trimmed is a failure for the affected dates, never a
  // silent "no availability".
  for (const planned of batch.uniqueSearches.slice(budget.allowance)) {
    outcomes.set(planned.canonicalKey, {
      ok: false,
      providerRequestId: null,
      error: new ProviderError('Skipped: per-dispatch search ceiling reached', {
        kind: 'BUDGET',
        retryable: false,
      }),
    });
  }

  // 6. Fan the shared results back out to each watch.
  let alertsCreated = 0;
  let emailsSent = 0;
  let errors = 0;

  for (const job of runnable) {
    const plan = plans.get(job.watch.id);
    if (!plan) continue;
    try {
      const outcome = await runCycleForWatch({
        db,
        job,
        plan,
        outcomes,
        dispatchRunId,
        now,
        sendEmails: options.sendEmails ?? true,
      });
      cycles.push(outcome);
      if (outcome.alert?.alertCreated) alertsCreated += 1;
      if (outcome.alert?.emailSent) emailsSent += 1;
      if (outcome.status === 'FAILED') errors += 1;
    } catch (error) {
      errors += 1;
      logger.error('cycle failed', { watch_id: job.watch.id, ...describeError(error) });
      cycles.push({
        watchId: job.watch.id,
        cycleId: null,
        status: 'FAILED',
        datesTotal: plan.searches.length,
        datesSucceeded: 0,
        datesFailed: plan.searches.length,
        bestTotalCents: null,
        qualifyingOptions: 0,
        alert: null,
        error: describeError(error).message,
      });
    }
  }

  return {
    cycles,
    searchesRequested: batch.requestedCount,
    searchesExecuted: executable.length,
    searchesSaved: batch.savedCalls,
    creditsCharged,
    alertsCreated,
    emailsSent,
    errors,
  };
}

// ─── One watch, one cycle ────────────────────────────────────────────────────

interface RunCycleInput {
  db: SupabaseClient;
  job: WatchJob;
  plan: SearchPlan;
  outcomes: Map<string, SearchOutcome>;
  dispatchRunId: string | null;
  now: Date;
  sendEmails: boolean;
}

async function runCycleForWatch(input: RunCycleInput): Promise<CycleOutcome> {
  const { db, job, plan, outcomes, dispatchRunId, now } = input;
  const { watch } = job;
  const startedAt = now;
  const cycleId = await createCycle(db, job, dispatchRunId, now);
  const cycleLog = logger.child({ cycle_id: cycleId ?? undefined, watch_id: watch.id });

  const dated: DatedResult[] = [];
  const uncheckedDates: string[] = [];
  const failureKinds: string[] = [];
  let datesSucceeded = 0;
  let datesFailed = 0;
  let journeysReturned = 0;

  const snapshotIdByDate = new Map<string, string>();

  for (const search of plan.searches) {
    const outcome = outcomes.get(search.canonicalKey);
    if (!outcome) {
      datesFailed += 1;
      uncheckedDates.push(search.request.date);
      failureKinds.push('MISSING_RESULT');
      await insertSnapshot(db, {
        cycleId,
        watch,
        travelDate: search.request.date,
        displacementDays: search.searchDate.displacementDays,
        status: 'FAILED',
        errorKind: 'MISSING_RESULT',
        errorMessage: 'No provider result was produced for this date.',
        providerRequestId: null,
        journeysReturned: 0,
        eligibleCandidates: 0,
        rejectedSummary: {},
        cheapestTotalCents: null,
      });
      continue;
    }

    if (!outcome.ok) {
      datesFailed += 1;
      uncheckedDates.push(search.request.date);
      const providerError = outcome.error instanceof ProviderError ? outcome.error : null;
      failureKinds.push(providerError?.kind ?? 'NETWORK');
      await insertSnapshot(db, {
        cycleId,
        watch,
        travelDate: search.request.date,
        displacementDays: search.searchDate.displacementDays,
        status: 'FAILED',
        errorKind: providerError?.kind ?? 'NETWORK',
        errorMessage:
          outcome.error instanceof Error
            ? outcome.error.message.slice(0, 400)
            : String(outcome.error),
        providerRequestId: outcome.providerRequestId,
        journeysReturned: 0,
        eligibleCandidates: 0,
        rejectedSummary: {},
        cheapestTotalCents: null,
      });
      continue;
    }

    datesSucceeded += 1;
    journeysReturned += outcome.result.journeys.length;
    dated.push({ result: outcome.result, searchDate: search.searchDate });
  }

  // 1 of 3 dates failing is PARTIAL_SUCCESS - disclosed, never hidden.
  const status: CycleStatus =
    datesSucceeded === 0 ? 'FAILED' : datesFailed > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS';

  const eligibility = evaluateEligibility(watch, dated);
  const opportunityOutput = buildOpportunities({
    watch,
    benchmarkCents: watch.benchmarkCents,
    eligibility,
  });

  // Persist the successful dates now that we know each one's cheapest price.
  for (const { result, searchDate } of dated) {
    const forDate = eligibility.eligible.filter((c) => c.journey.travelDate === searchDate.date);
    const rejectedSummary: Record<string, number> = {};
    for (const r of eligibility.rejected) {
      rejectedSummary[r.reason] = (rejectedSummary[r.reason] ?? 0) + 1;
    }
    const snapshotId = await insertSnapshot(db, {
      cycleId,
      watch,
      travelDate: searchDate.date,
      displacementDays: searchDate.displacementDays,
      status: result.availability === 'NO_AVAILABILITY' ? 'NO_AVAILABILITY' : 'SUCCESS',
      errorKind: null,
      errorMessage: null,
      providerRequestId:
        outcomes.get(
          `${result.request.originCode}|${result.request.destinationCode}|${result.request.date}|${result.request.passengers}`,
        )?.providerRequestId ?? null,
      journeysReturned: result.journeys.length,
      eligibleCandidates: forDate.length,
      rejectedSummary,
      cheapestTotalCents: opportunityOutput.cheapestByDate.get(searchDate.date) ?? null,
    });
    if (snapshotId) snapshotIdByDate.set(searchDate.date, snapshotId);
  }

  // Persist ranked options so the UI, history and audit trail all agree.
  if (cycleId) {
    await persistOptions(db, watch, snapshotIdByDate, opportunityOutput.allRanked);
  }

  const best = opportunityOutput.opportunities[0] ?? null;

  const alert = await processAlert({
    db,
    watch,
    job,
    cycleId,
    cycleStatus: status,
    opportunities: opportunityOutput.opportunities,
    uncheckedDates,
    now,
    sendEmail: input.sendEmails,
  });

  await finishCycle(db, cycleId, {
    status,
    datesTotal: plan.searches.length,
    datesSucceeded,
    datesFailed,
    journeysReturned,
    eligibleCandidates: eligibility.eligible.length,
    qualifyingOptions: opportunityOutput.opportunities.length,
    bestTotalCents: opportunityOutput.bestTotalCents,
    bestSavingsCents: best ? best.savingsCents : null,
    alertSuppressedReason: alert?.suppressedReason ?? null,
    startedAt,
  });

  await updateWatchSummary(db, watch.id, {
    lastCheckedAt: now.toISOString(),
    lastCycleStatus: status,
    bestTotalCents: opportunityOutput.bestTotalCents,
  });

  // A route the provider will never accept must stop consuming credits three
  // times a day. Only permanently-bad input counts - a transient outage must not
  // pause a perfectly good watch.
  if (status === 'FAILED' && isPermanentlyUnroutable(failureKinds)) {
    await flagNeedsAttention(db, watch.id, failureKinds);
    cycleLog.warn('watch flagged NEEDS_ATTENTION', { kinds: [...new Set(failureKinds)] });
  }

  cycleLog.info('cycle complete', {
    status,
    dates_total: plan.searches.length,
    dates_succeeded: datesSucceeded,
    dates_failed: datesFailed,
    journeys_returned: journeysReturned,
    eligible: eligibility.eligible.length,
    qualifying: opportunityOutput.opportunities.length,
    best_total_cents: opportunityOutput.bestTotalCents,
    alert_reason: alert?.reason ?? null,
    alert_suppressed: alert?.suppressedReason ?? null,
  });

  return {
    watchId: watch.id,
    cycleId,
    status,
    datesTotal: plan.searches.length,
    datesSucceeded,
    datesFailed,
    bestTotalCents: opportunityOutput.bestTotalCents,
    qualifyingOptions: opportunityOutput.opportunities.length,
    alert,
    error: null,
  };
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

async function createCycle(
  db: SupabaseClient,
  job: WatchJob,
  dispatchRunId: string | null,
  now: Date,
): Promise<string | null> {
  // A manual check already inserted its cycle as the reservation; adopt it
  // rather than inserting a duplicate.
  if (job.reservedCycleId) {
    await db
      .from('fare_check_cycles')
      .update({ dispatch_run_id: dispatchRunId, started_at: now.toISOString() })
      .eq('id', job.reservedCycleId);
    return job.reservedCycleId;
  }

  // A reclaimed scheduled run already has a cycle from its first attempt;
  // cycles_scheduled_run_unique would reject a second insert and silently
  // return null, so reuse the existing row.
  if (job.scheduledRunId) {
    const { data: existing } = await db
      .from('fare_check_cycles')
      .select('id')
      .eq('scheduled_check_run_id', job.scheduledRunId)
      .maybeSingle();
    const priorId = (existing as { id: string } | null)?.id;
    if (priorId) {
      await db
        .from('fare_check_cycles')
        .update({
          status: 'RUNNING',
          dispatch_run_id: dispatchRunId,
          started_at: now.toISOString(),
        })
        .eq('id', priorId);
      return priorId;
    }
  }

  const { data, error } = await db
    .from('fare_check_cycles')
    .insert({
      watch_id: job.watch.id,
      user_id: job.watch.userId,
      scheduled_check_run_id: job.scheduledRunId,
      dispatch_run_id: dispatchRunId,
      trigger: job.trigger,
      status: 'RUNNING',
      benchmark_cents: job.watch.benchmarkCents,
      benchmark_version: job.watch.benchmarkVersion,
      started_at: now.toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    logger.error('failed to create cycle', { watch_id: job.watch.id, error: error.message });
    return null;
  }
  return (data as { id: string }).id;
}

interface FinishCycleInput {
  status: CycleStatus;
  datesTotal: number;
  datesSucceeded: number;
  datesFailed: number;
  journeysReturned: number;
  eligibleCandidates: number;
  qualifyingOptions: number;
  bestTotalCents: number | null;
  bestSavingsCents: number | null;
  alertSuppressedReason: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  startedAt: Date;
}

async function finishCycle(
  db: SupabaseClient,
  cycleId: string | null,
  input: FinishCycleInput,
): Promise<void> {
  if (!cycleId) return;
  const completedAt = new Date();
  const { error } = await db
    .from('fare_check_cycles')
    .update({
      status: input.status,
      dates_total: input.datesTotal,
      dates_succeeded: input.datesSucceeded,
      dates_failed: input.datesFailed,
      journeys_returned: input.journeysReturned,
      eligible_candidates: input.eligibleCandidates,
      qualifying_options: input.qualifyingOptions,
      best_total_cents: input.bestTotalCents,
      best_savings_cents: input.bestSavingsCents,
      alert_suppressed_reason: input.alertSuppressedReason,
      error_kind: input.errorKind ?? null,
      error_message: input.errorMessage ?? null,
      completed_at: completedAt.toISOString(),
      duration_ms: completedAt.getTime() - input.startedAt.getTime(),
    })
    .eq('id', cycleId);
  if (error) logger.error('failed to finish cycle', { cycle_id: cycleId, error: error.message });
}

interface SnapshotInput {
  cycleId: string | null;
  watch: Watch;
  travelDate: string;
  displacementDays: number;
  status: 'SUCCESS' | 'NO_AVAILABILITY' | 'FAILED';
  errorKind: string | null;
  errorMessage: string | null;
  providerRequestId: string | null;
  journeysReturned: number;
  eligibleCandidates: number;
  rejectedSummary: Record<string, number>;
  cheapestTotalCents: number | null;
}

async function insertSnapshot(db: SupabaseClient, input: SnapshotInput): Promise<string | null> {
  if (!input.cycleId) return null;
  const { data, error } = await db
    .from('fare_snapshots')
    .upsert(
      {
        cycle_id: input.cycleId,
        watch_id: input.watch.id,
        user_id: input.watch.userId,
        provider_request_id: input.providerRequestId,
        travel_date: input.travelDate,
        displacement_days: input.displacementDays,
        status: input.status,
        error_kind: input.errorKind,
        error_message: input.errorMessage,
        journeys_returned: input.journeysReturned,
        eligible_candidates: input.eligibleCandidates,
        rejected_summary: input.rejectedSummary,
        cheapest_total_cents: input.cheapestTotalCents,
      },
      { onConflict: 'cycle_id,travel_date' },
    )
    .select('id')
    .single();

  if (error) {
    logger.error('failed to insert snapshot', { error: error.message, date: input.travelDate });
    return null;
  }
  return (data as { id: string }).id;
}

async function persistOptions(
  db: SupabaseClient,
  watch: Watch,
  snapshotIdByDate: Map<string, string>,
  ranked: Opportunity[],
): Promise<void> {
  if (ranked.length === 0) return;

  // Group by journey so each itinerary is stored once with its fares.
  const byJourney = new Map<string, { snapshotId: string; opportunities: Opportunity[] }>();
  for (const opp of ranked) {
    const snapshotId = snapshotIdByDate.get(opp.candidate.journey.travelDate);
    if (!snapshotId) continue;
    const key = `${snapshotId}:${opp.candidate.journey.providerJourneyId}`;
    const existing = byJourney.get(key);
    if (existing) existing.opportunities.push(opp);
    else byJourney.set(key, { snapshotId, opportunities: [opp] });
  }
  if (byJourney.size === 0) return;

  const journeyRows = [...byJourney.entries()].map(([key, group]) => {
    const first = group.opportunities[0] as Opportunity;
    return {
      _key: key,
      snapshot_id: group.snapshotId,
      watch_id: watch.id,
      user_id: watch.userId,
      ...journeyToRow(first.candidate.journey),
    };
  });

  const { data: insertedJourneys, error: journeyError } = await db
    .from('journey_options')
    .insert(journeyRows.map(({ _key, ...row }) => row))
    .select('id, snapshot_id, provider_journey_id');

  if (journeyError || !insertedJourneys) {
    logger.error('failed to persist journey options', { error: journeyError?.message });
    return;
  }

  const journeyIdByKey = new Map<string, string>();
  for (const row of insertedJourneys as Array<{
    id: string;
    snapshot_id: string;
    provider_journey_id: string;
  }>) {
    journeyIdByKey.set(`${row.snapshot_id}:${row.provider_journey_id}`, row.id);
  }

  const fareRows: Array<Record<string, unknown>> = [];
  let rank = 1;
  for (const opp of ranked) {
    const snapshotId = snapshotIdByDate.get(opp.candidate.journey.travelDate);
    if (!snapshotId) continue;
    const journeyId = journeyIdByKey.get(
      `${snapshotId}:${opp.candidate.journey.providerJourneyId}`,
    );
    if (!journeyId) continue;
    const fare = opp.candidate.fare;
    const qualifying = opp.savingsCents >= watch.preferences.minimumSavingsCents;
    fareRows.push({
      journey_option_id: journeyId,
      snapshot_id: snapshotId,
      watch_id: watch.id,
      user_id: watch.userId,
      fare_family: fare.family,
      fare_family_raw: fare.familyRaw,
      travel_class: fare.travelClass,
      amount_cents: fare.amountCents,
      party_total_cents: fare.partyTotalCents,
      currency: fare.currency,
      pricing_basis: fare.pricingBasis,
      pricing_confidence: fare.pricingConfidence,
      availability: fare.availability,
      restricted: fare.restricted,
      refundable: fare.refundable,
      seats_remaining: fare.seatsRemaining,
      is_qualifying: qualifying,
      savings_cents: opp.savingsCents,
      displacement_days: opp.displacementDays,
      convenience_score: opp.convenienceScore,
      rank: qualifying ? rank++ : null,
      signature: opp.signature,
    });
  }

  if (fareRows.length > 0) {
    const { error } = await db.from('fare_options').insert(fareRows);
    if (error) logger.error('failed to persist fare options', { error: error.message });
  }
}

/** True when every date failed for a reason that retrying cannot fix. */
export function isPermanentlyUnroutable(kinds: string[]): boolean {
  if (kinds.length === 0) return false;
  const permanent = new Set(['STALE_INPUT', 'BAD_REQUEST', 'NOT_FOUND']);
  return kinds.every((kind) => permanent.has(kind));
}

async function flagNeedsAttention(
  db: SupabaseClient,
  watchId: string,
  kinds: string[],
): Promise<void> {
  const reason =
    kinds.includes('STALE_INPUT') || kinds.includes('NOT_FOUND')
      ? 'The fare provider does not recognise this route or date. Check the stations and try again.'
      : 'This trip could not be searched. Check the stations and dates.';

  const { error } = await db
    .from('watches')
    .update({ status: 'NEEDS_ATTENTION', status_reason: reason })
    .eq('id', watchId);
  if (error) logger.error('failed to flag watch', { watch_id: watchId, error: error.message });
}

async function updateWatchSummary(
  db: SupabaseClient,
  watchId: string,
  summary: { lastCheckedAt: string; lastCycleStatus: string; bestTotalCents: number | null },
): Promise<void> {
  const { error } = await db
    .from('watches')
    .update({
      last_checked_at: summary.lastCheckedAt,
      last_cycle_status: summary.lastCycleStatus,
      best_total_cents: summary.bestTotalCents,
    })
    .eq('id', watchId);
  if (error)
    logger.error('failed to update watch summary', { watch_id: watchId, error: error.message });
}

export { requestFromKey };
