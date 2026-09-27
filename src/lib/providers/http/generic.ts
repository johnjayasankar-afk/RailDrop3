import 'server-only';

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
  type RetryPolicy,
} from '../fare-provider';
import { CircuitBreaker, kindForStatus } from '../parse/client';
import { normalizeSearchTrains, type NormalizeOptions } from '../parse/adapter';

const logger = createLogger({ component: 'http-provider' });

/**
 * A fare provider you can point at ANY JSON HTTP API without writing code.
 *
 * Why this exists: there is no free, keyless, sanctioned source of Amtrak fares
 * (see docs/ADR-001-FARE-PROVIDER.md for the evidence). Whichever API you manage
 * to get access to — a marketplace key, a GDS contract, a partner endpoint, your
 * own proxy — this adapter wires it in through configuration alone, and the
 * response lands in the same tolerant normalizer, the same error taxonomy, the
 * same retry/circuit machinery and the same budget accounting as every other
 * provider.
 *
 * Configure with HTTP_PROVIDER_* environment variables. Placeholders available
 * in the URL and body template:
 *   {origin} {destination} {date} {passengers}
 */
export interface HttpProviderConfig {
  /** e.g. https://api.example.com/rail/search?from={origin}&to={destination}&date={date} */
  urlTemplate: string;
  method: 'GET' | 'POST';
  /** JSON body template for POST, with the same placeholders. */
  bodyTemplate?: string | null;
  /** Header name carrying the credential, e.g. 'X-API-Key' or 'Authorization'. */
  authHeader?: string | null;
  /** Header value; '{key}' is replaced with the secret, e.g. 'Bearer {key}'. */
  authValueTemplate?: string | null;
  apiKey?: string | null;
  /** Any additional static headers. */
  extraHeaders?: Record<string, string>;
  timeoutMs: number;
  normalize: NormalizeOptions;
  /** Human label shown in logs and on /api/health. */
  label?: string;
  retryPolicy?: RetryPolicy;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  randomImpl?: () => number;
  circuit?: CircuitBreaker;
}

export function fillTemplate(template: string, request: FareSearchRequest): string {
  return template
    .replaceAll('{origin}', encodeURIComponent(request.originCode.toUpperCase()))
    .replaceAll('{destination}', encodeURIComponent(request.destinationCode.toUpperCase()))
    .replaceAll('{date}', encodeURIComponent(request.date))
    .replaceAll('{passengers}', String(request.passengers));
}

/** Body templates are JSON, so values must not be URL-encoded. */
export function fillJsonTemplate(template: string, request: FareSearchRequest): string {
  return template
    .replaceAll('{origin}', request.originCode.toUpperCase())
    .replaceAll('{destination}', request.destinationCode.toUpperCase())
    .replaceAll('{date}', request.date)
    .replaceAll('{passengers}', String(request.passengers));
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function readNumberHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export class HttpJsonFareProvider implements FareProvider {
  readonly id: string;
  readonly isLive = true;

  private readonly cfg: HttpProviderConfig & {
    retryPolicy: RetryPolicy;
    fetchImpl: typeof fetch;
    sleepImpl: (ms: number) => Promise<void>;
    randomImpl: () => number;
    circuit: CircuitBreaker;
  };

  constructor(config: HttpProviderConfig) {
    if (!config.urlTemplate) {
      throw new ProviderError('HTTP_PROVIDER_URL is not configured', {
        kind: 'BAD_REQUEST',
        retryable: false,
      });
    }
    this.id = config.label ?? 'http';
    this.cfg = {
      ...config,
      retryPolicy: config.retryPolicy ?? DEFAULT_RETRY_POLICY,
      fetchImpl: config.fetchImpl ?? fetch,
      sleepImpl: config.sleepImpl ?? defaultSleep,
      randomImpl: config.randomImpl ?? Math.random,
      circuit: config.circuit ?? new CircuitBreaker(5, 30 * 60_000),
    };
  }

  get circuitState() {
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

        const delay =
          error instanceof ProviderError && error.retryAfterSeconds !== null
            ? error.retryAfterSeconds * 1000
            : backoffDelayMs(attempt, this.cfg.retryPolicy, this.cfg.randomImpl);

        logger.warn('provider call failed, retrying', {
          provider_request_id: ctx.requestId,
          attempt,
          delay_ms: delay,
          kind: error instanceof ProviderError ? error.kind : 'UNKNOWN',
        });
        await this.cfg.sleepImpl(Math.min(delay, this.cfg.retryPolicy.maxDelayMs));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ProviderError('Fare provider call failed', { kind: 'NETWORK' });
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'RailDrop/1.0 (fare monitoring)',
      ...(this.cfg.extraHeaders ?? {}),
    };
    if (this.cfg.method === 'POST') headers['Content-Type'] = 'application/json';
    if (this.cfg.authHeader && this.cfg.apiKey) {
      const template = this.cfg.authValueTemplate || '{key}';
      headers[this.cfg.authHeader] = template.replaceAll('{key}', this.cfg.apiKey);
    }
    return headers;
  }

  private async attempt(
    request: FareSearchRequest,
    ctx: ProviderCallContext,
    attempt: number,
  ): Promise<FareSearchResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);

    // Bind the caller's abort to ours, and always detach so a long-lived signal
    // does not accumulate listeners across thousands of calls.
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    const url = fillTemplate(this.cfg.urlTemplate, request);

    let response: Response;
    try {
      response = await this.cfg.fetchImpl(url, {
        method: this.cfg.method,
        headers: this.buildHeaders(),
        body:
          this.cfg.method === 'POST' && this.cfg.bodyTemplate
            ? fillJsonTemplate(this.cfg.bodyTemplate, request)
            : undefined,
        signal: controller.signal,
      });
    } catch (error) {
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
      const retryAfterHeader = response.headers.get('retry-after');
      throw new ProviderError(`Provider returned HTTP ${response.status}`, {
        kind: kindForStatus(response.status),
        httpStatus: response.status,
        retryAfterSeconds: retryAfterHeader ? Number(retryAfterHeader) || null : null,
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
