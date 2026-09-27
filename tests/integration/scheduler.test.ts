import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createTestDatabase, pgErrorCode, type TestDatabase } from '../helpers/pg';
import { createPgliteSupabase } from '@/lib/e2e/pglite-client';
import { DeterministicFareProvider } from '@/lib/providers/deterministic/test-provider';
import { runDispatch } from '@/lib/services/dispatcher';
import type { WatchRow } from '@/lib/db/types';

/**
 * The scheduler's central promise: at-least-once cron delivery must produce
 * effectively-once execution. These tests attack that with real Postgres
 * concurrency primitives.
 */

let testDb: TestDatabase;
let db: SupabaseClient;
let userId: string;

// 14:05 in New York -> the AFTERNOON slot is due, MORNING is overdue.
const AFTERNOON = new Date('2026-09-02T18:05:00.000Z');
const MORNING = new Date('2026-09-02T12:10:00.000Z');

function provider() {
  return new DeterministicFareProvider({
    normalize: { pricingBasis: 'UNKNOWN', amountUnit: 'dollars' },
    latencyMs: 0,
  });
}

async function insertWatch(overrides: Record<string, unknown> = {}): Promise<WatchRow> {
  const values: Record<string, unknown> = {
    user_id: userId,
    origin_code: 'BOS',
    destination_code: 'NYP',
    desired_date: '2026-09-20',
    benchmark_cents: 25000,
    monitoring_starts_at: '2026-09-01T00:00:00Z',
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

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createPgliteSupabase(testDb.pg);
  userId = await testDb.createUser('scheduler@test.local');
}, 180_000);

afterAll(async () => {
  await testDb?.close();
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ id: 'msg' }), { status: 200 })),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await testDb.sql('delete from watches');
  await testDb.sql('delete from dispatch_runs');
  await testDb.sql('delete from provider_requests');
});

describe('dispatcher mutex (the unique hour bucket)', () => {
  it('gives the hour to exactly one worker', async () => {
    const first = await db.rpc('begin_dispatch', {
      p_bucket: AFTERNOON.toISOString(),
      p_lease_minutes: 15,
      p_source: 'CRON',
    });
    const second = await db.rpc('begin_dispatch', {
      p_bucket: AFTERNOON.toISOString(),
      p_lease_minutes: 15,
      p_source: 'VERCEL',
    });

    expect(first.data).toBeTruthy();
    expect(second.data).toBeNull(); // the redundant trigger is a correct no-op

    const rows = await testDb.sql('select id from dispatch_runs');
    expect(rows).toHaveLength(1);
  });

  it('lets a later hour proceed independently', async () => {
    await db.rpc('begin_dispatch', { p_bucket: AFTERNOON.toISOString(), p_lease_minutes: 15 });
    const next = await db.rpc('begin_dispatch', {
      p_bucket: new Date(AFTERNOON.getTime() + 3_600_000).toISOString(),
      p_lease_minutes: 15,
    });
    expect(next.data).toBeTruthy();
  });

  it('takes over an abandoned lease, but only after it expires', async () => {
    await db.rpc('begin_dispatch', { p_bucket: AFTERNOON.toISOString(), p_lease_minutes: 15 });

    // Still within the lease: no takeover.
    const blocked = await db.rpc('begin_dispatch', {
      p_bucket: AFTERNOON.toISOString(),
      p_lease_minutes: 15,
    });
    expect(blocked.data).toBeNull();

    // Simulate a worker that died 20 minutes ago.
    await testDb.sql(`update dispatch_runs set leased_at = now() - interval '20 minutes'`);
    const takeover = await db.rpc('begin_dispatch', {
      p_bucket: AFTERNOON.toISOString(),
      p_lease_minutes: 15,
    });
    expect(takeover.data).toBeTruthy();
  });
});

describe('slot claims', () => {
  it('is the exactly-once claim: a second claim of the same slot returns nothing', async () => {
    const watch = await insertWatch();

    const first = await db.rpc('claim_check_slot', {
      p_watch_id: watch.id,
      p_user_id: userId,
      p_local_date: '2026-09-02',
      p_slot: 'AFTERNOON',
    });
    const second = await db.rpc('claim_check_slot', {
      p_watch_id: watch.id,
      p_user_id: userId,
      p_local_date: '2026-09-02',
      p_slot: 'AFTERNOON',
    });

    expect(first.data).toBeTruthy();
    expect(second.data).toBeNull();
    expect(await testDb.sql('select id from scheduled_check_runs')).toHaveLength(1);
  });

  it('enforces uniqueness at the database level, not just in application code', async () => {
    const watch = await insertWatch();
    await testDb.sql(
      `insert into scheduled_check_runs (watch_id, user_id, local_date, check_slot)
       values ($1, $2, '2026-09-02', 'MORNING')`,
      [watch.id, userId],
    );
    try {
      await testDb.sql(
        `insert into scheduled_check_runs (watch_id, user_id, local_date, check_slot)
         values ($1, $2, '2026-09-02', 'MORNING')`,
        [watch.id, userId],
      );
      throw new Error('expected a unique violation');
    } catch (error) {
      expect(pgErrorCode(error)).toBe('23505');
    }
  });

  it('allows different slots and different days for the same watch', async () => {
    const watch = await insertWatch();
    for (const [date, slot] of [
      ['2026-09-02', 'MORNING'],
      ['2026-09-02', 'AFTERNOON'],
      ['2026-09-02', 'EVENING'],
      ['2026-09-03', 'MORNING'],
    ] as const) {
      const result = await db.rpc('claim_check_slot', {
        p_watch_id: watch.id,
        p_user_id: userId,
        p_local_date: date,
        p_slot: slot,
      });
      expect(result.data).toBeTruthy();
    }
    expect(await testDb.sql('select id from scheduled_check_runs')).toHaveLength(4);
  });
});

describe('run leases', () => {
  it('leases a pending run once and refuses a second lease', async () => {
    const watch = await insertWatch();
    const claim = await db.rpc('claim_check_slot', {
      p_watch_id: watch.id,
      p_user_id: userId,
      p_local_date: '2026-09-02',
      p_slot: 'AFTERNOON',
    });
    const runId = String(claim.data);

    const first = await db.rpc('lease_check_runs', { p_ids: [runId], p_lease_minutes: 15 });
    expect((first.data as unknown[]).length).toBe(1);

    // The row is now RUNNING with a fresh lease, so a racing worker gets nothing.
    const second = await db.rpc('lease_check_runs', { p_ids: [runId], p_lease_minutes: 15 });
    expect((second.data as unknown[]).length).toBe(0);
  });

  it('reclaims a run abandoned by a dead worker', async () => {
    const watch = await insertWatch();
    const claim = await db.rpc('claim_check_slot', {
      p_watch_id: watch.id,
      p_user_id: userId,
      p_local_date: '2026-09-02',
      p_slot: 'AFTERNOON',
    });
    const runId = String(claim.data);

    await db.rpc('lease_check_runs', { p_ids: [runId], p_lease_minutes: 15 });
    await testDb.sql(`update scheduled_check_runs set leased_at = now() - interval '30 minutes'`);

    const reclaimed = await db.rpc('lease_check_runs', { p_ids: [runId], p_lease_minutes: 15 });
    expect((reclaimed.data as unknown[]).length).toBe(1);

    const [row] = await testDb.sql<{ attempt: number }>('select attempt from scheduled_check_runs');
    expect(row!.attempt).toBe(2);
  });

  it('stops retrying a run after three attempts', async () => {
    const watch = await insertWatch();
    const claim = await db.rpc('claim_check_slot', {
      p_watch_id: watch.id,
      p_user_id: userId,
      p_local_date: '2026-09-02',
      p_slot: 'AFTERNOON',
    });
    const runId = String(claim.data);

    await testDb.sql(
      `update scheduled_check_runs set attempt = 3, status = 'RUNNING', leased_at = now() - interval '1 hour'`,
    );
    const result = await db.rpc('lease_check_runs', { p_ids: [runId], p_lease_minutes: 15 });
    expect((result.data as unknown[]).length).toBe(0);
  });
});

describe('runDispatch end to end', () => {
  it('claims the due slot, runs one cycle, and makes three provider calls', async () => {
    await insertWatch();

    const result = await runDispatch({ db, provider: provider(), now: AFTERNOON, source: 'TEST' });

    expect(result.owned).toBe(true);
    expect(result.watchesConsidered).toBe(1);
    expect(result.runsClaimed).toBe(1);
    expect(result.batch?.searchesExecuted).toBe(3);

    const runs = await testDb.sql<{ check_slot: string; status: string; attempt: number }>(
      'select check_slot, status, attempt from scheduled_check_runs order by check_slot',
    );
    // AFTERNOON is executed; the overdue MORNING slot is recorded as skipped
    // rather than triggering a second cycle and three more provider calls.
    expect(runs.map((r) => [r.check_slot, r.status])).toEqual([
      ['AFTERNOON', 'DONE'],
      ['MORNING', 'SKIPPED'],
    ]);

    const cycles = await testDb.sql<{ trigger: string; status: string }>(
      'select trigger, status from fare_check_cycles',
    );
    expect(cycles).toEqual([{ trigger: 'AFTERNOON', status: 'SUCCESS' }]);
  });

  it('is a no-op when a duplicate cron fires in the same hour', async () => {
    await insertWatch();

    const first = await runDispatch({
      db,
      provider: provider(),
      now: AFTERNOON,
      source: 'PG_CRON',
    });
    const second = await runDispatch({
      db,
      provider: provider(),
      now: new Date(AFTERNOON.getTime() + 60_000),
      source: 'VERCEL',
    });

    expect(first.owned).toBe(true);
    expect(second.owned).toBe(false);
    expect(second.batch).toBeNull();

    // Exactly one cycle and three provider calls in total — no double spend.
    expect(await testDb.sql('select id from fare_check_cycles')).toHaveLength(1);
    expect(await testDb.sql('select id from provider_requests')).toHaveLength(3);
  });

  it('does not re-run a slot it already completed in an earlier hour', async () => {
    await insertWatch();

    await runDispatch({ db, provider: provider(), now: AFTERNOON, source: 'CRON' });
    // An hour later: still the AFTERNOON slot, already claimed and done.
    const later = await runDispatch({
      db,
      provider: provider(),
      now: new Date(AFTERNOON.getTime() + 3_600_000),
      source: 'CRON',
    });

    expect(later.owned).toBe(true);
    expect(later.runsClaimed).toBe(0);
    expect(await testDb.sql('select id from provider_requests')).toHaveLength(3);
  });

  it('claims the morning slot in the morning', async () => {
    await insertWatch();
    const result = await runDispatch({ db, provider: provider(), now: MORNING, source: 'CRON' });

    expect(result.runsClaimed).toBe(1);
    const [cycle] = await testDb.sql<{ trigger: string }>('select trigger from fare_check_cycles');
    expect(cycle!.trigger).toBe('MORNING');
    // Nothing is overdue at 08:10, so nothing is skipped.
    expect(result.slotsSkipped).toBe(0);
  });

  it('claims each watch its own slot in its own timezone', async () => {
    // 18:05 UTC is 14:05 in New York (AFTERNOON due) and 11:05 in Los Angeles
    // (only MORNING due).
    await insertWatch({ timezone: 'America/New_York' });
    await insertWatch({ timezone: 'America/Los_Angeles', desired_date: '2026-09-22' });

    await runDispatch({ db, provider: provider(), now: AFTERNOON, source: 'CRON' });

    const cycles = await testDb.sql<{ trigger: string }>(
      'select trigger from fare_check_cycles order by trigger',
    );
    expect(cycles.map((c) => c.trigger).sort()).toEqual(['AFTERNOON', 'MORNING']);
  });

  it('ignores paused watches and watches outside their monitoring window', async () => {
    await insertWatch({ status: 'PAUSED' });
    await insertWatch({
      desired_date: '2026-09-25',
      monitoring_starts_at: '2026-08-01T00:00:00Z',
      monitoring_ends_at: '2026-08-02T00:00:00Z',
    });

    const result = await runDispatch({ db, provider: provider(), now: AFTERNOON, source: 'CRON' });
    expect(result.watchesConsidered).toBe(0);
    expect(result.runsClaimed).toBe(0);
    expect(await testDb.sql('select id from provider_requests')).toHaveLength(0);
  });

  it('records dispatch metrics, including deduplication savings', async () => {
    await insertWatch({ desired_date: '2026-09-20' }); // 19, 20, 21
    await insertWatch({ desired_date: '2026-09-21' }); // 20, 21, 22

    await runDispatch({ db, provider: provider(), now: AFTERNOON, source: 'CRON' });

    const [row] = await testDb.sql<{
      status: string;
      runs_claimed: number;
      searches_requested: number;
      searches_executed: number;
      searches_saved: number;
      alerts_created: number;
      errors: number;
    }>(
      `select status, runs_claimed, searches_requested, searches_executed, searches_saved,
              alerts_created, errors from dispatch_runs`,
    );
    expect(row!.status).toBe('DONE');
    expect(row!.runs_claimed).toBe(2);
    expect(row!.searches_requested).toBe(6);
    expect(row!.searches_executed).toBe(4);
    expect(row!.searches_saved).toBe(2);
    expect(row!.errors).toBe(0);
    expect(row!.alerts_created).toBe(2);
  });
});

describe('recovery from a worker killed mid-dispatch', () => {
  it('reclaims a run stranded in RUNNING and completes the check', async () => {
    const watch = await insertWatch();

    // A dispatch claims and leases the afternoon slot, then the function is
    // killed before completing it.
    const claim = await db.rpc('claim_check_slot', {
      p_watch_id: watch.id,
      p_user_id: userId,
      p_local_date: '2026-09-02',
      p_slot: 'AFTERNOON',
    });
    await db.rpc('lease_check_runs', { p_ids: [String(claim.data)], p_lease_minutes: 15 });
    await testDb.sql(`update scheduled_check_runs set leased_at = now() - interval '40 minutes'`);

    // Before the fix this slot was lost forever: the next heartbeat saw the row
    // EXISTS and refused to re-claim it, so the check never ran and nothing
    // surfaced anywhere.
    const result = await runDispatch({ db, provider: provider(), now: AFTERNOON, source: 'CRON' });

    expect(result.reclaimedRuns).toBe(1);
    expect(result.batch?.searchesExecuted).toBe(3);

    const [run] = await testDb.sql<{ status: string; attempt: number }>(
      `select status, attempt from scheduled_check_runs where check_slot = 'AFTERNOON'`,
    );
    expect(run!.status).toBe('DONE');
    expect(run!.attempt).toBe(2);

    const cycles = await testDb.sql<{ status: string }>('select status from fare_check_cycles');
    expect(cycles).toHaveLength(1); // reused, not duplicated
    expect(cycles[0]!.status).toBe('SUCCESS');
  });

  it('does not reclaim a run whose lease is still valid', async () => {
    const watch = await insertWatch();
    const claim = await db.rpc('claim_check_slot', {
      p_watch_id: watch.id,
      p_user_id: userId,
      p_local_date: '2026-09-02',
      p_slot: 'AFTERNOON',
    });
    await db.rpc('lease_check_runs', { p_ids: [String(claim.data)], p_lease_minutes: 15 });

    const result = await runDispatch({ db, provider: provider(), now: AFTERNOON, source: 'CRON' });
    expect(result.reclaimedRuns).toBe(0);
    expect(result.batch?.searchesExecuted ?? 0).toBe(0);
  });

  it('gives up on a run after three attempts instead of looping forever', async () => {
    const watch = await insertWatch();
    await testDb.sql(
      `insert into scheduled_check_runs (watch_id, user_id, local_date, check_slot, status, attempt, leased_at)
       values ($1, $2, '2026-09-02', 'AFTERNOON', 'RUNNING', 3, now() - interval '2 hours')`,
      [watch.id, userId],
    );
    const result = await runDispatch({ db, provider: provider(), now: AFTERNOON, source: 'CRON' });
    expect(result.reclaimedRuns).toBe(0);
  });

  it('defers work rather than being killed mid-batch when the deadline is near', async () => {
    for (let i = 0; i < 4; i += 1) {
      await insertWatch({ desired_date: `2026-09-2${i}` });
    }
    // A deadline that has effectively already passed leaves capacity for one run.
    const result = await runDispatch({
      db,
      provider: provider(),
      now: AFTERNOON,
      source: 'CRON',
      deadlineMs: 1,
    });

    expect(result.runsClaimed).toBe(1);
    expect(result.deferredRuns).toBe(3);

    // Deferred runs go back to PENDING so the next heartbeat picks them up
    // rather than losing them.
    const pending = await testDb.sql<{ count: string }>(
      `select count(*)::text as count from scheduled_check_runs where status = 'PENDING'`,
    );
    expect(Number(pending[0]!.count)).toBe(3);
  });
});

describe('manual check reservation', () => {
  it('lets exactly one of two concurrent claims through', async () => {
    const watch = await insertWatch();
    const args = {
      p_watch_id: watch.id,
      p_user_id: userId,
      p_benchmark_cents: 25000,
      p_benchmark_version: 1,
      p_cooldown_minutes: 15,
    };

    // Before the fix these were a read and, an entire provider round-trip later,
    // the write it was guarding — so a double-click charged the provider twice
    // and could send two alert emails.
    const [a, b] = await Promise.all([
      db.rpc('claim_manual_check', args),
      db.rpc('claim_manual_check', args),
    ]);

    const winners = [a.data, b.data].filter(Boolean);
    expect(winners).toHaveLength(1);

    const cycles = await testDb.sql(`select id from fare_check_cycles where trigger = 'MANUAL'`);
    expect(cycles).toHaveLength(1);
  });

  it('refuses a second claim inside the cooldown and allows one after it', async () => {
    const watch = await insertWatch();
    const args = {
      p_watch_id: watch.id,
      p_user_id: userId,
      p_benchmark_cents: 25000,
      p_benchmark_version: 1,
      p_cooldown_minutes: 15,
    };

    expect((await db.rpc('claim_manual_check', args)).data).toBeTruthy();
    expect((await db.rpc('claim_manual_check', args)).data).toBeNull();

    await testDb.sql(`update fare_check_cycles set started_at = now() - interval '20 minutes'`);
    expect((await db.rpc('claim_manual_check', args)).data).toBeTruthy();
  });
});

describe('credit budget accounting', () => {
  it('stays exact past the PostgREST row cap, so the hard stop can actually fire', async () => {
    // Summing rows client-side silently truncated at max-rows (1000 by default),
    // freezing the total and disabling the only ceiling on marketplace spend.
    await testDb.sql(
      `insert into provider_requests
         (provider_id, canonical_key, origin_code, destination_code, travel_date, passengers, status, credits_charged)
       select 'parse', 'k' || g, 'BOS', 'NYP', '2026-09-20', 1, 'SUCCESS', 2
         from generate_series(1, 1200) g`,
    );

    const { getUsageSummary } = await import('@/lib/services/usage');
    const usage = await getUsageSummary(db);

    expect(usage.requests).toBe(1200);
    expect(usage.creditsUsed).toBe(2400); // exact, not capped at 1000 rows
  });
});
