import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, ParseFareProvider, kindForStatus } from '@/lib/providers/parse/client';
import {
  ProviderError,
  ProviderSchemaError,
  backoffDelayMs,
  countsTowardCircuit,
  shouldRetry,
} from '@/lib/providers/fare-provider';
import type { NormalizeOptions } from '@/lib/providers/parse/adapter';
import { makeRequest } from '../helpers/factories';

const NORMALIZE: NormalizeOptions = { pricingBasis: 'UNKNOWN', amountUnit: 'dollars' };
const CTX = { requestId: 'req-1' };

const OK_BODY = {
  status: 'success',
  data: {
    journeySolutionOption: [
      {
        id: 'j1',
        train_number: '179',
        train_name: 'Northeast Regional',
        origin: 'BOS',
        destination: 'NYP',
        departure_time: '2026-09-20T07:05:00',
        arrival_time: '2026-09-20T11:14:00',
        duration: 249,
        transfers: 0,
        fares: [
          {
            fare_family: 'FLX',
            travelClass: 'Coach',
            price: 74,
            availability: 'AVAILABLE',
            seatsRemaining: 9,
          },
        ],
      },
    ],
  },
};

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeProvider(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new ParseFareProvider({
    apiKey: 'pmx_test',
    baseUrl: 'https://api.parse.bot',
    scraperId: 'scraper-123',
    timeoutMs: 1000,
    normalize: NORMALIZE,
    fetchImpl,
    sleepImpl: async () => {},
    randomImpl: () => 0.5,
    ...overrides,
  });
}

describe('ParseFareProvider — request shape', () => {
  it('POSTs the documented body and auth header to the right endpoint', async () => {
    const fetchImpl = vi.fn(async () => response(200, OK_BODY));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    await provider.search(makeRequest({ passengers: 2 }), CTX);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.parse.bot/scraper/scraper-123/search_trains');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('pmx_test');
    expect(JSON.parse(String(init.body))).toEqual({
      origin: 'BOS',
      destination: 'NYP',
      departure_date: '2026-09-20',
      num_adults: 2,
    });
  });

  it('issues exactly ONE call per route/date — never one per train', async () => {
    const fetchImpl = vi.fn(async () => response(200, OK_BODY));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await provider.search(makeRequest(), CTX);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads credit and rate-limit telemetry from response headers', async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, OK_BODY, {
        'x-credits-charged': '2',
        'x-credits-remaining': '4998',
        'x-ratelimit-remaining': '97',
      }),
    );
    const result = await makeProvider(fetchImpl as unknown as typeof fetch).search(
      makeRequest(),
      CTX,
    );
    expect(result.meta.creditsCharged).toBe(2);
    expect(result.meta.creditsRemaining).toBe(4998);
    expect(result.meta.rateLimitRemaining).toBe(97);
  });

  it('refuses to construct without an API key', () => {
    expect(() => makeProvider(fetch, { apiKey: '' })).toThrow(ProviderError);
  });
});

describe('ParseFareProvider — error taxonomy', () => {
  const cases: Array<[number, string, boolean]> = [
    [400, 'BAD_REQUEST', false],
    [401, 'AUTH', false],
    [404, 'NOT_FOUND', false],
    [422, 'STALE_INPUT', false],
    [429, 'RATE_LIMIT', true],
    [500, 'PROVIDER_FAULT', false],
    [502, 'UPSTREAM', true],
    [503, 'BLOCKED', false],
  ];

  it.each(cases)('maps HTTP %i to %s', (status, kind) => {
    expect(kindForStatus(status)).toBe(kind);
  });

  it.each(cases)('surfaces HTTP %i as a typed ProviderError', async (status, kind) => {
    const fetchImpl = vi.fn(async () =>
      response(status, { error: { status: kind.toLowerCase(), message: 'boom' } }),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.search(makeRequest(), CTX)).rejects.toMatchObject({
      kind,
      httpStatus: status,
    });
  });

  it('treats a non-JSON 200 as a schema error, not as no availability', async () => {
    const fetchImpl = vi.fn(async () => response(200, '<html>maintenance</html>'));
    await expect(
      makeProvider(fetchImpl as unknown as typeof fetch).search(makeRequest(), CTX),
    ).rejects.toBeInstanceOf(ProviderSchemaError);
  });

  it('classifies a timeout distinctly from a network failure', async () => {
    const abort = vi.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    await expect(
      makeProvider(abort as unknown as typeof fetch).search(makeRequest(), CTX),
    ).rejects.toMatchObject({ kind: 'TIMEOUT' });

    const netFail = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(
      makeProvider(netFail as unknown as typeof fetch).search(makeRequest(), CTX),
    ).rejects.toMatchObject({ kind: 'NETWORK' });
  });
});

describe('ParseFareProvider — retries', () => {
  it('retries a 429 and succeeds, honouring retry_after', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return response(429, { error: { retry_after: 1 } }, { 'retry-after': '1' });
      }
      return response(200, OK_BODY);
    });

    const provider = makeProvider(fetchImpl as unknown as typeof fetch, {
      sleepImpl: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    const result = await provider.search(makeRequest(), CTX);
    expect(result.journeys).toHaveLength(1);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  it('does NOT retry an auth failure', async () => {
    const fetchImpl = vi.fn(async () => response(401, { error: { message: 'bad key' } }));
    await expect(
      makeProvider(fetchImpl as unknown as typeof fetch).search(makeRequest(), CTX),
    ).rejects.toMatchObject({ kind: 'AUTH' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bounds retries at three attempts total', async () => {
    const fetchImpl = vi.fn(async () => response(502, { error: { message: 'upstream' } }));
    await expect(
      makeProvider(fetchImpl as unknown as typeof fetch).search(makeRequest(), CTX),
    ).rejects.toMatchObject({ kind: 'UPSTREAM' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries a 503 only when the provider says when', async () => {
    const withRetry = new ProviderError('blocked', { kind: 'BLOCKED', retryAfterSeconds: 5 });
    const withoutRetry = new ProviderError('blocked', { kind: 'BLOCKED', retryAfterSeconds: null });
    expect(shouldRetry(withRetry, 1)).toBe(true);
    expect(shouldRetry(withoutRetry, 1)).toBe(false);
  });

  it('uses exponential backoff with full jitter, capped', () => {
    expect(backoffDelayMs(1, undefined, () => 1)).toBe(500);
    expect(backoffDelayMs(2, undefined, () => 1)).toBe(1000);
    expect(backoffDelayMs(3, undefined, () => 1)).toBe(2000);
    expect(backoffDelayMs(20, undefined, () => 1)).toBe(8000);
    // Full jitter means the delay is uniform in [0, exponential).
    expect(backoffDelayMs(3, undefined, () => 0)).toBe(0);
  });
});

describe('circuit breaker', () => {
  let now = 0;
  beforeEach(() => {
    now = 1_000_000;
  });

  it('opens after the configured consecutive failures and recovers after cooldown', () => {
    const circuit = new CircuitBreaker(3, 60_000, () => now);
    circuit.recordFailure();
    circuit.recordFailure();
    expect(circuit.isOpen).toBe(false);
    circuit.recordFailure();
    expect(circuit.isOpen).toBe(true);

    now += 59_000;
    expect(circuit.isOpen).toBe(true);
    now += 2_000;
    expect(circuit.isOpen).toBe(false); // half-open probe allowed
  });

  it('resets on success', () => {
    const circuit = new CircuitBreaker(2, 60_000, () => now);
    circuit.recordFailure();
    circuit.recordSuccess();
    circuit.recordFailure();
    expect(circuit.isOpen).toBe(false);
  });

  it('refuses calls while open', async () => {
    const circuit = new CircuitBreaker(1, 60_000, () => now);
    circuit.recordFailure();
    const fetchImpl = vi.fn(async () => response(200, OK_BODY));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch, { circuit });

    await expect(provider.search(makeRequest(), CTX)).rejects.toMatchObject({
      kind: 'CIRCUIT_OPEN',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not count bad input against provider health', () => {
    expect(countsTowardCircuit(new ProviderError('x', { kind: 'STALE_INPUT' }))).toBe(false);
    expect(countsTowardCircuit(new ProviderError('x', { kind: 'BAD_REQUEST' }))).toBe(false);
    expect(countsTowardCircuit(new ProviderError('x', { kind: 'UPSTREAM' }))).toBe(true);
  });
});
