import 'server-only';

import { getServerEnv } from '@/lib/env';
import { createLogger } from '@/lib/log';
import type { FareSearchRequest, FareSearchResult, ProviderMetadata } from '@/lib/domain/types';
import {
  DEFAULT_RETRY_POLICY,
  ProviderError,
  ProviderSchemaError,
  backoffDelayMs,
  countsTowardCircuit,
  shouldRetry,
  type FareProvider,
  type ProviderCallContext,
  type ProviderErrorKind,
  type RetryPolicy,
} from '../fare-provider';
import { normalizeSearchTrains, type NormalizeOptions } from './adapter';

const logger = createLogger({ component: 'parse-provider' });

export interface ParseProviderConfig {
  apiKey: string;
  baseUrl: string;
  scraperId: string;
  timeoutMs: number;
  normalize: NormalizeOptions;
  retryPolicy?: RetryPolicy;
  /** Injectable for deterministic tests. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  randomImpl?: () => number;
  circuit?: CircuitBreaker;
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────

export interface CircuitState {
  open: boolean;
  consecutiveFailures: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get isOpen(): boolean {
    if (this.openedAt === null) return false;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      // Half-open: allow one probe through.
      this.openedAt = null;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) this.openedAt = this.now();
  }

  get state(): CircuitState {
    return {
      open: this.isOpen,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
    };
  }
}

// ─── Error mapping (see docs/ADR-001) ────────────────────────────────────────

const STATUS_TO_KIND: Record<number, ProviderErrorKind> = {
  400: 'BAD_REQUEST',
  401: 'AUTH',
  403: 'AUTH',
  404: 'NOT_FOUND',
  422: 'STALE_INPUT',
  429: 'RATE_LIMIT',
  500: 'PROVIDER_FAULT',
  502: 'UPSTREAM',
  503: 'BLOCKED',
};

export function kindForStatus(status: number): ProviderErrorKind {
  const mapped = STATUS_TO_KIND[status];
  if (mapped) return mapped;
  if (status >= 500) return 'UPSTREAM';
  if (status >= 400) return 'BAD_REQUEST';
  return 'PROVIDER_FAULT';
}

function readRetryAfter(headers: Headers, body: unknown): number | null {
  const header = headers.get('retry-after');
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n)) return n;
  }
  if (body && typeof body === 'object') {
    const error = (body as { error?: Record<string, unknown> }).error;
    const value = error?.retry_after ?? (body as Record<string, unknown>).retry_after;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readNumberHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function errorMessageFrom(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: Record<string, unknown> }).error;
    const message = error?.message ?? (body as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return `Provider returned HTTP ${status}`;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ─── Provider ────────────────────────────────────────────────────────────────

export class ParseFareProvider implements FareProvider {
  readonly id = 'parse';
  readonly isLive = true;

  private readonly cfg: Required<
    Pick<ParseProviderConfig, 'apiKey' | 'baseUrl' | 'scraperId' | 'timeoutMs' | 'normalize'>
  > & {
    retryPolicy: RetryPolicy;
    fetchImpl: typeof fetch;
    sleepImpl: (ms: number) => Promise<void>;
    randomImpl: () => number;
    circuit: CircuitBreaker;
  };

  constructor(config: ParseProviderConfig) {
    if (!config.apiKey) {
      throw new ProviderError('PARSE_API_KEY is not configured', {
        kind: 'AUTH',
        retryable: false,
      });
    }
    this.cfg = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      scraperId: config.scraperId,
      timeoutMs: config.timeoutMs,
      normalize: config.normalize,
      retryPolicy: config.retryPolicy ?? DEFAULT_RETRY_POLICY,
      fetchImpl: config.fetchImpl ?? fetch,
      sleepImpl: config.sleepImpl ?? defaultSleep,
      randomImpl: config.randomImpl ?? Math.random,
      circuit: config.circuit ?? new CircuitBreaker(5, 30 * 60_000),
    };
  }

  get endpointUrl(): string {
    return `${this.cfg.baseUrl}/scraper/${this.cfg.scraperId}/search_trains`;
  }

  get circuitState(): CircuitState {
    return this.cfg.circuit.state;
  }

  async search(request: FareSearchRequest, ctx: ProviderCallContext): Promise<FareSearchResult> {
    if (this.cfg.circuit.isOpen) {
      throw new ProviderError('Fare provider circuit is open; skipping call', {
        kind: 'CIRCUIT_OPEN',
        retryable: false,
      });
    }

    let attempt = 0;
    let lastError: unknown;

    while (attempt < this.cfg.retryPolicy.maxAttempts) {
      attempt += 1;
      try {
        const result = await this.attempt(request, ctx, attempt);
        this.cfg.circuit.recordSuccess();
        return result;
      } catch (error) {
        lastError = error;
        if (countsTowardCircuit(error)) this.cfg.circuit.recordFailure();

        if (!shouldRetry(error, attempt, this.cfg.retryPolicy)) break;

        const retryAfter =
          error instanceof ProviderError && error.retryAfterSeconds !== null
            ? error.retryAfterSeconds * 1000
            : backoffDelayMs(attempt, this.cfg.retryPolicy, this.cfg.randomImpl);

        logger.warn('provider call failed, retrying', {
          provider_request_id: ctx.requestId,
          cycle_id: ctx.cycleId,
          attempt,
          delay_ms: retryAfter,
          kind: error instanceof ProviderError ? error.kind : 'UNKNOWN',
        });
        await this.cfg.sleepImpl(Math.min(retryAfter, this.cfg.retryPolicy.maxDelayMs));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ProviderError('Fare provider call failed', { kind: 'NETWORK' });
  }

  private async attempt(
    request: FareSearchRequest,
    ctx: ProviderCallContext,
    attempt: number,
  ): Promise<FareSearchResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    // Always detach: a long-lived caller signal would otherwise accumulate one
    // listener per attempt across thousands of calls.
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    let response: Response;
    try {
      response = await this.cfg.fetchImpl(this.endpointUrl, {
        method: 'POST',
        headers: {
          'X-API-Key': this.cfg.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'RailDrop/1.0 (fare monitoring)',
        },
        body: JSON.stringify({
          origin: request.originCode.toUpperCase(),
          destination: request.destinationCode.toUpperCase(),
          departure_date: request.date,
          num_adults: request.passengers,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new ProviderError(
        aborted ? `Provider timed out after ${this.cfg.timeoutMs}ms` : 'Provider network failure',
        { kind: aborted ? 'TIMEOUT' : 'NETWORK', details: { attempt } },
      );
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
    }

    const latencyMs = Date.now() - startedAt;
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    const meta: Omit<ProviderMetadata, 'schemaAliases'> = {
      providerId: this.id,
      requestId: ctx.requestId,
      fetchedAt: new Date().toISOString(),
      latencyMs,
      httpStatus: response.status,
      creditsCharged: readNumberHeader(response.headers, 'x-credits-charged'),
      creditsRemaining: readNumberHeader(response.headers, 'x-credits-remaining'),
      rateLimitRemaining: readNumberHeader(response.headers, 'x-ratelimit-remaining'),
      deduplicated: false,
    };

    if (!response.ok) {
      throw new ProviderError(errorMessageFrom(body, response.status), {
        kind: kindForStatus(response.status),
        httpStatus: response.status,
        retryAfterSeconds: readRetryAfter(response.headers, body),
        details: { attempt, latencyMs, snippet: text.slice(0, 400) },
      });
    }

    if (body === null) {
      throw new ProviderSchemaError('Provider returned a non-JSON 200 response', {
        snippet: text.slice(0, 400),
      });
    }

    return normalizeSearchTrains(body, request, meta, this.cfg.normalize);
  }
}

export function createParseProviderFromEnv(
  overrides: Partial<ParseProviderConfig> = {},
): ParseFareProvider {
  const env = getServerEnv();
  return new ParseFareProvider({
    apiKey: env.parseApiKey,
    baseUrl: env.parseBaseUrl,
    scraperId: env.parseScraperId,
    timeoutMs: env.providerTimeoutMs,
    normalize: { pricingBasis: env.pricingBasis, amountUnit: env.amountUnit },
    circuit: new CircuitBreaker(env.circuitFailures, env.circuitCooldownMinutes * 60_000),
    ...overrides,
  });
}
