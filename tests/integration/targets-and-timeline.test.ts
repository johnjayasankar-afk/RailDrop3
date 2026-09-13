import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTimeline } from '@/lib/queries';
import type { CycleRow } from '@/lib/db/types';
import { createTestDatabase, pgErrorCode, type TestDatabase } from '../helpers/pg';

let db: TestDatabase;
let alice: string;
let bob: string;

async function seedWatch(userId: string): Promise<string> {
  const rows = await db.sql<{ id: string }>(
    `insert into watches (user_id, origin_code, destination_code, desired_date, benchmark_cents, monitoring_ends_at)
     values ($1, 'BOS', 'NYP', current_date + 3, 12800, now() + interval '2 days')
     returning id`,
    [userId],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await db.createUser('alice@test.local');
  bob = await db.createUser('bob@test.local');
});

afterAll(async () => {
  await db?.close();
});

describe('target price', () => {
  it('must be below the benchmark, enforced by the database and not just the form', async () => {
    const watchId = await seedWatch(alice);

    await expect(
      db.sql('update watches set target_price_cents = 12800 where id = $1', [watchId]),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23514');

    await expect(
      db.sql('update watches set target_price_cents = 0 where id = $1', [watchId]),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23514');

    await db.sql('update watches set target_price_cents = 8000 where id = $1', [watchId]);
    const [row] = await db.sql<{ target_price_cents: number }>(
      'select target_price_cents from watches where id = $1',
      [watchId],
    );
    expect(row!.target_price_cents).toBe(8000);
  });

  it('is null by default, so an untargeted trip behaves exactly as before', async () => {
    const watchId = await seedWatch(alice);
    const [row] = await db.sql<{ target_price_cents: number | null }>(
      'select target_price_cents from watches where id = $1',
      [watchId],
    );
    expect(row!.target_price_cents).toBeNull();
  });

  it('accepts TARGET_REACHED as an alert reason, and still rejects an unknown one', async () => {
    const watchId = await seedWatch(alice);
    const cycle = await db.sql<{ id: string }>(
      `insert into fare_check_cycles (watch_id, user_id, trigger, status, benchmark_cents, benchmark_version)
       values ($1, $2, 'MORNING', 'SUCCESS', 12800, 1) returning id`,
      [watchId, alice],
    );

    const insert = (reason: string, key: string) =>
      db.sql(
        `insert into alerts (watch_id, user_id, cycle_id, reason, dedupe_key, benchmark_cents,
                             best_total_cents, savings_cents, best_signature, cycle_status)
         values ($1, $2, $3, $4, $5, 12800, 7400, 5400, 'sig', 'SUCCESS')`,
        [watchId, alice, cycle[0]!.id, reason, key],
      );

    await expect(insert('TARGET_REACHED', 'k1')).resolves.toBeDefined();
    await expect(insert('SOMETHING_ELSE', 'k2')).rejects.toSatisfy(
      (e: unknown) => pgErrorCode(e) === '23514',
    );
  });
});

describe('watch events', () => {
  it('are private to their owner', async () => {
    const watchId = await seedWatch(alice);
    await db.asUser(
      alice,
      `insert into watch_events (watch_id, user_id, kind, detail)
       values ($1, $2, 'CREATED', '{"benchmarkCents": 12800}'::jsonb)`,
      [watchId, alice],
    );

    const own = await db.asUser<{ kind: string }>(alice, 'select kind from watch_events');
    expect(own.map((r) => r.kind)).toEqual(['CREATED']);

    const theirs = await db.asUser(bob, 'select kind from watch_events');
    expect(theirs).toEqual([]);
  });

  it('cannot be written on behalf of somebody else', async () => {
    const watchId = await seedWatch(alice);
    await expect(
      db.asUser(
        bob,
        `insert into watch_events (watch_id, user_id, kind) values ($1, $2, 'DELETED')`,
        [watchId, alice],
      ),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '42501');
  });

  it('are append-only — a user cannot rewrite or erase their own history', async () => {
    const watchId = await seedWatch(alice);
    await db.asUser(
      alice,
      `insert into watch_events (watch_id, user_id, kind) values ($1, $2, 'REBOOKED')`,
      [watchId, alice],
    );

    // No update or delete policy exists, and no grant either. A timeline the
    // user could edit would not be worth showing them.
    await expect(
      db.asUser(alice, `update watch_events set kind = 'CREATED' where watch_id = $1`, [watchId]),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '42501');
    await expect(
      db.asUser(alice, 'delete from watch_events where watch_id = $1', [watchId]),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '42501');
  });

  it('rejects an unknown event kind', async () => {
    const watchId = await seedWatch(alice);
    await expect(
      db.sql(`insert into watch_events (watch_id, user_id, kind) values ($1, $2, 'HACKED')`, [
        watchId,
        alice,
      ]),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23514');
  });

  it('disappears with the watch it belongs to, so retention needs no extra sweep', async () => {
    const watchId = await seedWatch(bob);
    await db.sql(`insert into watch_events (watch_id, user_id, kind) values ($1, $2, 'CREATED')`, [
      watchId,
      bob,
    ]);
    await db.sql('delete from watches where id = $1', [watchId]);
    const left = await db.sql('select id from watch_events where watch_id = $1', [watchId]);
    expect(left).toEqual([]);
  });
});

describe('benchmark ledger', () => {
  it('can be appended to by its owner — the write the app actually performs', async () => {
    const watchId = await seedWatch(alice);
    // 0002 revoked this grant while both writers ran as the user, so every
    // ledger row was silently discarded and the history was always empty.
    await db.asUser(
      alice,
      `insert into booking_price_events (watch_id, user_id, event_type, amount_cents, benchmark_version)
       values ($1, $2, 'INITIAL_PURCHASE', 12800, 1)`,
      [watchId, alice],
    );
    const rows = await db.asUser<{ amount_cents: number }>(
      alice,
      'select amount_cents from booking_price_events where watch_id = $1',
      [watchId],
    );
    expect(rows.map((r) => r.amount_cents)).toEqual([12800]);
  });

  it('cannot be appended to on behalf of somebody else', async () => {
    const watchId = await seedWatch(alice);
    await expect(
      db.asUser(
        bob,
        `insert into booking_price_events (watch_id, user_id, event_type, amount_cents, benchmark_version)
         values ($1, $2, 'REBOOKED', 100, 2)`,
        [watchId, alice],
      ),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '42501');
  });

  it('stays append-only: history can be added to but never rewritten', async () => {
    const watchId = await seedWatch(alice);
    await db.asUser(
      alice,
      `insert into booking_price_events (watch_id, user_id, event_type, amount_cents, benchmark_version)
       values ($1, $2, 'INITIAL_PURCHASE', 12800, 1)`,
      [watchId, alice],
    );

    // Rewriting what you "paid" would make every realised-savings figure a
    // number the user could choose.
    await expect(
      db.asUser(alice, 'update booking_price_events set amount_cents = 1 where watch_id = $1', [
        watchId,
      ]),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '42501');
    await expect(
      db.asUser(alice, 'delete from booking_price_events where watch_id = $1', [watchId]),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '42501');
  });
});

describe('round trips', () => {
  it('links two legs symmetrically', async () => {
    const out = await seedWatch(alice);
    const back = await seedWatch(alice);
    await db.sql('update watches set linked_watch_id = $2 where id = $1', [out, back]);
    await db.sql('update watches set linked_watch_id = $2 where id = $1', [back, out]);

    const rows = await db.sql<{ id: string; linked_watch_id: string }>(
      'select id, linked_watch_id from watches where id = any($1) order by id',
      [[out, back].sort()],
    );
    const byId = new Map(rows.map((r) => [r.id, r.linked_watch_id]));
    expect(byId.get(out)).toBe(back);
    expect(byId.get(back)).toBe(out);
  });

  it('refuses a leg that is its own return', async () => {
    const watchId = await seedWatch(alice);
    await expect(
      db.sql('update watches set linked_watch_id = id where id = $1', [watchId]),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23514');
  });

  it('refuses a third watch claiming an already-paired leg', async () => {
    const out = await seedWatch(alice);
    const back = await seedWatch(alice);
    const other = await seedWatch(alice);
    await db.sql('update watches set linked_watch_id = $2 where id = $1', [out, back]);

    // Without the unique index the pairing silently stops being symmetric.
    await expect(
      db.sql('update watches set linked_watch_id = $2 where id = $1', [other, back]),
    ).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23505');
  });

  it('leaves the surviving leg intact when its partner is deleted', async () => {
    const out = await seedWatch(alice);
    const back = await seedWatch(alice);
    await db.sql('update watches set linked_watch_id = $2 where id = $1', [out, back]);
    await db.sql('delete from watches where id = $1', [back]);

    // ON DELETE SET NULL: the remaining leg keeps monitoring as a one-way.
    const [row] = await db.sql<{ id: string; linked_watch_id: string | null }>(
      'select id, linked_watch_id from watches where id = $1',
      [out],
    );
    expect(row!.id).toBe(out);
    expect(row!.linked_watch_id).toBeNull();
  });

  it('allows many unlinked watches — the unique index must ignore nulls', async () => {
    await seedWatch(bob);
    await seedWatch(bob);
    const rows = await db.sql(
      'select id from watches where user_id = $1 and linked_watch_id is null',
      [bob],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe('timeline assembly', () => {
  const cycle = (over: Partial<CycleRow>): CycleRow =>
    ({
      id: 'c1',
      watch_id: 'w',
      user_id: 'u',
      scheduled_check_run_id: null,
      dispatch_run_id: null,
      trigger: 'MORNING',
      status: 'SUCCESS',
      benchmark_cents: 12800,
      benchmark_version: 1,
      dates_total: 3,
      dates_succeeded: 3,
      dates_failed: 0,
      journeys_returned: 12,
      eligible_candidates: 8,
      qualifying_options: 4,
      best_total_cents: 7400,
      best_savings_cents: 5400,
      alert_suppressed_reason: null,
      error_kind: null,
      error_message: null,
      started_at: '2026-09-01T12:00:00.000Z',
      completed_at: '2026-09-01T12:00:05.000Z',
      ...over,
    }) as CycleRow;

  it('interleaves events, checks and alerts newest first', () => {
    const timeline = buildTimeline(
      [{ id: 'e1', kind: 'CREATED', detail: {}, created_at: '2026-09-01T09:00:00.000Z' }],
      [
        cycle({ id: 'c1' }),
        cycle({
          id: 'c2',
          started_at: '2026-09-02T12:00:00.000Z',
          completed_at: '2026-09-02T12:00:04.000Z',
        }),
      ],
      [
        {
          created_at: '2026-09-01T12:00:06.000Z',
          savings_cents: 5400,
          reason: 'FIRST_DROP',
          best_total_cents: 7400,
        },
      ],
    );

    expect(timeline.map((e) => e.kind)).toEqual(['CHECK', 'ALERT', 'CHECK', 'EVENT']);
    expect(timeline[0]!.id).toBe('check-c2');
    expect(timeline[3]!.id).toBe('event-e1');
  });

  it('sorts an alert above the check that produced it when they share a timestamp', () => {
    // The dispatcher can complete a cycle and write its alert in the same
    // millisecond. Reading "check ran" after "we emailed you" is backwards.
    const at = '2026-09-01T12:00:00.000Z';
    const timeline = buildTimeline(
      [],
      [cycle({ completed_at: at })],
      [{ created_at: at, savings_cents: 5400, reason: 'FIRST_DROP', best_total_cents: 7400 }],
    );
    expect(timeline.map((e) => e.kind)).toEqual(['ALERT', 'CHECK']);
  });

  it('falls back to started_at for a cycle that never completed', () => {
    const timeline = buildTimeline([], [cycle({ completed_at: null })], []);
    expect(timeline[0]!.at).toBe('2026-09-01T12:00:00.000Z');
  });

  it('caps the list so one busy trip cannot render hundreds of rows', () => {
    const many = Array.from({ length: 90 }, (_, i) => ({
      id: `e${i}`,
      kind: 'RESUMED',
      detail: {},
      created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    expect(buildTimeline(many, [], []).length).toBe(40);
  });

  it('is empty rather than throwing when a trip has no history at all', () => {
    expect(buildTimeline([], [], [])).toEqual([]);
  });
});
