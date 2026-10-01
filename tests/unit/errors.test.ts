import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import { errorDetail, errorMessage, isTransportFailure } from "@/lib/errors";

/* Two strings for every failure, and they are not the same string.
 *
 * Conflating them is how "TypeError: fetch failed" ended up rendered in red
 * under a button: that is undici's wording when a host does not answer, and
 * it is not something a reader can act on. The operator needs the opposite —
 * the raw text, in the log, with the hostname still in it.
 *
 * This file used to test a six-way database diagnosis as well: a deleted
 * project, a paused one, a missing schema, a rejected key, each with its own
 * advice about whether waiting would help. There is no database. What is
 * left is the one distinction that still matters to this product — did the
 * request reach the fare board at all?
 */

describe("errorMessage", () => {
  it("never shows a reader a transport string", () => {
    const undici = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND wanderu.com"), { code: "ENOTFOUND" }),
    });
    const shown = errorMessage(undici);
    expect(shown).not.toMatch(/fetch failed/i);
    expect(shown).not.toMatch(/enotfound/i);
    expect(shown).not.toMatch(/typeerror/i);
    expect(shown).toMatch(/fare board/i);
  });

  it("says why there is no price, rather than showing one anyway", () => {
    /* The product rule, in the one place a failure could break it. A search
       that did not complete must not read as a search that found nothing —
       "no cheaper fare" is a claim, and we did not observe it. */
    const shown = errorMessage(new TypeError("fetch failed"));
    expect(shown).toMatch(/nothing to show/i);
    expect(shown).toMatch(/would rather show you none/i);
  });

  it("reads a zod failure as the field problem it is", () => {
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

  it("does not rewrite a message that is already for a person", () => {
    // A validation message is better than any house sentence about transport.
    expect(errorMessage(new Error("Pick a travel date"))).toBe("Pick a travel date");
  });

  it("is idempotent", () => {
    /* Translating twice destroyed the diagnosis once: the second pass had
       only the sentence to work from, which contains no errno. */
    const once = errorMessage(new TypeError("fetch failed"));
    expect(errorMessage(new Error(once))).toBe(once);
  });

  it("has something to say about a thrown non-error", () => {
    expect(errorMessage("something odd")).toBeTruthy();
    expect(errorMessage(null)).toMatch(/fare board/i);
  });
});

describe("isTransportFailure", () => {
  it("finds the errno undici hides on the cause", () => {
    const error = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    expect(isTransportFailure(error)).toBe(true);
  });

  it("does not call a validation failure a network failure", () => {
    expect(isTransportFailure(new Error("Origin and destination must differ"))).toBe(false);
  });
});

describe("errorDetail", () => {
  it("keeps what the operator needs, including the hostname", () => {
    const error = new TypeError("fetch failed");
    (error as Error & { cause?: unknown }).cause = new Error(
      "getaddrinfo ENOTFOUND www.wanderu.com",
    );
    const detail = errorDetail(error);
    expect(detail).toContain("fetch failed");
    // undici hides the useful half on the cause; without it the log says
    // "fetch failed" and nothing else, which is how an outage goes undiagnosed.
    expect(detail).toContain("ENOTFOUND");
    expect(detail).toContain("wanderu.com");
  });

  it("does not return [object Object] for a thrown shape", () => {
    // A mystery wearing the costume of a diagnosis.
    expect(errorDetail({ status: 503, body: "blocked" })).not.toContain("[object Object]");
  });
});
