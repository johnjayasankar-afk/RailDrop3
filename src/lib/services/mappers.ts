import 'server-only';

import { toDateString, toIsoString } from '@/lib/format';
import type { WatchRow } from '@/lib/db/types';
import type {
  FareFamily,
  Journey,
  TravelClass,
  Watch,
  WatchPreferences,
  WatchStatus,
} from '@/lib/domain/types';

function asFareFamily(value: string): FareFamily {
  return value === 'FLEXIBLE' || value === 'VALUE' || value === 'SAVER' ? value : 'UNKNOWN';
}

function asTravelClass(value: string): TravelClass {
  return value === 'COACH' || value === 'BUSINESS' || value === 'FIRST' || value === 'SLEEPER'
    ? value
    : 'UNKNOWN';
}

function asStatus(value: string): WatchStatus {
  return value === 'ACTIVE' ||
    value === 'PAUSED' ||
    value === 'COMPLETED' ||
    value === 'NEEDS_ATTENTION'
    ? value
    : 'PAUSED';
}

function asFlexibility(value: number): 0 | 1 | 2 {
  return value === 0 || value === 2 ? value : 1;
}

export function toWatch(row: WatchRow): Watch {
  const preferences: WatchPreferences = {
    dateFlexibilityDays: asFlexibility(row.date_flexibility_days),
    travelClass: asTravelClass(row.travel_class),
    benchmarkFareFamily: asFareFamily(row.benchmark_fare_family),
    includeThruway: row.include_thruway,
    includeRestrictedFares: row.include_restricted_fares,
    minimumSavingsCents: row.minimum_savings_cents,
    targetPriceCents: row.target_price_cents ?? null,
    preferredDepartureMinutes: row.preferred_departure_minutes,
  };
  return {
    id: row.id,
    userId: row.user_id,
    originCode: row.origin_code,
    destinationCode: row.destination_code,
    desiredDate: toDateString(row.desired_date),
    passengers: row.passengers,
    benchmarkCents: row.benchmark_cents,
    benchmarkVersion: row.benchmark_version,
    timezone: row.timezone,
    status: asStatus(row.status),
    monitoringStartsAt: toIsoString(row.monitoring_starts_at),
    monitoringEndsAt: toIsoString(row.monitoring_ends_at),
    preferences,
  };
}

export function journeyToRow(journey: Journey): Record<string, unknown> {
  return {
    provider_journey_id: journey.providerJourneyId,
    service_name: journey.serviceName,
    train_number: journey.trainNumber,
    origin_code: journey.originCode,
    destination_code: journey.destinationCode,
    departure_local: journey.departureLocal,
    arrival_local: journey.arrivalLocal,
    duration_minutes: journey.durationMinutes,
    transfers: journey.transfers,
    travel_date: journey.travelDate,
    service_type: journey.serviceType,
    booking_url: journey.bookingUrl,
    legs: journey.legs,
  };
}

export { toDateString, toIsoString };
