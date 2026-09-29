import { readFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

/* The app sets up its own database.
 *
 * "The database is reachable but its tables are missing" was a fault the app
 * could name precisely and do nothing at all about, because supabase-js talks
 * to PostgREST and PostgREST cannot run DDL. So the only cure for the most
 * likely setup failure was a human pasting 729 lines into a SQL editor, in the
 * right order, once — and the diagnosis politely telling them to go and do it.
 *
 * With a direct Postgres URL it is one authenticated request. The script is
 * already written to be re-runnable: every table, index and column is guarded
 * with `if not exists`, and every policy is dropped before it is created,
 * which is the one statement with no `if not exists` form. Running it twice is
 * a no-op, and running it against a half-applied database finishes the job —
 * which is the state that produces the 23503 foreign-key failure the
 * diagnosis calls `schema-missing`.
 *
 * It reports what it found and what it left, rather than "ok". A setup step
 * that says only that it succeeded is a setup step you have to verify by hand.
 */

/**
 * Every table the schema creates. Checked before and after.
 *
 * Read off supabase/SETUP_ALL.sql rather than recalled — the first version of
 * this list was written from memory and had `date_snapshots`,
 * `provider_usage` and `scheduled_runs`, none of which exist. The real names
 * are `fare_snapshots`, `provider_usage_daily` and `scheduled_check_runs`,
 * and it also missed `stations` and `notification_deliveries` entirely.
 *
 * A wrong list here is worse than no list: provisioning would have reported
 * success while three tables it checked for were never going to appear, and
 * failure for two that had. tests/unit/provision.test.ts compares this
 * against the script in both directions, which is how those five were found.
 */
const REQUIRED_TABLES = [
  "alert_decisions",
  "alerts",
  "booking_price_events",
  "email_suppressions",
  "fare_check_cycles",
  "fare_snapshots",
  "journey_options",
  "notification_deliveries",
  "profiles",
  "provider_requests",
  "provider_usage_daily",
  "scheduled_check_runs",
  "search_cache",
  "stations",
  "watches",
];

export interface ProvisionReport {
  ok: boolean;
  /** Tables that existed before the script ran. */
  before: string[];
  /** Tables that exist after it. */
  after: string[];
  /** Required tables still absent — empty on success. */
  missing: string[];
  /** Statements the server rejected, with the reason. Empty on success. */
  failures: Array<{ statement: string; message: string }>;
  elapsedMs: number;
}

export class ProvisionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionUnavailableError";
  }
}

/** Where SETUP_ALL.sql lives, both in dev and inside the traced bundle. */
function setupSqlPath(): string {
  return path.join(process.cwd(), "supabase", "SETUP_ALL.sql");
}

export async function readSetupSql(): Promise<string> {
  return readFile(setupSqlPath(), "utf8");
}

/**
 * Apply the schema.
 *
 * `pg` is imported dynamically so the module never loads on a request that is
 * not provisioning — it pulls in a TCP client and a connection pool, and every
 * page on this deployment would otherwise carry it.
 */
export async function provisionDatabase(): Promise<ProvisionReport> {
  const started = Date.now();
  const { databaseUrl } = getConfig();
  if (!databaseUrl) {
    throw new ProvisionUnavailableError(
      "No direct Postgres URL is configured. Set SUPABASE_DB_URL (Supabase → Project Settings → " +
        "Database → Connection string, the pooled URI) and redeploy. The service role key cannot " +
        "do this: it talks to PostgREST, which cannot run DDL.",
    );
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: databaseUrl,
    /* Supabase terminates TLS with a certificate this client has no root for,
       and the connection is to a host we named ourselves over the provider's
       network. Refusing it would make self-setup impossible without shipping
       their CA; accepting it is the same trust the pooled URI already asks
       for, and nothing secret travels in the other direction. */
    ssl: { rejectUnauthorized: false },
    // A cold Supabase project can take a while to answer the first connection.
    connectionTimeoutMillis: 20_000,
    query_timeout: 120_000,
  });

  await client.connect();
  try {
    const before = await listTables(client);
    const sql = await readSetupSql();

    const failures: ProvisionReport["failures"] = [];
    try {
      // One call. The script is ordered, and splitting it on semicolons would
      // break every function body and dollar-quoted block in it.
      await client.query(sql);
    } catch (error) {
      failures.push({
        statement: "supabase/SETUP_ALL.sql",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const after = await listTables(client);
    const missing = REQUIRED_TABLES.filter((table) => !after.includes(table));
    const report: ProvisionReport = {
      ok: failures.length === 0 && missing.length === 0,
      before,
      after,
      missing,
      failures,
      elapsedMs: Date.now() - started,
    };
    logger.info("db.provision", {
      ok: report.ok,
      created: after.filter((t) => !before.includes(t)).length,
      missing: missing.length,
      elapsedMs: report.elapsedMs,
    });
    return report;
  } finally {
    await client.end().catch(() => undefined);
  }
}

interface QueryableClient {
  query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

async function listTables(client: QueryableClient): Promise<string[]> {
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  return rows.map((row) => String(row.table_name));
}

/** The required set, for the health endpoint and the tests. */
export function requiredTables(): readonly string[] {
  return REQUIRED_TABLES;
}
