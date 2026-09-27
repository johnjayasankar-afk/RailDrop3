import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { errorDetail, errorMessage, isTransportFailure } from "@/lib/errors";

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
    // The one-time guest migration is something the operator can actually do.
    const shown = errorMessage({ message: "insert violates profiles_id_fkey", code: "23503" });
    expect(shown).toContain("supabase/migrations/20260904140000_guest_profiles.sql");
  });

  it("keeps a configuration error verbatim, since it names the fix", () => {
    expect(errorMessage(new Error("Supabase service role is not configured"))).toBe(
      "Supabase service role is not configured",
    );
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
