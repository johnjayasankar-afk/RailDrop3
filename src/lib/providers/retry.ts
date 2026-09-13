export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryable: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isTransientProviderFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = "status" in error ? Number(error.status) : undefined;
  const retryable = "retryable" in error ? Boolean(error.retryable) : false;
  if (status === 401 || status === 400 || status === 404 || status === 422) return false;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  return retryable;
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
