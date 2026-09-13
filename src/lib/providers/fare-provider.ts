import 'server-only';

import type { FareSearchRequest, FareSearchResult } from '@/lib/domain/types';

/**
 * The seam between RailDrop and any fare source. Swapping providers must never
 * require a change under src/lib/domain.
 */
export interface FareProvider {
  readonly id: string;
  /** false means "must never run in production" - enforced by the factory. */
  readonly isLive: boolean;
  search(request: FareSearchRequest, ctx: ProviderCallContext): Promise<FareSearchResult>;
}

export interface ProviderCallContext {
  /** Correlation id for this single external call. */
  requestId: string;
  cycleId?: string;
  watchId?: string;
  signal?: AbortSignal;
}

export const PROVIDER_ERROR_KINDS = [
  'AUTH',
  'BAD_REQUEST',
  'NOT_FOUND',
  'STALE_INPUT',
  'RATE_LIMIT',
  'UPSTREAM',
  'BLOCKED',
  'PROVIDER_FAULT',
  'SCHEMA',
  'TIMEOUT',
  'NETWORK',
  'BUDGET',
  'CIRCUIT_OPEN',
] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

export interface ProviderErrorOptions {
  kind: ProviderErrorKind;
  httpStatus?: number | null;
  retryable?: boolean;
  retryAfterSeconds?: number | null;
  details?: Record<string, unknown>;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;
  readonly details: Record<string, unknown>;

  constructor(message: string, opts: ProviderErrorOptions) {
    super(message);
    this.name = 'ProviderError';
    this.kind = opts.kind;
    this.httpStatus = opts.httpStatus ?? null;
    this.retryable = opts.retryable ?? DEFAULT_RETRYABLE.has(opts.kind);
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
    this.details = opts.details ?? {};
  }
}

/**
 * A response we could not recognise. Raised loudly so a schema change surfaces as
 * a provider failure and is NEVER mistaken for "no cheaper fares found".
 */
export class ProviderSchemaError extends ProviderError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { kind: 'SCHEMA', retryable: false, details });
    this.name = 'ProviderSchemaError';
  }
}

const DEFAULT_RETRYABLE = new Set<ProviderErrorKind>([
  'RATE_LIMIT',
  'TIMEOUT',
  'NETWORK',
  'UPSTREAM',
]);

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3, // 1 initial + 2 retries
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

/**
 * Exponential backoff with full jitter. `random` is injectable so tests are
 * deterministic.
 */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(
    policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
    policy.maxDelayMs,
  );
  return Math.floor(random() * exponential);
}

export function shouldRetry(
  error: unknown,
  attempt: number,
  policy = DEFAULT_RETRY_POLICY,
): boolean {
  if (attempt >= policy.maxAttempts) return false;
  if (!(error instanceof ProviderError)) return false;
  if (error.kind === 'BLOCKED') return error.retryAfterSeconds !== null;
  return error.retryable;
}

/** Errors that count towards opening the circuit breaker. */
export function countsTowardCircuit(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return true;
  // Bad input for one date says nothing about provider health.
  return error.kind !== 'STALE_INPUT' && error.kind !== 'BAD_REQUEST';
}
