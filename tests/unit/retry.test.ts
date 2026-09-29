import { describe, expect, it } from "vitest";
import { isTransientProviderFailure, withRetry } from "@/lib/providers/retry";
import { ProviderRequestError } from "@/lib/providers/fare-provider";

/* The module that decides whether to spend money again, and had no tests.
 *
 * `withRetry` wraps every Parse call at three attempts. Each attempt is a
 * metered request, so the predicate deciding "try again" is a spending
 * decision as much as a correctness one — and it was getting the most
 * expensive case exactly backwards.
 *
 * `parse-fare-provider.ts` detects an Akamai bot block and is explicit about
 * what it wants:
 *
 *     // Akamai blocks are retryable later, but not in a tight loop — Parse
 *     // already burned its proxy attempts.
 *
 * A bot block arrives as HTTP 503. The provider therefore built a
 * ProviderRequestError with `retryable: false, status: 503` — and
 * `isTransientProviderFailure` checked the status before the flag, saw a 5xx,
 * and returned true. Three attempts at 400ms and 800ms, each one billed,
 * against a service that was actively refusing us, which is the one outcome
 * that comment exists to prevent.
 *
 * The rule now: the layer that saw the response body decides. A status code
 * cannot distinguish an overloaded origin from a bot wall.
 */

const nap = async () => {};

describe("isTransientProviderFailure", () => {
  describe("an explicit decision wins over the status code", () => {
    it("does not retry a bot block, which arrives as a 503", () => {
      const blocked = new ProviderRequestError("Blocked", "blocked", false, 503);
      expect(isTransientProviderFailure(blocked)).toBe(false);
    });

    it("does not retry any 5xx the provider marked permanent", () => {
      for (const status of [500, 502, 503, 504, 599]) {
        const error = new ProviderRequestError("no", "http_error", false, status);
        expect(isTransientProviderFailure(error)).toBe(false);
      }
    });

    it("retries a 5xx the provider marked transient", () => {
      const error = new ProviderRequestError("overloaded", "http_error", true, 503);
      expect(isTransientProviderFailure(error)).toBe(true);
    });

    it("retries a 4xx the provider marked transient", () => {
      // The flag wins in both directions: only the provider knows that this
      // particular 409 clears on its own.
      expect(isTransientProviderFailure({ status: 409, retryable: true })).toBe(true);
    });
  });

  describe("the status code is the fallback, for errors that carry no flag", () => {
    it("retries 429 and 5xx", () => {
      for (const status of [429, 500, 502, 503, 504]) {
        expect(isTransientProviderFailure({ status })).toBe(true);
      }
    });

    it("does not retry a request that will fail the same way every time", () => {
      for (const status of [400, 401, 403, 404, 422, 451]) {
        expect(isTransientProviderFailure({ status })).toBe(false);
      }
    });

    it("does not retry a status outside the HTTP range", () => {
      for (const status of [0, -1, 99, 600, 700]) {
        expect(isTransientProviderFailure({ status })).toBe(false);
      }
    });

    it("does not retry something that is not an error object", () => {
      for (const value of [null, undefined, "boom", 503, new Error("plain")]) {
        expect(isTransientProviderFailure(value)).toBe(false);
      }
    });

    it("does not retry a status that is not a number", () => {
      expect(isTransientProviderFailure({ status: "oops" })).toBe(false);
      expect(isTransientProviderFailure({ status: null })).toBe(false);
    });
  });
});

describe("withRetry", () => {
  it("stops the moment the predicate says no, without sleeping", async () => {
    let attempts = 0;
    let slept = 0;
    const blocked = new ProviderRequestError("Blocked", "blocked", false, 503);
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw blocked;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 400,
          maxDelayMs: 4000,
          retryable: isTransientProviderFailure,
          sleep: async (ms) => {
            slept += ms;
          },
        },
      ),
    ).rejects.toBe(blocked);
    // One billed attempt, not three. This is the regression.
    expect(attempts).toBe(1);
    expect(slept).toBe(0);
  });

  it("retries a transient failure up to the cap and then rethrows", async () => {
    let attempts = 0;
    const flaky = { status: 503 };
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw flaky;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 400,
          maxDelayMs: 4000,
          retryable: isTransientProviderFailure,
          sleep: nap,
          random: () => 0,
        },
      ),
    ).rejects.toBe(flaky);
    expect(attempts).toBe(3);
  });

  it("returns the first success and stops", async () => {
    let attempts = 0;
    const value = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 2) throw { status: 500 };
        return "ok";
      },
      {
        maxAttempts: 4,
        baseDelayMs: 10,
        maxDelayMs: 100,
        retryable: isTransientProviderFailure,
        sleep: nap,
        random: () => 0,
      },
    );
    expect(value).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("backs off exponentially, capped, with jitter bounded by the delay", async () => {
    const slept: number[] = [];
    await expect(
      withRetry(async () => Promise.reject({ status: 500 }), {
        maxAttempts: 5,
        baseDelayMs: 400,
        maxDelayMs: 1000,
        retryable: isTransientProviderFailure,
        sleep: async (ms) => {
          slept.push(ms);
        },
        // Maximum jitter, so the cap is tested at its worst.
        random: () => 0.999,
      }),
    ).rejects.toBeTruthy();
    // 400, 800, then capped at 1000 twice. Jitter is min(250, delay/2).
    expect(slept).toHaveLength(4);
    expect(slept[0]!).toBeGreaterThanOrEqual(400);
    expect(slept[0]!).toBeLessThan(400 + 200);
    expect(slept[2]!).toBeLessThanOrEqual(1000 + 250);
    expect(slept[3]!).toBeLessThanOrEqual(1000 + 250);
  });

  it("honours a Retry-After from the provider instead of its own backoff", async () => {
    const slept: number[] = [];
    const limited = new ProviderRequestError("slow down", "rate_limited", true, 429, 12);
    await expect(
      withRetry(async () => Promise.reject(limited), {
        maxAttempts: 2,
        baseDelayMs: 400,
        maxDelayMs: 4000,
        retryable: isTransientProviderFailure,
        sleep: async (ms) => {
          slept.push(ms);
        },
      }),
    ).rejects.toBe(limited);
    expect(slept).toEqual([12_000]);
  });

  it("clamps an absurd Retry-After rather than sleeping through the cycle", async () => {
    const slept: number[] = [];
    // A provider asking us to wait an hour would hold a serverless invocation
    // open until it is killed, and the cycle's deadline is the real bound.
    const limited = new ProviderRequestError("later", "rate_limited", true, 429, 3600);
    await expect(
      withRetry(async () => Promise.reject(limited), {
        maxAttempts: 2,
        baseDelayMs: 400,
        maxDelayMs: 4000,
        retryable: isTransientProviderFailure,
        sleep: async (ms) => {
          slept.push(ms);
        },
      }),
    ).rejects.toBe(limited);
    expect(slept).toEqual([90_000]);
  });
});
