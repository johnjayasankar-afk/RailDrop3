import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* The setup script has to still be the schema.
 *
 * A new Supabase project is set up by pasting supabase/SETUP_ALL.sql once, which
 * is generated from the migrations. The failure that matters is silent: someone
 * adds a migration, does not regenerate, and from then on every new project gets
 * a schema missing a table — which surfaces later as a runtime error against a
 * column that does not exist, a long way from the cause.
 *
 * This regenerates it and compares. It writes nothing; the generator is run
 * against a throwaway copy of its own output.
 */

const ROOT = path.resolve(__dirname, "../..");

describe("supabase/SETUP_ALL.sql", () => {
  it("matches what the generator produces from the migrations", () => {
    const before = readFileSync(path.join(ROOT, "supabase/SETUP_ALL.sql"), "utf8");
    execFileSync("node", ["scripts/build-setup-sql.mjs"], { cwd: ROOT, stdio: "pipe" });
    const after = readFileSync(path.join(ROOT, "supabase/SETUP_ALL.sql"), "utf8");
    expect(after).toBe(before); // run: node scripts/build-setup-sql.mjs
  });

  it("contains every migration", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/SETUP_ALL.sql"), "utf8");
    const names = readFileSync(path.join(ROOT, "supabase/SETUP_ALL.sql"), "utf8").match(
      /^-- \d{14}_[a-z_]+\.sql$/gm,
    );
    expect(names?.length ?? 0).toBeGreaterThanOrEqual(9);
    expect(sql).toContain("create table if not exists public.watches");
  });

  it("can be run twice, which is the whole reason it is not just a concatenation", () => {
    /* create policy is the one statement here with no "if not exists" form, so a
       second run would fail on the first policy and leave the rest unapplied —
       on a half-set-up project, which is exactly when someone runs it again. */
    const sql = readFileSync(path.join(ROOT, "supabase/SETUP_ALL.sql"), "utf8");
    const names = [...sql.matchAll(/^create policy\s+("?[A-Za-z0-9_]+"?)/gim)].map(
      (match) => match[1] ?? "",
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      /* Escaped, and followed by \\s rather than \\b: a quoted policy name ends in
         a double quote and the next character is a space, where \\b cannot match.
         Getting that wrong failed this check against SQL that was correct. */
      const escaped = name.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
      expect(sql).toMatch(new RegExp(`^drop policy if exists ${escaped}\\s`, "im"));
    }
  });
});
