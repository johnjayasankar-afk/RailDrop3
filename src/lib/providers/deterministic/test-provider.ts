/**
 * DeterministicFareProvider - a fully offline provider that produces stable,
 * realistic journeys from a seed derived from (route, date, passengers).
 *
 * It exists so the entire pipeline (planner -> provider -> normalizer -> ranking
 * -> alerting -> email) can be exercised in integration and E2E tests without
 * spending a single external credit.
 *
 * It is NEVER permitted to run in production: see `createFareProvider()`.
 */

import { addDays, type CalendarDate } from '@/lib/domain/dates';
import type { FareSearchRequest, FareSearchResult, ProviderMetadata } from '@/lib/domain/types';
import { ProviderError, type FareProvider, type ProviderCallContext } from '../fare-provider';
import { normalizeSearchTrains, type NormalizeOptions } from '../parse/adapter';

export interface DeterministicOptions {
  normalize: NormalizeOptions;
  /** Dates for which the provider raises an error (partial-failure testing). */
  failDates?: ReadonlySet<CalendarDate>;
  /** Error kind raised for failDates. Defaults to a transient UPSTREAM failure. */
  failKind?: 'UPSTREAM' | 'STALE_INPUT' | 'RATE_LIMIT' | 'AUTH';
  /** Dates that legitimately return zero journeys (no-availability testing). */
  emptyDates?: ReadonlySet<CalendarDate>;
  latencyMs?: number;
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SERVICES = [
  { name: 'Northeast Regional', prefix: 1, bus: false },
  { name: 'Acela', prefix: 2, bus: false },
  { name: 'Vermonter', prefix: 5, bus: false },
  { name: 'Thruway Bus', prefix: 6, bus: true },
] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Builds a payload in the *provider's* shape (not the domain shape) so the real
 * normalizer is exercised end to end rather than bypassed.
 */
export function buildDeterministicPayload(request: FareSearchRequest): unknown {
  const seed = hashString(`${request.originCode}|${request.destinationCode}|${request.date}`);
  const rand = mulberry32(seed);
  const journeyCount = 5 + Math.floor(rand() * 3);

  // Route base price, then a per-date swing so different dates differ materially.
  const basePrice = 7400 + (seed % 2600);
  const dateSwing = Math.floor(rand() * 2800) - 1200;

  const journeys = Array.from({ length: journeyCount }, (_, i) => {
    const service = SERVICES[Math.floor(rand() * SERVICES.length)] ?? SERVICES[0];
    const departHour = 5 + i * 2 + Math.floor(rand() * 2);
    const departMinute = [0, 5, 15, 25, 40, 50][Math.floor(rand() * 6)] ?? 0;
    const durationMinutes = 210 + Math.floor(rand() * 150) + (service.bus ? 90 : 0);
    const transfers = service.bus ? 0 : rand() < 0.25 ? 1 : 0;

    const departMinutes = departHour * 60 + departMinute;
    const arriveMinutes = departMinutes + durationMinutes;
    const arriveDate = arriveMinutes >= 1440 ? addDays(request.date, 1) : request.date;
    const arriveOfDay = arriveMinutes % 1440;

    const trainNumber = service.prefix * 100 + 3 + i * 8;
    const spread = Math.floor(rand() * 3400) - 800;
    const flexible = Math.max(5200, basePrice + dateSwing + spread);
    const value = Math.round(flexible * 0.82);
    const saver = Math.round(flexible * 0.7);

    const legs = [
      {
        origin: request.originCode,
        destination: transfers === 1 ? 'PVD' : request.destinationCode,
        departure_time: `${request.date}T${pad(departHour)}:${pad(departMinute)}:00`,
        arrival_time:
          transfers === 1
            ? `${request.date}T${pad(Math.floor((departMinutes + 70) / 60))}:${pad((departMinutes + 70) % 60)}:00`
            : `${arriveDate}T${pad(Math.floor(arriveOfDay / 60))}:${pad(arriveOfDay % 60)}:00`,
        mode: service.bus ? 'BUS' : 'TRAIN',
        train_name: service.name,
        train_number: String(trainNumber),
      },
    ];
    if (transfers === 1) {
      legs.push({
        origin: 'PVD',
        destination: request.destinationCode,
        departure_time: `${request.date}T${pad(Math.floor((departMinutes + 100) / 60))}:${pad((departMinutes + 100) % 60)}:00`,
        arrival_time: `${arriveDate}T${pad(Math.floor(arriveOfDay / 60))}:${pad(arriveOfDay % 60)}:00`,
        mode: 'TRAIN',
        train_name: service.name,
        train_number: String(trainNumber + 1),
      });
    }

    const seats = 1 + Math.floor(rand() * 40);

    return {
      id: `det-${request.originCode}${request.destinationCode}-${request.date}-${i}`,
      train_number: String(trainNumber),
      train_name: service.name,
      origin: request.originCode,
      destination: request.destinationCode,
      departure_time: `${request.date}T${pad(departHour)}:${pad(departMinute)}:00`,
      arrival_time: `${arriveDate}T${pad(Math.floor(arriveOfDay / 60))}:${pad(arriveOfDay % 60)}:00`,
      duration: durationMinutes,
      transfers,
      travelLegs: legs,
      fares: [
        {
          fare_family: 'FLX',
          travelClass: 'Coach',
          price: flexible / 100,
          currency: 'USD',
          availability: seats > 0 ? 'AVAILABLE' : 'SOLD_OUT',
          seatsRemaining: seats,
        },
        {
          fare_family: 'VLU',
          travelClass: 'Coach',
          price: value / 100,
          currency: 'USD',
          availability: 'AVAILABLE',
          seatsRemaining: seats,
        },
        {
          fare_family: 'SVR',
          travelClass: 'Coach',
          price: saver / 100,
          currency: 'USD',
          availability: rand() < 0.4 ? 'SOLD_OUT' : 'AVAILABLE',
          seatsRemaining: seats,
        },
      ],
    };
  });

  return { status: 'success', data: { journeySolutionOption: journeys } };
}

export class DeterministicFareProvider implements FareProvider {
  readonly id = 'deterministic';
  readonly isLive = false;

  constructor(private readonly options: DeterministicOptions) {}

  async search(request: FareSearchRequest, ctx: ProviderCallContext): Promise<FareSearchResult> {
    const latency = this.options.latencyMs ?? 5;
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));

    if (this.options.failDates?.has(request.date)) {
      const kind = this.options.failKind ?? 'UPSTREAM';
      throw new ProviderError(`Deterministic provider failure for ${request.date}`, {
        kind,
        httpStatus: kind === 'STALE_INPUT' ? 422 : 502,
        retryable: false,
      });
    }

    const payload = this.options.emptyDates?.has(request.date)
      ? { status: 'success', data: { journeySolutionOption: [] } }
      : buildDeterministicPayload(request);

    const meta: Omit<ProviderMetadata, 'schemaAliases'> = {
      providerId: this.id,
      requestId: ctx.requestId,
      fetchedAt: new Date().toISOString(),
      latencyMs: latency,
      httpStatus: 200,
      creditsCharged: 0,
      creditsRemaining: null,
      rateLimitRemaining: null,
      deduplicated: false,
    };

    return normalizeSearchTrains(payload, request, meta, this.options.normalize);
  }
}

function parseDateSet(value: string | undefined): ReadonlySet<CalendarDate> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function createDeterministicProviderFromEnv(
  normalize: NormalizeOptions,
): DeterministicFareProvider {
  return new DeterministicFareProvider({
    normalize,
    failDates: parseDateSet(process.env.DETERMINISTIC_FAIL_DATES),
    emptyDates: parseDateSet(process.env.DETERMINISTIC_EMPTY_DATES),
  });
}
