/**
 * Verifies a live database actually has the schema, RLS and functions RailDrop
 * depends on. Reports what is true, never assumes.
 */

import './load-env';
import { Client } from 'pg';

const TABLES = [
  'profiles',
  'stations',
  'watches',
  'scheduled_check_runs',
  'dispatch_runs',
  'fare_check_cycles',
  'provider_requests',
  'fare_snapshots',
  'journey_options',
  'fare_options',
  'alerts',
  'notification_deliveries',
  'booking_price_events',
];

const FUNCTIONS = [
  'begin_dispatch',
  'finish_dispatch',
  'claim_check_slot',
  'record_skipped_slot',
  'lease_check_runs',
  'complete_check_run',
];

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('SUPABASE_DB_URL is not set.');
    process.exit(1);
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let failures = 0;

  const check = (label: string, ok: boolean, detail = ''): void => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    const tables = await client.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
    );
    const byName = new Map(tables.rows.map((t) => [t.tablename, t.rowsecurity]));

    for (const table of TABLES) {
      check(`table ${table}`, byName.has(table));
      if (byName.has(table)) check(`  RLS enabled on ${table}`, byName.get(table) === true);
    }

    const functions = await client.query<{ proname: string }>(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
    );
    const fnNames = new Set(functions.rows.map((f) => f.proname));
    for (const fn of FUNCTIONS) check(`function ${fn}`, fnNames.has(fn));

    const constraints = await client.query<{ conname: string }>(
      `select conname from pg_constraint where conname in
        ('scheduled_check_runs_slot_unique','alerts_dedupe_unique','fare_snapshots_cycle_date_unique')`,
    );
    const conNames = new Set(constraints.rows.map((c) => c.conname));
    check('unique (watch, local_date, slot)', conNames.has('scheduled_check_runs_slot_unique'));
    check('unique (watch, dedupe_key)', conNames.has('alerts_dedupe_unique'));
    check('unique (cycle, travel_date)', conNames.has('fare_snapshots_cycle_date_unique'));

    const stations = await client.query<{ count: string }>('select count(*) from public.stations');
    const stationCount = Number(stations.rows[0]?.count ?? 0);
    check('station catalog seeded', stationCount > 50, `${stationCount} rows`);

    const cron = await client
      .query<{ jobname: string }>(
        `select jobname from cron.job where jobname = 'raildrop-hourly-dispatch'`,
      )
      .catch(() => ({ rows: [] as Array<{ jobname: string }> }));
    check(
      'pg_cron hourly dispatch scheduled',
      cron.rows.length > 0,
      cron.rows.length > 0 ? '' : 'not scheduled (Vercel Cron fallback applies)',
    );

    console.log(failures === 0 ? '\nDatabase VERIFIED.' : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
