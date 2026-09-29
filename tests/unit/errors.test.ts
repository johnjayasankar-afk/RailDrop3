import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { databaseDiagnosis, errorDetail, errorMessage, isTransportFailure } from "@/lib/errors";

/* The regression this file exists for.
 *
 * The Supabase project a deployment pointed at stopped resolving. undici threw
 * `TypeError: fetch failed`, supabase-js put `String(err)` into `error.message`,
 * and the form rendered that string in red under "Start watching". A traveler
 * was shown a Node internal and told nothing about what happened or whether
 * their trip had been saved.
 */

/** What supabase-js actually hands back when the host does not resolve. */
const supabaseNetworkError = { message: "TypeError: fetch failed", details: "", code: "" };

describe("isTransportFailure", () => {
  it("recognises the exact string a dead hostname produces", () => {
    expect(isTransportFailure(new TypeError("fetch failed"))).toBe(true);
    expect(isTransportFailure(supabaseNetworkError)).toBe(true);
  });

  it("recognises the errnos underneath it", () => {
    for (const code of [
      "getaddrinfo ENOTFOUND db.example.supabase.co",
      "connect ECONNREFUSED 127.0.0.1:5432",
      "read ECONNRESET",
      "connect ETIMEDOUT",
      "socket hang up",
      "getaddrinfo EAI_AGAIN db.example.co",
    ]) {
      expect(isTransportFailure(new Error(code)), code).toBe(true);
    }
  });

  it("recognises the browser's wording too", () => {
    expect(isTransportFailure(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("does not claim a real database error is a network one", () => {
    // These reached the database and got an answer. Telling someone to "try
    // again in a minute" would be wrong.
    expect(isTransportFailure({ message: "duplicate key value", code: "23505" })).toBe(false);
    expect(isTransportFailure(new Error("permission denied for table watches"))).toBe(false);
    expect(isTransportFailure(new Error("Supabase service role is not configured"))).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(isTransportFailure(null)).toBe(false);
    expect(isTransportFailure(undefined)).toBe(false);
    expect(isTransportFailure({})).toBe(false);
  });
});

describe("errorMessage", () => {
  it("never shows a reader the words fetch failed", () => {
    const shown = errorMessage(supabaseNetworkError);
    expect(shown.toLowerCase()).not.toContain("fetch");
    expect(shown.toLowerCase()).not.toContain("typeerror");
  });

  it("says nothing was saved, because nothing was", () => {
    const shown = errorMessage(new TypeError("fetch failed"));
    expect(shown).toMatch(/nothing was saved/i);
    expect(shown).toMatch(/try again/i);
  });

  it("does not blame the reader for an outage", () => {
    expect(errorMessage(supabaseNetworkError)).toMatch(/our side/i);
  });

  it("still passes through a message that is genuinely actionable", () => {
    /* Running the schema is something the operator can actually do. It names the
       whole schema rather than one migration: naming a single file is how a
       database ends up with two of the nine applied, which then fails later
       against a column that does not exist instead of at setup. */
    const shown = errorMessage({ message: "insert violates profiles_id_fkey", code: "23503" });
    expect(shown).toContain("supabase/SETUP_ALL.sql");
    expect(shown).toMatch(/SQL Editor/i);
  });

  /* This used to assert the opposite — that "Supabase service role is not
     configured" reached the reader verbatim, "since it names the fix".
     It names the fix for one person, and that person is not the one reading
     it. To everybody else it is an internal symbol: it does not say the trip
     was not saved, it does not say the fare search still works, and it does
     not say whether waiting will help. All three matter more than the string.

     The fix is still named, in `operatorHint`, which /api/health reports and
     the log line carries. */
  it("turns a missing service role into something a reader can act on", () => {
    const shown = errorMessage(new Error("Supabase service role is not configured"));
    expect(shown).toMatch(/nothing was saved/i);
    expect(shown).toMatch(/our side/i);
    expect(shown).not.toMatch(/service role/i);
    // And it does not tell them to wait for something that will not change.
    expect(shown).not.toMatch(/try again in a minute/i);
  });

  it("names the fix for whoever deployed it", () => {
    const { fault, retryWorks, operatorHint } = databaseDiagnosis(
      new Error("Supabase service role is not configured"),
    );
    expect(fault).toBe("not-configured");
    expect(retryWorks).toBe(false);
    expect(operatorHint).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("reads a zod failure as the field problems it is", () => {
    let caught: unknown;
    try {
      z.object({ originCode: z.string().min(3, "Origin must be a station code") }).parse({
        originCode: "",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZodError);
    expect(errorMessage(caught)).toBe("Origin must be a station code");
  });

  it("has something to say about a thrown non-error", () => {
    expect(errorMessage("something odd")).toBeTruthy();
    expect(errorMessage(null)).toBe("Could not create watch");
  });
});

describe("errorDetail", () => {
  it("keeps what the operator needs, including the hostname", () => {
    const error = new TypeError("fetch failed");
    (error as Error & { cause?: unknown }).cause = new Error(
      "getaddrinfo ENOTFOUND hsztdjmrifsgpspvrnbz.supabase.co",
    );
    const detail = errorDetail(error);
    expect(detail).toContain("fetch failed");
    // undici hides the useful half on the cause; without it the log says
    // "fetch failed" and nothing else, which is how an outage goes undiagnosed.
    expect(detail).toContain("ENOTFOUND");
    expect(detail).toContain("supabase.co");
  });

  it("does not repeat itself when the cause adds nothing", () => {
    const error = new Error("boom");
    (error as Error & { cause?: unknown }).cause = new Error("boom");
    expect(errorDetail(error)).toBe("boom");
  });

  it("is never empty, so a log line is never a mystery", () => {
    expect(errorDetail(null)).toBe("unknown error");
    expect(errorDetail({})).toBe("unknown error");
  });

  it("is not what the reader is shown", () => {
    // The whole point of two functions.
    expect(errorDetail(supabaseNetworkError)).not.toBe(errorMessage(supabaseNetworkError));
  });

  it("finds the hostname where supabase-js actually puts it", () => {
    /* Copied out of a real server log, not invented. supabase-js rejects with a
       plain object and no `cause`, so this function — the one whose job is to
       keep the hostname in the log — used to drop it for the only client that
       reads the database, and an outage logged "TypeError: fetch failed" with
       no host in it. The fixture above has details: "", which is why the gap
       survived having tests. */
    const fromProduction = {
      message: "TypeError: fetch failed",
      details:
        "TypeError: fetch failed\n\nCaused by: Error: getaddrinfo ENOTFOUND " +
        "hsztdjmrifsgpspvrnbz.supabase.co (ENOTFOUND)\nError: getaddrinfo ENOTFOUND " +
        "hsztdjmrifsgpspvrnbz.supabase.co\n    at GetAddrInfoReqWrap.onlookupall " +
        "[as oncomplete] (node:dns:122:26)",
      hint: "",
      code: "",
    };
    const detail = errorDetail(fromProduction);
    expect(detail).toContain("ENOTFOUND");
    expect(detail).toContain("hsztdjmrifsgpspvrnbz.supabase.co");
  });

  it("does not put a stack trace in the log line", () => {
    // Diagnosable, still one line.
    const noisy = { message: "TypeError: fetch failed", details: "x".repeat(5_000), code: "" };
    expect(errorDetail(noisy).length).toBeLessThan(400);
    expect(errorDetail(noisy)).not.toContain("\n");
  });
});

/* "Try again in a minute" is a claim, and it has to be true.
 *
 * The Supabase project a deployment pointed at was deleted, so its hostname
 * returned NXDOMAIN — permanently. The save path told everyone to try again in a
 * minute for two weeks. That is the same class of statement as inventing a price:
 * a confident sentence about something we did not observe.
 */
describe("a database we cannot reach", () => {
  function dnsFailure(): Error {
    const error = new TypeError("fetch failed");
    Object.defineProperty(error, "cause", {
      value: new Error("getaddrinfo ENOTFOUND hsztdjmrifsgpspvrnbz.supabase.co"),
    });
    return error;
  }

  it("does not promise a minute will fix a name that does not resolve", () => {
    const shown = errorMessage(dnsFailure());
    expect(shown).not.toMatch(/try again in a minute/i);
    expect(shown).toMatch(/does not resolve/i);
  });

  it("says the fare search still works, because it does", () => {
    // The live lookup needs no database. Leaving that out sends someone away
    // from the one thing that was working.
    expect(errorMessage(dnsFailure())).toMatch(/fare search/i);
  });

  it("still tells them nothing was saved", () => {
    expect(errorMessage(dnsFailure())).toMatch(/nothing was saved/i);
  });

  it("keeps the retry advice for a failure that really is transient", () => {
    /* A reset connection means something answered and the exchange failed. That
       one does get better by waiting, so the old sentence is still correct. */
    const transient = new Error("connect ECONNRESET 10.0.0.1:5432");
    expect(errorMessage(transient)).toMatch(/try again in a minute/i);
  });

  it("still matches what the form looks for before showing fares instead", () => {
    /* new-watch-form tests the message with /could not reach|try again in a
       minute/ to decide whether to fall back to a fare preview. Both branches
       have to keep matching or a failed save shows no prices at all. */
    for (const error of [dnsFailure(), new Error("connect ETIMEDOUT")]) {
      expect(errorMessage(error)).toMatch(/could not reach|try again in a minute/i);
    }
  });

  it("does not leak the hostname to the reader, but keeps it for the log", () => {
    expect(errorMessage(dnsFailure())).not.toMatch(/supabase\.co/);
    expect(errorDetail(dnsFailure())).toMatch(/supabase\.co/);
  });
});
