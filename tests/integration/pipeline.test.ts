import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createTestDatabase, type TestDatabase } from '../helpers/pg';
import { createPgliteSupabase } from '@/lib/e2e/pglite-client';
import { DeterministicFareProvider } from '@/lib/providers/deterministic/test-provider';
import { runBatch, type WatchJob } from '@/lib/services/batch-runner';
import { runSingleWatchCycle } from '@/lib/services/dispatcher';
import { toWatch } from '@/lib/services/mappers';
import { rebookWatch } from '@/lib/services/watches';
import { resetServerEnvCache } from '@/lib/env';
import type { WatchRow } from '@/lib/db/types';

/**
 * End-to-end pipeline against REAL Postgres:
 *   watch -> planner -> provider -> normalizer -> eligibility -> ranking
 *         -> snapshot -> opportunity -> alert -> notification
 */

const NOW = new Date('2026-09-02T18:00:00.000Z'); // 14:00 in New York
const DESIRED = '2026-09-20';
const DATES = ['2026-09-19', '2026-09-20', '2026-09-21'];

let testDb: TestDatabase;
let db: SupabaseClient;
let userId: string;
let fetchMock: ReturnType<typeof vi.fn>;

function provider(options: { failDates?: string[]; emptyDates?: string[] } = {}) {
  return new DeterministicFareProvider({
    normalize: { pricingBasis: 'UNKNOWN', amountUnit: 'dollars' },
    failDates: new Set(options.failDates ?? []),
    emptyDates: new Set(options.emptyDates ?? []),
    latencyMs: 0,
  });
}

async function insertWatch(overrides: Record<string, unknown> = {}): Promise<WatchRow> {
  const values: Record<string, unknown> = {
    user_id: userId,
    origin_code: 'BOS',
    destination_code: 'NYP',
    desired_date: DESIRED,
    passengers: 1,
    benchmark_cents: 25000,
    monitoring_starts_at: '2026-09-02T00:00:00Z',
    monitoring_ends_at: '2026-09-06T00:00:00Z',
    timezone: 'America/New_York',
    ...overrides,
  };
  const keys = Object.keys(values);
  const rows = await testDb.sql<WatchRow>(
    `insert into watches (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
    Object.values(values),
  );
  return rows[0]!;
}

async function reload(watchId: string): Promise<WatchRow> {
  const rows = await testDb.sql<WatchRow>('select * from watches where id = $1', [watchId]);
  return rows[0]!;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createPgliteSupabase(testDb.pg);
  userId = await testDb.createUser('pipeline@test.local');
  await testDb.sql(`update profiles set email = 'pipeline@test.local' where id = $1`, [userId]);
}, 180_000);

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => {
  // Resend is configured in tests; stub the HTTP call so nothing leaves the box.
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ id: 'resend-message-id' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  resetServerEnvCache();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  // Keep each test independent without paying to rebuild the database.
  await testDb.sql('delete from watches');
  await testDb.sql('delete from provider_requests');
  await testDb.sql('delete from dispatch_runs');
});

describe('the vertical slice', () => {
  it('runs an initial cycle across D-1, D and D+1 and produces a ranked, alerted result', async () => {
    const watch = await insertWatch();

    const result = await runSingleWatchCycle(db, provider(), watch, 'INITIAL', NOW);

    // ── one cycle, three dates, one provider call per date ──────────────────
    expect(result.cycles).toHaveLength(1);
    const outcome = result.cycles[0]!;
    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.datesTotal).toBe(3);
    expect(outcome.datesSucceeded).toBe(3);
    expect(outcome.datesFailed).toBe(0);
    expect(result.searchesExecuted).toBe(3);

    const cycles = await testDb.sql<{ trigger: string; status: string; dates_total: number }>(
      'select trigger, status, dates_total from fare_check_cycles',
    );
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.trigger).toBe('INITIAL');
    expect(cycles[0]!.status).toBe('SUCCESS');

    // ── snapshots: exactly one per travel date ──────────────────────────────
    const snapshots = await testDb.sql<{
      travel_date: string;
      status: string;
      displacement_days: number;
    }>(
      'select travel_date::text, status, displacement_days from fare_snapshots order by travel_date',
    );
    expect(snapshots.map((s) => s.travel_date)).toEqual(DATES);
    expect(snapshots.map((s) => s.displacement_days)).toEqual([-1, 0, 1]);
    expect(snapshots.every((s) => s.status === 'SUCCESS')).toBe(true);

    // ── provider requests: exactly three, all recorded ──────────────────────
    const requests = await testDb.sql<{
      canonical_key: string;
      status: string;
      served_cycles: number;
    }>('select canonical_key, status, served_cycles from provider_requests order by canonical_key');
    expect(requests.map((r) => r.canonical_key)).toEqual(DATES.map((d) => `BOS|NYP|${d}|1`));
    expect(requests.every((r) => r.status === 'SUCCESS')).toBe(true);

    // ── normalized options persisted and ranked cheapest first ──────────────
    const options = await testDb.sql<{
      party_total_cents: number;
      rank: number;
      is_qualifying: boolean;
    }>(
      'select party_total_cents, rank, is_qualifying from fare_options where rank is not null order by rank',
    );
    expect(options.length).toBeGreaterThan(0);
    const prices = options.map((o) => o.party_total_cents);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(outcome.bestTotalCents).toBe(prices[0]);

    // Only rail is admitted by default; a Thruway bus must never be ranked.
    const serviceTypes = await testDb.sql<{ service_type: string }>(
      `select distinct j.service_type from journey_options j
         join fare_options f on f.journey_option_id = j.id
        where f.rank is not null`,
    );
    expect(serviceTypes.every((s) => s.service_type !== 'THRUWAY_BUS')).toBe(true);

    // ── alert + email ───────────────────────────────────────────────────────
    const alerts = await testDb.sql<{
      reason: string;
      savings_cents: number;
      best_total_cents: number;
    }>('select reason, savings_cents, best_total_cents from alerts');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.reason).toBe('FIRST_DROP');
    expect(alerts[0]!.savings_cents).toBe(25000 - alerts[0]!.best_total_cents);

    const deliveries = await testDb.sql<{
      status: string;
      recipient: string;
      provider_message_id: string;
    }>('select status, recipient, provider_message_id from notification_deliveries');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe('SENT');
    expect(deliveries[0]!.recipient).toBe('pipeline@test.local');
    expect(deliveries[0]!.provider_message_id).toBe('resend-message-id');

    // The send must carry an idempotency key derived from the delivery row.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();

    // ── the watch summary the dashboard reads ───────────────────────────────
    const updated = await reload(watch.id);
    expect(updated.last_cycle_status).toBe('SUCCESS');
    expect(updated.best_total_cents).toBe(outcome.bestTotalCents);
    expect(updated.last_alert_best_total_cents).toBe(alerts[0]!.best_total_cents);
  });

  it('respects a flexibility of 0 by searching one date only', async () => {
    const watch = await insertWatch({ date_flexibility_days: 0 });
    const result = await runSingleWatchCycle(db, provider(), watch, 'INITIAL', NOW);
    expect(result.searchesExecuted).toBe(1);
    expect(result.cycles[0]!.datesTotal).toBe(1);
  });

  it('does not alert when nothing beats the benchmark', async () => {
    const watch = await insertWatch({ benchmark_cents: 3000 }); // cheaper than any fare
    const result = await runSingleWatchCycle(db, provider(), watch, 'INITIAL', NOW);

    expect(result.cycles[0]!.status).toBe('SUCCESS');
    expect(result.cycles[0]!.qualifyingOptions).toBe(0);
    expect(await testDb.sql('select id from alerts')).toHaveLength(0);

    const [cycle] = await testDb.sql<{ alert_suppressed_reason: string }>(
      'select alert_suppressed_reason from fare_check_cycles',
    );
    expect(cycle!.alert_suppressed_reason).toBe('NO_QUALIFYING_OPPORTUNITY');
  });
});

describe('failure handling', () => {
  it('records PARTIAL_SUCCESS when one of three dates fails, and still ranks the rest', async () => {
    const watch = await insertWatch();
    const result = await runSingleWatchCycle(
      db,
      provider({ failDates: ['2026-09-21'] }),
      watch,
      'INITIAL',
      NOW,
    );

    const outcome = result.cycles[0]!;
    expect(outcome.status).toBe('PARTIAL_SUCCESS');
    expect(outcome.datesSucceeded).toBe(2);
    expect(outcome.datesFailed).toBe(1);

    const snapshots = await testDb.sql<{ travel_date: string; status: string; error_kind: string }>(
      'select travel_date::text, status, error_kind from fare_snapshots order by travel_date',
    );
    expect(snapshots.map((s) => s.status)).toEqual(['SUCCESS', 'SUCCESS', 'FAILED']);
    expect(snapshots[2]!.error_kind).toBe('UPSTREAM');

    // The surviving dates still produce a real, alertable result.
    expect(outcome.qualifyingOptions).toBeGreaterThan(0);
    const alerts = await testDb.sql<{ unchecked: string; cycle_status: string }>(
      `select array_to_string(unchecked_dates, ',') as unchecked, cycle_status from alerts`,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.cycle_status).toBe('PARTIAL_SUCCESS');
    // The email and UI must disclose exactly which date could not be checked.
    expect(alerts[0]!.unchecked).toBe('2026-09-21');
  });

  it('records FAILED and NEVER alerts when every date fails', async () => {
    const watch = await insertWatch();
    const result = await runSingleWatchCycle(
      db,
      provider({ failDates: DATES }),
      watch,
      'INITIAL',
      NOW,
    );

    expect(result.cycles[0]!.status).toBe('FAILED');
    expect(await testDb.sql('select id from alerts')).toHaveLength(0);

    // A total provider outage must never be recorded as "no cheaper fares".
    const snapshots = await testDb.sql<{ status: string }>('select status from fare_snapshots');
    expect(snapshots.every((s) => s.status === 'FAILED')).toBe(true);

    const requests = await testDb.sql<{ status: string; error_kind: string }>(
      'select status, error_kind from provider_requests',
    );
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.status === 'FAILED')).toBe(true);
  });

  it('treats genuine empty availability as success, not as an error', async () => {
    const watch = await insertWatch();
    const result = await runSingleWatchCycle(
      db,
      provider({ emptyDates: ['2026-09-19'] }),
      watch,
      'INITIAL',
      NOW,
    );

    expect(result.cycles[0]!.status).toBe('SUCCESS');
    expect(result.cycles[0]!.datesFailed).toBe(0);

    const [snapshot] = await testDb.sql<{ status: string; journeys_returned: number }>(
      `select status, journeys_returned from fare_snapshots where travel_date = '2026-09-19'`,
    );
    expect(snapshot!.status).toBe('NO_AVAILABILITY');
    expect(snapshot!.journeys_returned).toBe(0);
  });

  it('keeps the alert when email delivery fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'rate limited' }), { status: 429 })),
    );
    const watch = await insertWatch();
    await runSingleWatchCycle(db, provider(), watch, 'INITIAL', NOW);

    expect(await testDb.sql('select id from alerts')).toHaveLength(1);
    const [delivery] = await testDb.sql<{ status: string; attempt: number; error: string }>(
      'select status, attempt, error from notification_deliveries',
    );
    expect(delivery!.status).toBe('FAILED');
    expect(delivery!.attempt).toBe(1);
    expect(delivery!.error).toContain('rate limited');
  });

  it('skips a watch whose monitoring window closed before execution', async () => {
    const watch = await insertWatch({
      monitoring_starts_at: '2026-08-01T00:00:00Z',
      monitoring_ends_at: '2026-08-02T00:00:00Z',
    });
    const jobs: WatchJob[] = [
      { watch: toWatch(watch), trigger: 'MORNING', scheduledRunId: null, recipientEmail: null },
    ];
    const result = await runBatch(jobs, {
      db,
      provider: provider(),
      dispatchRunId: null,
      now: NOW,
    });

    expect(result.cycles[0]!.status).toBe('SKIPPED_EXPIRED');
    expect(result.searchesExecuted).toBe(0);
    expect(await testDb.sql('select id from provider_requests')).toHaveLength(0);
  });

  it('never searches a date that has already passed', async () => {
    const watch = await insertWatch({
      desired_date: '2026-09-02',
      monitoring_ends_at: '2026-09-03T00:00:00Z',
    });
    const result = await runSingleWatchCycle(db, provider(), watch, 'INITIAL', NOW);

    // D-1 (Sep 1) is in the past and must be dropped; Sep 2 and Sep 3 remain.
    expect(result.searchesExecuted).toBe(2);
    const snapshots = await testDb.sql<{ travel_date: string }>(
      'select travel_date::text from fare_snapshots order by travel_date',
    );
    expect(snapshots.map((s) => s.travel_date)).toEqual(['2026-09-02', '2026-09-03']);
  });
});

describe('cross-watch deduplication', () => {
  it('serves two overlapping travel windows with four calls, not six', async () => {
    const a = await insertWatch({ desired_date: '2026-09-20' }); // 19, 20, 21
    const b = await insertWatch({ desired_date: '2026-09-21' }); // 20, 21, 22

    const jobs: WatchJob[] = [a, b].map((row) => ({
      watch: toWatch(row),
      trigger: 'MORNING' as const,
      scheduledRunId: null,
      recipientEmail: 'pipeline@test.local',
    }));

    const result = await runBatch(jobs, {
      db,
      provider: provider(),
      dispatchRunId: null,
      now: NOW,
    });

    expect(result.searchesRequested).toBe(6);
    expect(result.searchesExecuted).toBe(4);
    expect(result.searchesSaved).toBe(2);

    const requests = await testDb.sql<{ canonical_key: string; served_cycles: number }>(
      'select canonical_key, served_cycles from provider_requests order by canonical_key',
    );
    expect(requests.map((r) => r.canonical_key)).toEqual([
      'BOS|NYP|2026-09-19|1',
      'BOS|NYP|2026-09-20|1',
      'BOS|NYP|2026-09-21|1',
      'BOS|NYP|2026-09-22|1',
    ]);
    // The two shared dates each served two cycles.
    expect(requests.map((r) => r.served_cycles)).toEqual([1, 2, 2, 1]);

    // Both watches still get a complete, independent cycle.
    expect(result.cycles).toHaveLength(2);
    expect(result.cycles.every((c) => c.status === 'SUCCESS' && c.datesTotal === 3)).toBe(true);

    const snapshots = await testDb.sql<{ count: string }>(
      'select count(*)::text as count from fare_snapshots',
    );
    expect(Number(snapshots[0]!.count)).toBe(6);
  });

  it('does not deduplicate across different passenger counts', async () => {
    const a = await insertWatch({ passengers: 1 });
    const b = await insertWatch({ passengers: 2, benchmark_cents: 50000 });

    const jobs: WatchJob[] = [a, b].map((row) => ({
      watch: toWatch(row),
      trigger: 'MORNING' as const,
      scheduledRunId: null,
      recipientEmail: null,
    }));
    const result = await runBatch(jobs, {
      db,
      provider: provider(),
      dispatchRunId: null,
      now: NOW,
    });
    expect(result.searchesExecuted).toBe(6);
    expect(result.searchesSaved).toBe(0);
  });

  it('refuses to alert a multi-passenger watch while party pricing is unverified', async () => {
    const watch = await insertWatch({ passengers: 2, benchmark_cents: 60000 });
    const result = await runSingleWatchCycle(db, provider(), watch, 'INITIAL', NOW);

    expect(result.cycles[0]!.status).toBe('SUCCESS');
    expect(result.cycles[0]!.qualifyingOptions).toBeGreaterThan(0);
    expect(await testDb.sql('select id from alerts')).toHaveLength(0);

    const [cycle] = await testDb.sql<{ alert_suppressed_reason: string }>(
      'select alert_suppressed_reason from fare_check_cycles',
    );
    expect(cycle!.alert_suppressed_reason).toBe('AMBIGUOUS_PARTY_PRICING');

    // The options are still shown to the user, badged as unverified.
    const [fare] = await testDb.sql<{ pricing_confidence: string }>(
      'select pricing_confidence from fare_options limit 1',
    );
    expect(fare!.pricing_confidence).toBe('AMBIGUOUS');
  });
});

describe('alert de-duplication', () => {
  it('does not send a second identical email when the same cycle runs again', async () => {
    const watch = await insertWatch();
    await runSingleWatchCycle(db, provider(), watch, 'INITIAL', NOW);
    expect(await testDb.sql('select id from alerts')).toHaveLength(1);

    const refreshed = await reload(watch.id);
    await runSingleWatchCycle(db, provider(), refreshed, 'MANUAL', NOW);

    // Same options, same price: one alert, one email, ever.
    expect(await testDb.sql('select id from alerts')).toHaveLength(1);
    expect(await testDb.sql('select id from notification_deliveries')).toHaveLength(1);

    const cycles = await testDb.sql<{ trigger: string }>(
      'select trigger from fare_check_cycles order by started_at',
    );
    expect(cycles.map((c) => c.trigger)).toEqual(['INITIAL', 'MANUAL']);
  });
});

describe('rebooking', () => {
  it('replaces the benchmark, preserves history, and keeps monitoring', async () => {
    const watch = await insertWatch();
    await runSingleWatchCycle(db, provider(), watch, 'INITIAL', NOW);
    const afterFirst = await reload(watch.id);
    expect(afterFirst.last_alert_best_total_cents).not.toBeNull();

    await testDb.sql(
      `insert into booking_price_events (watch_id, user_id, event_type, amount_cents, benchmark_version)
       values ($1, $2, 'INITIAL_PURCHASE', 25000, 1)`,
      [watch.id, userId],
    );

    const updated = await rebookWatch(db, afterFirst, { amountPaid: 9000 }, NOW);

    expect(updated.benchmark_cents).toBe(9000);
    expect(updated.benchmark_version).toBe(2);
    expect(updated.status).toBe('ACTIVE');
    // Alert state is reset: old alerts say nothing about the new benchmark.
    expect(updated.last_alert_best_total_cents).toBeNull();
    expect(updated.last_alert_signature).toBeNull();

    // History is append-only and the original purchase is untouched.
    const events = await testDb.sql<{
      event_type: string;
      amount_cents: number;
      benchmark_version: number;
    }>(
      'select event_type, amount_cents, benchmark_version from booking_price_events order by created_at',
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event_type: 'INITIAL_PURCHASE',
      amount_cents: 25000,
      benchmark_version: 1,
    });
    expect(events[1]).toMatchObject({
      event_type: 'REBOOKED',
      amount_cents: 9000,
      benchmark_version: 2,
    });

    // Monitoring continues against the new, much lower benchmark.
    const next = await runSingleWatchCycle(db, provider(), updated, 'MANUAL', NOW);
    expect(next.cycles[0]!.status).toBe('SUCCESS');
  });

  it('completes the watch when rebooking happens after the window closed', async () => {
    const watch = await insertWatch({
      monitoring_starts_at: '2026-08-01T00:00:00Z',
      monitoring_ends_at: '2026-08-05T00:00:00Z',
    });
    const updated = await rebookWatch(db, watch, { amountPaid: 9000 }, NOW);
    expect(updated.status).toBe('COMPLETED');
  });
});

describe('credit budget', () => {
  it('hard-stops before making any provider call once the budget is exhausted', async () => {
    process.env.PROVIDER_MONTHLY_CREDIT_BUDGET = '4';
    resetServerEnvCache();

    try {
      // Burn the budget with recorded historical spend.
      await testDb.sql(
        `insert into provider_requests (provider_id, canonical_key, origin_code, destination_code,
           travel_date, passengers, status, credits_charged)
         values ('parse','x','BOS','NYP','2026-09-20',1,'SUCCESS',4)`,
      );

      const watch = await insertWatch();
      const result = await runSingleWatchCycle(db, provider(), watch, 'INITIAL', NOW);

      expect(result.cycles[0]!.status).toBe('SKIPPED_BUDGET');
      expect(result.searchesExecuted).toBe(0);

      const requests = await testDb.sql('select id from provider_requests');
      expect(requests).toHaveLength(1); // only the pre-seeded row
      expect(await testDb.sql('select id from alerts')).toHaveLength(0);
    } finally {
      delete process.env.PROVIDER_MONTHLY_CREDIT_BUDGET;
      resetServerEnvCache();
    }
  });
});

describe('permanently unroutable trips', () => {
  it('flags the watch NEEDS_ATTENTION when the provider rejects every date as bad input', async () => {
    const watch = await insertWatch();
    const badInput = new DeterministicFareProvider({
      normalize: { pricingBasis: 'UNKNOWN', amountUnit: 'dollars' },
      failDates: new Set(DATES),
      failKind: 'STALE_INPUT',
      latencyMs: 0,
    });

    const result = await runSingleWatchCycle(db, badInput, watch, 'INITIAL', NOW);
    expect(result.cycles[0]!.status).toBe('FAILED');

    const updated = await reload(watch.id);
    expect(updated.status).toBe('NEEDS_ATTENTION');
    expect(updated.status_reason).toContain('does not recognise this route');

    // A paused watch stops consuming provider credits on the next dispatch.
    const after = await runBatch(
      [{ watch: toWatch(updated), trigger: 'MORNING', scheduledRunId: null, recipientEmail: null }],
      { db, provider: badInput, dispatchRunId: null, now: NOW },
    );
    expect(after.cycles[0]!.status).toBe('SKIPPED_EXPIRED');
    expect(after.searchesExecuted).toBe(0);
  });

  it('does NOT flag a watch for a transient outage', async () => {
    const watch = await insertWatch();
    const outage = new DeterministicFareProvider({
      normalize: { pricingBasis: 'UNKNOWN', amountUnit: 'dollars' },
      failDates: new Set(DATES),
      failKind: 'UPSTREAM',
      latencyMs: 0,
    });

    const result = await runSingleWatchCycle(db, outage, watch, 'INITIAL', NOW);
    expect(result.cycles[0]!.status).toBe('FAILED');

    // A provider outage is not the user's problem; the watch stays active.
    const updated = await reload(watch.id);
    expect(updated.status).toBe('ACTIVE');
    expect(updated.status_reason).toBeNull();
  });
});
