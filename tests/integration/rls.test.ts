import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/pg';

/**
 * RLS is the actual authorization boundary. These tests attack it directly with
 * real Postgres roles rather than trusting application-level checks.
 */

let db: TestDatabase;
let alice: string;
let bob: string;
let aliceWatch: string;
let bobWatch: string;

async function seedWatch(userId: string, desiredDate: string): Promise<string> {
  const rows = await db.sql<{ id: string }>(
    `insert into watches (user_id, origin_code, destination_code, desired_date, benchmark_cents, monitoring_ends_at)
     values ($1, 'BOS', 'NYP', $2, 12800, now() + interval '2 days') returning id`,
    [userId, desiredDate],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await db.createUser('alice@test.local');
  bob = await db.createUser('bob@test.local');
  // The on_auth_user_created trigger bootstraps profiles automatically.
  const profiles = await db.sql<{ id: string }>('select id from profiles order by email');
  expect(profiles.map((p) => p.id)).toEqual([alice, bob]);

  aliceWatch = await seedWatch(alice, '2026-09-20');
  bobWatch = await seedWatch(bob, '2026-09-25');

  for (const [watchId, userId] of [
    [aliceWatch, alice],
    [bobWatch, bob],
  ] as const) {
    const cycle = await db.sql<{ id: string }>(
      `insert into fare_check_cycles (watch_id, user_id, trigger, status, benchmark_cents, benchmark_version)
       values ($1,$2,'INITIAL','SUCCESS',12800,1) returning id`,
      [watchId, userId],
    );
    const snapshot = await db.sql<{ id: string }>(
      `insert into fare_snapshots (cycle_id, watch_id, user_id, travel_date, displacement_days, status)
       values ($1,$2,$3,'2026-09-20',0,'SUCCESS') returning id`,
      [cycle[0]!.id, watchId, userId],
    );
    const journey = await db.sql<{ id: string }>(
      `insert into journey_options (snapshot_id, watch_id, user_id, provider_journey_id, origin_code,
        destination_code, departure_local, arrival_local, duration_minutes, travel_date, service_type)
       values ($1,$2,$3,'j1','BOS','NYP','2026-09-20T07:05','2026-09-20T11:14',249,'2026-09-20','DIRECT_RAIL')
       returning id`,
      [snapshot[0]!.id, watchId, userId],
    );
    await db.sql(
      `insert into fare_options (journey_option_id, snapshot_id, watch_id, user_id, fare_family, travel_class,
        amount_cents, party_total_cents, pricing_basis, pricing_confidence, availability, signature)
       values ($1,$2,$3,$4,'FLEXIBLE','COACH',7400,7400,'UNKNOWN','UNAMBIGUOUS_SINGLE','AVAILABLE','sig')`,
      [journey[0]!.id, snapshot[0]!.id, watchId, userId],
    );
    const alert = await db.sql<{ id: string }>(
      `insert into alerts (watch_id, user_id, cycle_id, reason, dedupe_key, benchmark_cents,
        best_total_cents, savings_cents, best_signature, cycle_status)
       values ($1,$2,$3,'FIRST_DROP','k',12800,7400,5400,'sig','SUCCESS') returning id`,
      [watchId, userId, cycle[0]!.id],
    );
    await db.sql(
      `insert into notification_deliveries (alert_id, watch_id, user_id, recipient, subject)
       values ($1,$2,$3,'x@test.local','Fare drop')`,
      [alert[0]!.id, watchId, userId],
    );
    await db.sql(
      `insert into booking_price_events (watch_id, user_id, event_type, amount_cents, benchmark_version)
       values ($1,$2,'INITIAL_PURCHASE',12800,1)`,
      [watchId, userId],
    );
    await db.sql(
      `insert into scheduled_check_runs (watch_id, user_id, local_date, check_slot)
       values ($1,$2,'2026-09-02','MORNING')`,
      [watchId, userId],
    );
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const DERIVED_TABLES = [
  'fare_check_cycles',
  'fare_snapshots',
  'journey_options',
  'fare_options',
  'alerts',
  'notification_deliveries',
  'booking_price_events',
  'scheduled_check_runs',
] as const;

describe('RLS: watches', () => {
  it('lets a user see only their own watches', async () => {
    const rows = await db.asUser<{ id: string }>(alice, 'select id from watches');
    expect(rows.map((r) => r.id)).toEqual([aliceWatch]);
  });

  it('blocks reading another user watch by id (IDOR)', async () => {
    const rows = await db.asUser(alice, 'select id from watches where id = $1', [bobWatch]);
    expect(rows).toHaveLength(0);
  });

  it('blocks updating another user watch', async () => {
    await db.asUser(alice, `update watches set status = 'PAUSED' where id = $1`, [bobWatch]);
    const [row] = await db.sql<{ status: string }>('select status from watches where id = $1', [
      bobWatch,
    ]);
    expect(row?.status).toBe('ACTIVE');
  });

  it('blocks deleting another user watch', async () => {
    await db.asUser(alice, 'delete from watches where id = $1', [bobWatch]);
    const rows = await db.sql('select id from watches where id = $1', [bobWatch]);
    expect(rows).toHaveLength(1);
  });

  it('blocks creating a watch owned by someone else', async () => {
    await expect(
      db.asUser(
        alice,
        `insert into watches (user_id, origin_code, destination_code, desired_date, benchmark_cents, monitoring_ends_at)
         values ($1,'BOS','NYP','2026-09-20',12800, now() + interval '1 day')`,
        [bob],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('allows creating a watch for oneself', async () => {
    await expect(
      db.asUser(
        alice,
        `insert into watches (user_id, origin_code, destination_code, desired_date, benchmark_cents, monitoring_ends_at)
         values ($1,'BOS','PHL','2026-10-10',9900, now() + interval '1 day')`,
        [alice],
      ),
    ).resolves.toBeTruthy();
  });

  it('denies anonymous access entirely', async () => {
    const rows = await db.asAnon('select id from watches').catch(() => []);
    expect(rows).toHaveLength(0);
  });
});

describe('RLS: derived data', () => {
  it.each(DERIVED_TABLES)('scopes %s to the owning user', async (table) => {
    const mine = await db.asUser<{ user_id: string }>(alice, `select user_id from ${table}`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.user_id === alice)).toBe(true);

    const theirs = await db.asUser(alice, `select id from ${table} where user_id = $1`, [bob]);
    expect(theirs).toHaveLength(0);
  });

  it.each(DERIVED_TABLES)('forbids a user writing directly to %s', async (table) => {
    await expect(
      db.asUser(alice, `delete from ${table} where user_id = $1`, [alice]),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('RLS: operational tables are invisible to users', () => {
  beforeAll(async () => {
    await db.sql(
      `insert into provider_requests (provider_id, canonical_key, origin_code, destination_code,
        travel_date, passengers, status)
       values ('parse','BOS|NYP|2026-09-20|1','BOS','NYP','2026-09-20',1,'SUCCESS')`,
    );
    await db.sql(`insert into dispatch_runs (bucket) values (date_trunc('hour', now()))`);
  });

  it.each(['provider_requests', 'dispatch_runs'])(
    'hides %s from authenticated users',
    async (table) => {
      await expect(db.asUser(alice, `select * from ${table}`)).rejects.toThrow(
        /permission denied/i,
      );
    },
  );

  it('hides the usage view from users', async () => {
    await expect(db.asUser(alice, 'select * from provider_usage_mtd')).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('RLS: worker functions are not user-callable', () => {
  it('denies begin_dispatch', async () => {
    await expect(
      db.asUser(alice, 'select begin_dispatch(now(), 15, $1)', ['ATTACK']),
    ).rejects.toThrow(/permission denied/i);
  });

  it('denies claim_check_slot, so a user cannot forge scheduled work', async () => {
    await expect(
      db.asUser(alice, `select claim_check_slot($1, $2, '2026-09-03', 'AFTERNOON')`, [
        aliceWatch,
        alice,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('denies lease_check_runs', async () => {
    await expect(
      db.asUser(alice, 'select * from lease_check_runs($1::uuid[], 15)', [[aliceWatch]]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('denies complete_check_run', async () => {
    await expect(
      db.asUser(alice, `select complete_check_run($1, 'DONE', null)`, [aliceWatch]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('denies finish_dispatch and record_skipped_slot', async () => {
    await expect(
      db.asUser(alice, `select finish_dispatch($1, 'DONE', '{}'::jsonb)`, [aliceWatch]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.asUser(alice, `select record_skipped_slot($1, $2, '2026-09-03', 'EVENING', 'x')`, [
        aliceWatch,
        alice,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('RLS: stations are public reference data', () => {
  it('is readable by anyone', async () => {
    const rows = await db.asAnon<{ code: string }>(`select code from stations where code = 'BOS'`);
    expect(rows[0]?.code).toBe('BOS');
  });

  it('is not writable by users', async () => {
    await expect(
      db.asUser(
        alice,
        `insert into stations (code, name, city, state) values ('XXX','X','X','XX')`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
