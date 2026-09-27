/**
 * Applies migrations and the station seed over a direct Postgres connection.
 *
 * Exists so RailDrop can be deployed WITHOUT the Supabase CLI: all it needs is
 * SUPABASE_DB_URL. `supabase db push` remains equally valid.
 */

import './load-env';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const SEED = join(process.cwd(), 'supabase', 'seed', 'stations.sql');

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('SUPABASE_DB_URL is not set. See .env.example and SETUP_REQUIRED.md.');
    process.exit(1);
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(`
      create table if not exists public.schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )`);

    const applied = new Set(
      (await client.query<{ version: string }>('select version from schema_migrations')).rows.map(
        (r) => r.version,
      ),
    );

    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    let count = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  = ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      console.log(`  + ${file}`);
      // Each migration is a single transaction: it applies fully or not at all.
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [file]);
        await client.query('commit');
        count += 1;
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }

    console.log(`\nApplied ${count} migration(s).`);

    console.log('Seeding stations...');
    await client.query(readFileSync(SEED, 'utf8'));
    const stations = await client.query<{ count: string }>('select count(*) from public.stations');
    console.log(`Station catalog: ${stations.rows[0]?.count} rows.`);

    console.log('\nDatabase is up to date.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
