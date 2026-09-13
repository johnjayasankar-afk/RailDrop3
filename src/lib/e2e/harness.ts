import 'server-only';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createPgliteSupabase, serializePg } from './pglite-client';

/**
 * E2E harness: runs the REAL application against an in-process Postgres.
 *
 * This exists because Playwright must drive the actual UI, API routes, services
 * and SQL - not mocks. Only three seams are swapped (the two Supabase clients
 * and session lookup); every page, query, service and migration under test is
 * the production one, and RLS is genuinely enforced because user-scoped queries
 * run as the `authenticated` role.
 *
 * It refuses to initialise anywhere that looks like production.
 */

export const E2E_USER_EMAIL = 'e2e@raildrop.test';
export const E2E_COOKIE = 'rd_e2e_user';

/**
 * Fixed, not generated.
 *
 * The harness database lives in memory, so a dev-server recompile rebuilds it.
 * With a random uuid the rebuilt database minted a *new* user while the browser
 * still held the old id in its cookie, and every insert then failed
 * `watches_user_id_fkey` — surfacing as "Could not create the watch." on every
 * trip, with nothing about the session to suggest why. A constant id survives
 * any number of rebuilds.
 */
export const E2E_USER_ID = '00000000-0000-4000-8000-0000000e2e00';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const SEED_FILE = join(process.cwd(), 'supabase', 'seed', 'stations.sql');
// Every migration runs, including 0004: it degrades with a notice where
// pg_cron/pg_net are unavailable, and running it catches deploy-blocking syntax.
const SKIP = new Set<string>();

const SHIM = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
`;

export function isE2EMode(): boolean {
  return process.env.E2E_MODE === 'true' && process.env.VERCEL_ENV !== 'production';
}

function assertSafe(): void {
  if (!isE2EMode()) {
    throw new Error(
      'The E2E harness was requested outside E2E mode. It must never run in production.',
    );
  }
}

interface Harness {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pg: any;
  serviceClient: SupabaseClient;
  userId: string;
}

/**
 * The harness MUST be a true process-wide singleton. Next bundles each route
 * separately, so a module-level variable gives every route its own PGlite
 * instance — the API route writes to one database and the page reads from
 * another, which looks exactly like a mutation that silently does not stick.
 */
const HARNESS_KEY = Symbol.for('raildrop.e2e.harness');
type HarnessHolder = { [HARNESS_KEY]?: Promise<Harness> };
const harnessHolder = globalThis as unknown as HarnessHolder;

async function bootstrap(): Promise<Harness> {
  assertSafe();
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();

  await pg.exec(SHIM);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !SKIP.has(f))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(
      /create extension if not exists "pgcrypto";/g,
      '',
    );
    await pg.exec(sql);
  }
  await pg.exec(readFileSync(SEED_FILE, 'utf8'));

  const created = await pg.query<{ id: string }>(
    'insert into auth.users (id, email) values ($1, $2) returning id',
    [E2E_USER_ID, E2E_USER_EMAIL],
  );
  const userId = created.rows[0]?.id;
  if (!userId) throw new Error('E2E harness could not create the test user');
  await pg.query('update public.profiles set email = $1 where id = $2', [E2E_USER_EMAIL, userId]);

  return { pg, serviceClient: createPgliteSupabase(pg), userId };
}

export async function getHarness(): Promise<Harness> {
  assertSafe();
  harnessHolder[HARNESS_KEY] ??= bootstrap();
  return harnessHolder[HARNESS_KEY];
}

/** Service-role equivalent: full access, used by background work. */
export async function getE2EServiceClient(): Promise<SupabaseClient> {
  return (await getHarness()).serviceClient;
}

/** User-scoped equivalent: runs as `authenticated`, so RLS applies. */
export async function getE2EUserClient(userId: string): Promise<SupabaseClient> {
  const harness = await getHarness();
  return createPgliteSupabase(harness.pg, { asUserId: userId });
}

export async function getE2EUserId(): Promise<string> {
  return (await getHarness()).userId;
}

/**
 * Wipe user data between Playwright specs, keeping the station catalog.
 *
 * Goes through the SAME serialization queue as every other statement: PGlite is
 * one connection, and a bare DELETE issued while a scoped request has an open
 * transaction lands inside that transaction and corrupts it - which surfaces as
 * a mutation that silently does not stick.
 */
export async function resetE2EData(): Promise<void> {
  const harness = await getHarness();
  await serializePg(async () => {
    for (const table of ['watches', 'provider_requests', 'dispatch_runs', 'push_subscriptions']) {
      await harness.pg.exec(`delete from public.${table}`);
    }
    // Preferences live on the profile, which survives a data wipe — without
    // this, a spec that saves quiet hours silently changes the starting state
    // of every spec that runs after it.
    await harness.pg.exec(`
      update public.profiles set
        email_alerts              = default,
        push_alerts               = default,
        quiet_hours_start         = null,
        quiet_hours_end           = null,
        default_min_savings_cents = default,
        onboarded_at              = null
    `);
  });
}

/**
 * Does this id still exist in the current harness database?
 *
 * The session shim uses it to reject an id left over from an earlier database,
 * rather than handing it to a query that will fail a foreign key several layers
 * further down.
 */
export async function e2eUserExists(userId: string): Promise<boolean> {
  const harness = await getHarness();
  const rows = await serializePg(async () => {
    const result = (await harness.pg.query('select id from auth.users where id = $1', [
      userId,
    ])) as { rows: unknown[] };
    return result.rows;
  });
  return rows.length > 0;
}
