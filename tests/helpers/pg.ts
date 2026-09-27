import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * A REAL PostgreSQL instance (PGlite embeds Postgres 17 as WASM), so every
 * constraint, unique index, RLS policy and `FOR UPDATE SKIP LOCKED` behaviour
 * under test is the genuine article rather than a simulation.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const SEED_FILE = join(process.cwd(), 'supabase', 'seed', 'stations.sql');

/**
 * Every migration runs here, including 0004. It installs pg_cron/pg_net, which
 * an embedded Postgres does not have - but the migration is written to degrade
 * with a notice rather than abort, and running it is the only way to catch a
 * syntax error that would otherwise only surface on a real deploy.
 */
const SKIP_MIGRATIONS = new Set<string>();

/**
 * Supabase provides these; PGlite does not. The shims are faithful:
 * Supabase's own `auth.uid()` reads the same JWT claim setting.
 */
const SUPABASE_SHIM = `
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text
);

create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
`;

export interface TestDatabase {
  pg: PGlite;
  /** Run SQL as the privileged owner (stands in for the service role). */
  sql<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
  /** Run SQL as an authenticated end user, with RLS enforced. */
  asUser<T = Record<string, unknown>>(
    userId: string,
    query: string,
    params?: unknown[],
  ): Promise<T[]>;
  /** Run SQL as an anonymous visitor, with RLS enforced. */
  asAnon<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
  createUser(email: string): Promise<string>;
  close(): Promise<void>;
}

function prepareMigration(sql: string): string {
  // gen_random_uuid() is core in Postgres 13+, so pgcrypto is unnecessary here.
  return sql.replace(/create extension if not exists "pgcrypto";/g, '');
}

export function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !SKIP_MIGRATIONS.has(f))
    .sort();
}

export async function applyMigrations(pg: PGlite): Promise<void> {
  for (const file of listMigrations()) {
    const sql = prepareMigration(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    try {
      await pg.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
}

export async function seedStations(pg: PGlite): Promise<void> {
  await pg.exec(readFileSync(SEED_FILE, 'utf8'));
}

export async function createTestDatabase(options: { seed?: boolean } = {}): Promise<TestDatabase> {
  const pg = new PGlite();
  await pg.exec(SUPABASE_SHIM);
  await applyMigrations(pg);
  if (options.seed !== false) await seedStations(pg);

  async function sql<T>(query: string, params?: unknown[]): Promise<T[]> {
    const result = await pg.query<T>(query, params as never[]);
    return result.rows;
  }

  async function asRole<T>(
    role: 'authenticated' | 'anon',
    userId: string | null,
    query: string,
    params?: unknown[],
  ): Promise<T[]> {
    await pg.exec('begin');
    try {
      await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
      await pg.exec(`set local role ${role}`);
      const result = await pg.query<T>(query, params as never[]);
      await pg.exec('commit');
      return result.rows;
    } catch (error) {
      await pg.exec('rollback');
      throw error;
    }
  }

  return {
    pg,
    sql,
    asUser: (userId, query, params) => asRole('authenticated', userId, query, params),
    asAnon: (query, params) => asRole('anon', null, query, params),
    async createUser(email: string) {
      const rows = await sql<{ id: string }>(
        'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id',
        [email],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('Failed to create test user');
      return id;
    },
    close: () => pg.close(),
  };
}

/** Postgres error code from a thrown PGlite error, e.g. '23505' for unique violation. */
export function pgErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return null;
}
