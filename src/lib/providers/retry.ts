export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryable: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Is this worth trying again in a moment?
 *
 * The status code used to be consulted before the error's own `retryable`
 * flag, and 5xx short-circuited to true. That silently defeated the one place
 * in the codebase that had thought carefully about the question.
 * `parse-fare-provider.ts` detects an Akamai bot block and writes:
 *
 *     // Akamai blocks are retryable later, but not in a tight loop — Parse
 *     // already burned its proxy attempts.
 *     const retryable = !blocked && (status === 429 || status >= 500 || ...)
 *
 * A bot block arrives as 503. So the provider constructed a ProviderRequestError
 * carrying `retryable: false, status: 503`, handed it to `withRetry`, and this
 * function looked at the 503 and said yes — three attempts at 400ms and 800ms,
 * each one a metered Parse request, hammering a service that was blocking us,
 * which is precisely and only what that comment exists to prevent.
 *
 * So an explicit flag wins, in both directions. The layer that saw the response
 * body knows things a status code cannot carry: whether the 503 is an
 * overloaded origin or a bot wall, whether a 404 is a bad station or a bad
 * deploy. Status codes are the fallback for errors that arrive without one —
 * a bare `{ status: 502 }` from somewhere that never modelled retryability.
 */
export function isTransientProviderFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  if ("retryable" in error) {
    return Boolean((error as { retryable?: unknown }).retryable);
  }

  const status = "status" in error ? Number((error as { status?: unknown }).status) : Number.NaN;
  if (!Number.isFinite(status)) return false;
  // 429 and 5xx only. Everything else — including a 404 or a 422 — is a
  // request that will fail the same way however many times we send it.
  return status === 429 || (status >= 500 && status < 600);
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === options.maxAttempts || !options.retryable(error)) {
        throw error;
      }
      const retryAfter = retryAfterSeconds(error);
      if (retryAfter != null) {
        await sleep(Math.min(retryAfter, 90) * 1000);
        continue;
      }
      const exp = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(random() * Math.min(250, exp / 2));
      await sleep(exp + jitter);
    }
  }
  throw lastError;
}

function retryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("retryAfterSeconds" in error)) return null;
  const value = Number((error as { retryAfterSeconds?: number }).retryAfterSeconds);
  return Number.isFinite(value) && value > 0 ? value : null;
}
