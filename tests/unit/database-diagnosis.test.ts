import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseDatabase, type DatabaseFault } from "@/lib/db/diagnosis";
import { errorMessage, toAppError } from "@/lib/errors";

/* "This is a problem on our side — try again in a minute."
 *
 * That sentence was what almost every database failure said, and it is true of
 * exactly one of the six causes. A reader saw it, waited, tried again, saw it
 * again, and concluded the product was broken — which, from where they were
 * standing, is a fair reading of what it said.
 *
 * Two separate faults produced it, and both are reproduced below.
 *
 * The first is that supabase-js flattens every network failure to the same
 * `message`: "TypeError: fetch failed", for a deleted project, a paused one, a
 * reset connection and a timeout alike. The errno survives in `details` and
 * nowhere else. `SupabaseRepository.createWatch` did `throw new Error(
 * error.message)` — two of its forty-five methods did, and one of them is the
 * insert behind "Start watching" — so the single distinguishing fact was
 * destroyed before anything could read it.
 *
 * The second is that `toAppError` ran twice. createWatchAndScan wrapped the
 * failure and got the right answer; the route then called errorMessage() on
 * that Error, and the second pass had only the sentence to work from. Both
 * were in the same log line, `detail` right and `message` wrong, which is what
 * gave it away.
 *
 * The shapes below are copied from a real supabase-js response, captured by
 * pointing a client at a closed port and at a hostname with no DNS record.
 */

/** What supabase-js actually returns. `message` is useless; `details` is not. */
function supabaseFailure(cause: string) {
  return {
    message: "TypeError: fetch failed",
    details: `TypeError: fetch failed\n\nCaused by: ${cause}`,
    hint: "",
    code: "",
  };
}

const REFUSED = supabaseFailure(
  "Error: connect ECONNREFUSED 10.0.0.1:443 (ECONNREFUSED)\nError: connect ECONNREFUSED 10.0.0.1:443",
);
const UNRESOLVED = supabaseFailure(
  "Error: getaddrinfo ENOTFOUND gone.supabase.co (ENOTFOUND)\nError: getaddrinfo ENOTFOUND gone.supabase.co",
);
const RESET = supabaseFailure("Error: read ECONNRESET (ECONNRESET)");

describe("each cause is told apart, and only one of them says wait", () => {
  const cases: Array<[string, unknown, DatabaseFault, boolean]> = [
    ["a paused project refusing connections", REFUSED, "refused", false],
    ["a deleted project with no DNS record", UNRESOLVED, "name-does-not-resolve", false],
    ["a reset connection, which is luck", RESET, "timeout", true],
    [
      "a timeout",
      supabaseFailure("Error: Connect Timeout Error (UND_ERR_CONNECT_TIMEOUT)"),
      "timeout",
      true,
    ],
    [
      "tables that were never created",
      { message: 'relation "public.watches" does not exist', code: "42P01" },
      "schema-missing",
      false,
    ],
    [
      "PostgREST not finding the table in its schema cache",
      {
        message: "Could not find the table 'public.watches' in the schema cache",
        code: "PGRST205",
      },
      "schema-missing",
      false,
    ],
    [
      "half a schema",
      { message: "insert violates profiles_id_fkey", code: "23503" },
      "schema-missing",
      false,
    ],
    [
      "row-level security refusing the write",
      { message: "permission denied for table watches", code: "42501" },
      "permission-denied",
      false,
    ],
    ["a rejected key", { message: "Invalid API key", status: 401 }, "key-rejected", false],
  ];

  for (const [label, error, fault, retryWorks] of cases) {
    it(`reads ${label} as ${fault}`, () => {
      const verdict = diagnoseDatabase(error);
      expect(verdict.fault).toBe(fault);
      expect(verdict.retryWorks).toBe(retryWorks);
      // The rule the whole module exists for.
      if (!retryWorks) expect(verdict.message).not.toMatch(/try again in a minute/i);
      if (retryWorks) expect(verdict.message).toMatch(/try again/i);
      expect(verdict.operatorHint.length).toBeGreaterThan(20);
    });
  }

  it("says so when nothing is configured at all", () => {
    const verdict = diagnoseDatabase(new Error("whatever"), { configured: false });
    expect(verdict.fault).toBe("not-configured");
    expect(verdict.retryWorks).toBe(false);
    expect(verdict.operatorHint).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("never tells a reader to wait for something permanent", () => {
    const permanent = [
      REFUSED,
      UNRESOLVED,
      { message: "x", code: "42P01" },
      { message: "Invalid API key", status: 401 },
    ];
    for (const error of permanent) {
      expect(diagnoseDatabase(error).message).not.toMatch(/try again in a minute/i);
    }
  });

  it("always says the fare search still works, because it does", () => {
    for (const error of [REFUSED, UNRESOLVED, RESET]) {
      expect(diagnoseDatabase(error).message).toMatch(/fare search/i);
    }
  });

  it("never shows a reader a hostname, a key or an errno", () => {
    for (const error of [REFUSED, UNRESOLVED, RESET]) {
      const shown = diagnoseDatabase(error).message.toLowerCase();
      for (const leak of ["econnrefused", "enotfound", "supabase", "fetch", "10.0.0.1"]) {
        expect(shown).not.toContain(leak);
      }
    }
  });
});

describe("the detail survives the trip to the reader", () => {
  it("classifies a paused project through toAppError", () => {
    // This is the exact path "Start watching" takes.
    expect(errorMessage(REFUSED)).toMatch(/not accepting connections/i);
    expect(errorMessage(REFUSED)).not.toMatch(/try again in a minute/i);
  });

  it("is not re-derived on a second pass", () => {
    /* The route calls errorMessage() on an Error createWatchAndScan already
       translated. Before this was idempotent, the second pass saw a sentence
       with no errno in it, fell through to "we could not tell", and replaced
       a correct diagnosis with a wrong one. */
    const once = toAppError(REFUSED);
    const twice = toAppError(once);
    expect(twice).toBe(once);
    expect(twice.message).toBe(once.message);
    expect(errorMessage(once)).toMatch(/not accepting connections/i);
  });

  it("leaves a validation message alone", () => {
    // Not every failure here is the database's.
    expect(errorMessage(new Error("Enter the actual total you paid."))).toBe(
      "Enter the actual total you paid.",
    );
  });
});

describe("the repository does not throw the detail away", () => {
  /* `throw new Error(error.message)` keeps the one string that is identical
     for every network fault and discards `details`, which is the only place
     the errno lives. Two of forty-five methods did it, and one was createWatch.
     A grep is the right check: it is the pattern that is wrong, not one line. */
  const SOURCE = readFileSync(
    path.resolve(__dirname, "../../src/lib/db/supabase-repository.ts"),
    "utf8",
  );

  it("reads the repository", () => {
    expect(SOURCE.length).toBeGreaterThan(5_000);
    expect(SOURCE).toContain("class SupabaseRepository");
  });

  it("rethrows the Supabase error rather than its message", () => {
    const wrapped = SOURCE.split("\n")
      .map((line, index) => [line, index + 1] as const)
      .filter(([line]) => /throw new Error\(\s*error\.message\s*\)/.test(line))
      .map(([line, n]) => `supabase-repository.ts:${n} ${line.trim()}`);
    expect(
      wrapped.length === 0
        ? []
        : wrapped.concat("Use `throw error` — the errno is in `details`, not in `message`."),
    ).toEqual([]);
  });
});
