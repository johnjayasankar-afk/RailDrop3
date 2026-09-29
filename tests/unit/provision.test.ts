import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { requiredTables } from "@/lib/db/provision";

/* The app can set up its own database.
 *
 * "The database is reachable but its tables are missing" was a fault the app
 * could name precisely and do nothing about: supabase-js talks to PostgREST,
 * and PostgREST cannot run DDL. So the cure for the most likely setup failure
 * was a person pasting 729 lines into a SQL editor in the right order, and the
 * diagnosis politely telling them to go and do it.
 *
 * WHAT THIS FILE DOES NOT TEST, said plainly: applying the SQL. There is no
 * Postgres and no Docker on this machine, so the one thing that matters most
 * — `client.query(sql)` against a real server — has not been run. What is
 * checked here is everything that can be checked without one, and the most
 * valuable of those is the drift check below: a required-tables list that
 * disagrees with the script is a green provision followed by a red app.
 */

const ROOT = path.resolve(__dirname, "../..");
const SQL = readFileSync(path.join(ROOT, "supabase/SETUP_ALL.sql"), "utf8");

/** Every `create table if not exists public.X` in the script. */
function tablesInScript(): string[] {
  return [...SQL.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]!);
}

describe("the schema the app checks for is the schema the script creates", () => {
  it("reads a script worth running", () => {
    expect(SQL.length).toBeGreaterThan(10_000);
    expect(tablesInScript().length).toBeGreaterThan(10);
  });

  it("creates every table the app requires", () => {
    const created = new Set(tablesInScript());
    const absent = requiredTables().filter((table) => !created.has(table));
    expect(
      absent.length === 0
        ? []
        : absent.concat(
            "provisionDatabase would report success and the app would still fail on these.",
          ),
    ).toEqual([]);
  });

  it("requires every table the script creates", () => {
    /* The other direction. A table in the script that nothing requires is
       either dead schema or a gap in the post-provision check — and the
       second is how a half-applied database passes as complete. */
    const required = new Set(requiredTables());
    const unchecked = tablesInScript().filter((table) => !required.has(table));
    expect(unchecked).toEqual([]);
  });

  it("is safe to run twice", () => {
    /* The whole design rests on this. Every table guarded, and every policy
       dropped before it is created — `create policy` is the one statement in
       here with no `if not exists` form, so without the drop a second run
       fails on the first policy and leaves the rest unapplied. */
    const createTables = [...SQL.matchAll(/create table (?!if not exists)/g)].length;
    expect(createTables).toBe(0);

    const policies = [...SQL.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]!);
    const dropped = new Set(
      [...SQL.matchAll(/drop policy if exists "([^"]+)"/g)].map((m) => m[1]!),
    );
    const unguarded = policies.filter((name) => !dropped.has(name));
    expect(unguarded).toEqual([]);
  });

  it("creates the indexes guarded too", () => {
    expect([...SQL.matchAll(/create index (?!if not exists)/g)].length).toBe(0);
  });
});

describe("provisioning refuses clearly when it cannot run", () => {
  it("needs a direct Postgres URL, and says why the service role is not one", async () => {
    // No SUPABASE_DB_URL in this environment, which is the default.
    const { provisionDatabase, ProvisionUnavailableError } = await import("@/lib/db/provision");
    await expect(provisionDatabase()).rejects.toBeInstanceOf(ProvisionUnavailableError);
    await expect(provisionDatabase()).rejects.toThrow(/SUPABASE_DB_URL/);
    // The reason matters: someone with the service role key will otherwise
    // assume it is enough, because for every other operation it is.
    await expect(provisionDatabase()).rejects.toThrow(/PostgREST/);
  });

  it("can read the script from where the route will read it", async () => {
    const { readSetupSql } = await import("@/lib/db/provision");
    const sql = await readSetupSql();
    expect(sql).toContain("create table if not exists public.watches");
  });
});

/* The third side of the triangle.
 *
 * provision.ts's REQUIRED_TABLES and SETUP_ALL.sql are already checked
 * against each other above. Neither is checked against the code that
 * actually issues the queries, and that is the pairing a runtime failure
 * comes from: a table added to supabase-repository.ts without a matching
 * CREATE ships fine, builds fine, passes every test here, and then throws
 * 42P01 on the one request that touches it — against a database that is
 * otherwise healthy, which is the hardest kind of outage to read.
 *
 * Confirmed matching when this was written: fifteen tables in the repository
 * and the same fifteen in the script. This exists so the sixteenth cannot be
 * added to only one of them.
 */
describe("the schema the script creates is the schema the code queries", () => {
  const REPOSITORY = readFileSync(
    path.resolve(__dirname, "../../src/lib/db/supabase-repository.ts"),
    "utf8",
  );

  /** Every table the repository selects from, inserts into or updates. */
  function queried(): string[] {
    const found = [...REPOSITORY.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]!);
    return [...new Set(found)].sort();
  }

  /** Every table the script creates, however the statement is spelled. */
  function created(): string[] {
    const found = [
      ...SQL.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)/gi),
    ].map((m) => m[1]!.toLowerCase());
    return [...new Set(found)].sort();
  }

  it("is reading both files", () => {
    // Two regexes that match nothing would agree perfectly.
    expect(queried().length).toBeGreaterThanOrEqual(15);
    expect(created().length).toBeGreaterThanOrEqual(15);
  });

  it("creates every table the repository queries", () => {
    const madeUp = queried().filter((table) => !created().includes(table));
    expect(
      madeUp,
      `the repository queries these and SETUP_ALL.sql does not create them, so a fresh ` +
        `project would throw 42P01 on the first request that touches one`,
    ).toEqual([]);
  });

  it("queries every table it creates", () => {
    /* Not a runtime failure, but it is how a schema silently grows a table
       nobody reads — and the next person cannot tell whether it is dead or
       load-bearing. */
    const unread = created().filter((table) => !queried().includes(table));
    expect(unread).toEqual([]);
  });
});
