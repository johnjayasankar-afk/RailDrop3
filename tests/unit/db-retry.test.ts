import { describe, expect, it, vi } from "vitest";
import { withDatabaseRetry } from "@/lib/db/retrying-repository";
import type { RailDropRepository } from "@/lib/db/repository";

/* The database got one attempt; the fare provider got three.
 *
 * On a serverless function talking to pooled Postgres over the public
 * internet, a single failed call is routine — a cold pooler, a reset
 * connection, a connect timeout under load — and it was the end of the
 * request. Somebody retyped a whole trip because one TCP handshake lost a
 * race.
 *
 * The predicate was already written and simply unused: diagnoseDatabase sets
 * `retryWorks` on exactly the faults where trying again could work. Retrying
 * the permanent ones matters as much as retrying the blips — hammering a
 * paused project is how a slow page becomes a slow page that also costs
 * money.
 */

const undici = (code: string, message: string) =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error(message), { code }),
  });

const CONNECT_REFUSED = () => undici("ECONNREFUSED", "connect ECONNREFUSED 1.2.3.4:5432");
const CONNECT_TIMEOUT = () => undici("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error");
const RESET_MID_REQUEST = () => undici("ECONNRESET", "socket hang up");
const SCHEMA_MISSING = () => ({
  message: 'relation "public.watches" does not exist',
  code: "42P01",
  details: "",
  hint: "",
});

/** A repository that fails the first `failures` calls, then succeeds. */
function flaky(failures: number, error: () => unknown) {
  const calls = { getWatch: 0, createWatch: 0 };
  const repo = {
    async getWatch() {
      calls.getWatch += 1;
      if (calls.getWatch <= failures) throw error();
      return { id: "w1" };
    },
    async createWatch() {
      calls.createWatch += 1;
      if (calls.createWatch <= failures) throw error();
      return { id: "w1" };
    },
  } as unknown as RailDropRepository;
  return { repo, calls };
}

const nosleep = { sleep: async () => undefined };

describe("reads", () => {
  it("survive a transient failure instead of losing the page", async () => {
    const { repo, calls } = flaky(2, CONNECT_TIMEOUT);
    const wrapped = withDatabaseRetry(repo, nosleep);
    await expect(wrapped.getWatch("w1")).resolves.toEqual({ id: "w1" });
    expect(calls.getWatch).toBe(3);
  });

  it("are not retried when the fault is permanent", async () => {
    // A missing schema will not fix itself, and three attempts at it is just
    // three times the latency before the same honest error.
    const { repo, calls } = flaky(99, SCHEMA_MISSING);
    const wrapped = withDatabaseRetry(repo, nosleep);
    await expect(wrapped.getWatch("w1")).rejects.toBeTruthy();
    expect(calls.getWatch).toBe(1);
  });

  it("give up and rethrow the real error rather than hanging on", async () => {
    const { repo, calls } = flaky(99, CONNECT_TIMEOUT);
    const wrapped = withDatabaseRetry(repo, { ...nosleep, attempts: 3 });
    await expect(wrapped.getWatch("w1")).rejects.toThrow(/fetch failed/);
    expect(calls.getWatch).toBe(3);
  });
});

describe("writes", () => {
  it("retry when the connection was never established", async () => {
    // Nothing was delivered, so nothing can have been applied twice.
    const { repo, calls } = flaky(1, CONNECT_REFUSED);
    const wrapped = withDatabaseRetry(repo, nosleep);
    await expect(wrapped.createWatch({} as never)).resolves.toEqual({ id: "w1" });
    expect(calls.createWatch).toBe(2);
  });

  it("do NOT retry a failure that happened mid-request", async () => {
    /* The one that matters. A socket that hung up after the request went out
       may well have applied it, and re-running the write would create a
       second watch. `retryWorks` is true for this fault — it is genuinely
       worth retrying a READ — and a write still must not. A duplicated trip
       is a worse outcome than an honest error, and the honest error is now a
       good one. */
    const { repo, calls } = flaky(1, RESET_MID_REQUEST);
    const wrapped = withDatabaseRetry(repo, nosleep);
    await expect(wrapped.createWatch({} as never)).rejects.toBeTruthy();
    expect(calls.createWatch).toBe(1);
  });
});

describe("the wrapper itself", () => {
  it("covers methods nobody remembered to list", async () => {
    // A proxy rather than a hand-written wrapper, so a method added next
    // year is covered without anyone editing this file.
    let calls = 0;
    const repo = {
      async somethingAddedLater() {
        calls += 1;
        if (calls === 1) throw CONNECT_TIMEOUT();
        return "ok";
      },
    } as unknown as RailDropRepository & { somethingAddedLater(): Promise<string> };
    const wrapped = withDatabaseRetry(repo, nosleep);
    await expect(wrapped.somethingAddedLater()).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("backs off, and keeps the waits short enough to sit inside a request", async () => {
    const waits: number[] = [];
    const { repo } = flaky(2, CONNECT_TIMEOUT);
    const wrapped = withDatabaseRetry(repo, {
      sleep: async (ms) => void waits.push(ms),
      baseDelayMs: 120,
    });
    await wrapped.getWatch("w1");
    expect(waits).toEqual([120, 240]);
    // Somebody is waiting on this request; a retry that outlasts their
    // patience is a timeout wearing a helpful face.
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThan(1000);
  });

  it("passes arguments and `this` through untouched", async () => {
    const seen: unknown[] = [];
    const repo = {
      async getWatch(...args: unknown[]) {
        seen.push(args);
        return null;
      },
    } as unknown as RailDropRepository;
    await withDatabaseRetry(repo, nosleep).getWatch("abc");
    expect(seen).toEqual([["abc"]]);
  });
});
