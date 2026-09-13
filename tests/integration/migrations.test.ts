import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  createTestDatabase,
  listMigrations,
  type TestDatabase,
} from '../helpers/pg';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const EXPECTED_TABLES = [
  'alerts',
  'booking_price_events',
  'dispatch_runs',
  'fare_check_cycles',
  'fare_options',
  'fare_snapshots',
  'journey_options',
  'notification_deliveries',
  'profiles',
  'provider_requests',
  'push_subscriptions',
  'scheduled_check_runs',
  'stations',
  'watch_events',
  'watches',
];

describe('migrations', () => {
  it('applies cleanly from scratch', async () => {
    const tables = await db.sql<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(EXPECTED_TABLES);
  });

  it('is idempotent — applying twice is safe', async () => {
    await expect(applyMigrations(db.pg)).resolves.not.toThrow();
    expect(listMigrations().length).toBeGreaterThanOrEqual(3);
  });

  it('seeds the station catalog locally', async () => {
    const [row] = await db.sql<{ count: string }>('select count(*)::text as count from stations');
    expect(Number(row?.count)).toBeGreaterThan(100);
    const [bos] = await db.sql<{ city: string }>(`select city from stations where code = 'BOS'`);
    expect(bos?.city).toBe('Boston');
  });

  it('enforces the exactly-once scheduled-slot unique constraint', async () => {
    const [row] = await db.sql<{ conname: string }>(
      `select conname from pg_constraint where conname = 'scheduled_check_runs_slot_unique'`,
    );
    expect(row?.conname).toBe('scheduled_check_runs_slot_unique');
  });

  it('enforces the alert dedupe unique constraint', async () => {
    const [row] = await db.sql<{ conname: string }>(
      `select conname from pg_constraint where conname = 'alerts_dedupe_unique'`,
    );
    expect(row?.conname).toBe('alerts_dedupe_unique');
  });

  it('makes the dispatch hour bucket unique — the dispatcher mutex', async () => {
    const rows = await db.sql<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'dispatch_runs'`,
    );
    expect(rows.some((r) => r.indexdef.includes('UNIQUE') && r.indexdef.includes('bucket'))).toBe(
      true,
    );
  });

  it('stores every money column as an integer, never a float', async () => {
    const rows = await db.sql<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type
         from information_schema.columns
        where table_schema = 'public' and column_name like '%_cents'`,
    );
    expect(rows.length).toBeGreaterThan(8);
    for (const row of rows) {
      expect(`${row.table_name}.${row.column_name}: ${row.data_type}`).toContain('integer');
    }
  });

  it('uses timestamptz for every timestamp', async () => {
    const rows = await db.sql<{ data_type: string }>(
      `select data_type from information_schema.columns
        where table_schema = 'public' and data_type like 'timestamp%'`,
    );
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((r) => r.data_type === 'timestamp with time zone')).toBe(true);
  });

  it('enables row level security on every user-facing table', async () => {
    const rows = await db.sql<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const withoutRls = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(withoutRls).toEqual([]);
  });

  it('creates the concurrency-critical functions', async () => {
    const rows = await db.sql<{ proname: string }>(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' order by proname`,
    );
    const names = rows.map((r) => r.proname);
    for (const fn of [
      'begin_dispatch',
      'claim_check_slot',
      'complete_check_run',
      'finish_dispatch',
      'lease_check_runs',
      'record_skipped_slot',
    ]) {
      expect(names).toContain(fn);
    }
  });
});

describe('domain constraints', () => {
  let userId: string;

  beforeAll(async () => {
    userId = await db.createUser('constraints@test.local');
  });

  // Both ends of the window are relative to now.
  //
  // Pinning only the end and letting monitoring_starts_at default to now()
  // made this fixture rot: watches_window_valid requires ends_at > starts_at,
  // so the whole suite began failing the day the calendar passed the
  // hardcoded date — with an error that pointed at the constraint rather than
  // at the literal. Anything asserting an *invalid* window still pins both.
  const insertWatch = (overrides: Record<string, unknown> = {}) => {
    const values = {
      user_id: userId,
      origin_code: 'BOS',
      destination_code: 'NYP',
      desired_date: '2026-09-20',
      benchmark_cents: 12800,
      monitoring_starts_at: new Date(Date.now() - 3_600_000).toISOString(),
      monitoring_ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      ...overrides,
    };
    const keys = Object.keys(values);
    return db.sql(
      `insert into watches (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`,
      Object.values(values),
    );
  };

  it('rejects a watch whose origin equals its destination', async () => {
    await expect(insertWatch({ destination_code: 'BOS' })).rejects.toThrow(
      /watches_distinct_stations/,
    );
  });

  it('rejects a non-positive benchmark', async () => {
    await expect(insertWatch({ benchmark_cents: 0 })).rejects.toThrow();
  });

  it('rejects an invalid monitoring window', async () => {
    await expect(
      insertWatch({
        monitoring_starts_at: '2026-09-05T00:00:00Z',
        monitoring_ends_at: '2026-09-04T00:00:00Z',
      }),
    ).rejects.toThrow(/watches_window_valid/);
  });

  it('rejects an out-of-range flexibility, passenger count or fare family', async () => {
    await expect(insertWatch({ date_flexibility_days: 3 })).rejects.toThrow();
    await expect(insertWatch({ passengers: 0 })).rejects.toThrow();
    await expect(insertWatch({ passengers: 9 })).rejects.toThrow();
    await expect(insertWatch({ benchmark_fare_family: 'CHEAP' })).rejects.toThrow();
  });

  it('rejects an unknown station code (foreign key)', async () => {
    await expect(insertWatch({ origin_code: 'ZZZ' })).rejects.toThrow();
  });

  it('accepts a valid watch', async () => {
    await expect(insertWatch()).resolves.toBeTruthy();
  });

  it('cascades deletes from a watch to its derived rows', async () => {
    const rows = (await insertWatch({ desired_date: '2026-10-01' })) as Array<{ id: string }>;
    const watchId = rows[0]!.id;
    await db.sql(
      `insert into fare_check_cycles (watch_id, user_id, trigger, benchmark_cents, benchmark_version)
       values ($1, $2, 'INITIAL', 12800, 1)`,
      [watchId, userId],
    );
    await db.sql('delete from watches where id = $1', [watchId]);
    const remaining = await db.sql('select id from fare_check_cycles where watch_id = $1', [
      watchId,
    ]);
    expect(remaining).toHaveLength(0);
  });
});
