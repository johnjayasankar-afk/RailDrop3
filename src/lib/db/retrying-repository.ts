import { diagnoseDatabase } from "./diagnosis";
import { logger } from "@/lib/logger";
import type { RailDropRepository } from "./repository";

/* One blip should not lose a trip.
 *
 * The fare provider retries. The database never did — a single failed call
 * was the end of the request, and on a serverless function talking to a
 * pooled Postgres over the public internet, a single failed call is a
 * routine event: a cold pooler, a reset connection, a connect timeout under
 * load. The traveller retyped their whole trip because one TCP handshake
 * lost a race.
 *
 * The knowledge needed to do better was already here and simply unused.
 * `diagnoseDatabase` classifies a failure into six faults and sets
 * `retryWorks` on exactly the ones where trying again could plausibly
 * succeed — that is the predicate a retry wants, and nothing consumed it for
 * an actual retry. A deleted project or an unapplied schema is retried zero
 * times, which matters as much as retrying the blips: hammering a paused
 * database is how a slow page becomes a slow page that also costs money.
 *
 * READS AND WRITES ARE NOT THE SAME BET, and this is the part worth being
 * careful about. Re-running a read is free and cannot be observed. Re-running
 * a write can apply it twice, because a request that failed on the way back
 * still landed. So a write is retried only when the failure happened during
 * CONNECT — no connection was established, so nothing can have been applied.
 * A timeout mid-request is ambiguous and is not retried, even though
 * `retryWorks` is true for it: a duplicated watch is a worse outcome than an
 * honest error, and the honest error is now a good one.
 */

/** Methods that change something. Everything else is a read. */
const WRITES = new Set<string>([
  "upsertProfile",
  "createWatch",
  "updateWatch",
  "deleteWatch",
  "insertCycle",
  "updateCycle",
  "leaseScheduledRun",
  "finishScheduledRun",
  "reclaimScheduledRun",
  "abandonScheduledRun",
  "insertProviderRequest",
  "markSearchInFlight",
  "finishProviderRequest",
  "insertDateSnapshot",
  "insertJourneys",
  "cacheJourneys",
  "insertAlert",
  "insertAlertDecision",
  "suppressEmail",
  "insertNotification",
  "insertPriceEvent",
  "incrementUsage",
  "upsertStations",
]);

/**
 * Failures that provably never reached the server.
 *
 * A connect-phase error means no bytes were delivered, so re-running a write
 * cannot duplicate anything. Anything after connect — a reset, a timeout
 * waiting for a response — may have been applied and is not safe to repeat.
 */
const CONNECT_PHASE = [
  "econnrefused",
  "enotfound",
  "eai_again",
  "und_err_connect_timeout",
  "connect timeout",
  "ehostunreach",
  "enetunreach",
];

function text(error: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") return void parts.push(value);
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of ["message", "code", "details", "errno"]) {
      const found = record[key];
      if (typeof found === "string" || typeof found === "number") parts.push(String(found));
    }
    visit(record.cause, depth + 1);
  };
  visit(error, 0);
  if (error instanceof Error) parts.push(error.message);
  return parts.join(" ").toLowerCase();
}

function neverReachedTheServer(error: unknown): boolean {
  const haystack = text(error);
  return CONNECT_PHASE.some((sign) => haystack.includes(sign));
}

export interface RetryPolicy {
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wrap a repository so transient failures are retried.
 *
 * A proxy rather than a subclass, so it covers every method — including ones
 * added later, which is the failure mode a hand-written wrapper has.
 */
export function withDatabaseRetry<T extends RailDropRepository>(
  repo: T,
  policy: RetryPolicy = {},
): T {
  const attempts = policy.attempts ?? 3;
  const baseDelayMs = policy.baseDelayMs ?? 120;
  const sleep = policy.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return new Proxy(repo, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || typeof property !== "string") return value;
      const isWrite = WRITES.has(property);

      return async function retrying(this: unknown, ...args: unknown[]) {
        let lastError: unknown;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          try {
            return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          } catch (error) {
            lastError = error;
            const { fault, retryWorks } = diagnoseDatabase(error);
            const safe = isWrite ? neverReachedTheServer(error) : retryWorks;
            if (!safe || attempt === attempts) break;
            /* Exponential, with the delays kept short on purpose: this sits
               inside a request somebody is waiting on, and a retry that
               outlasts their patience is a timeout wearing a helpful face. */
            const delay = baseDelayMs * 2 ** (attempt - 1);
            logger.warn("db.retrying", { method: property, attempt, fault, delayMs: delay });
            await sleep(delay);
          }
        }
        throw lastError;
      };
    },
  }) as T;
}
