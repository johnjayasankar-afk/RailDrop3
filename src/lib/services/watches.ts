import 'server-only';

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  assertCalendarDate,
  compareDates,
  isValidTimeZone,
  todayInTimeZone,
} from '@/lib/domain/dates';
import { dollarsToCents } from '@/lib/domain/money';
import { zonedTimeToInstant } from '@/lib/domain/schedule';
import { getServerEnv } from '@/lib/env';
import { createLogger } from '@/lib/log';
import type { WatchRow } from '@/lib/db/types';
import { getUserSearchCount } from './usage';

const logger = createLogger({ component: 'watches' });

export const MONITORING_PRESETS = ['24H', '48H', '72H', 'UNTIL_DEPARTURE', 'CUSTOM'] as const;
export type MonitoringPreset = (typeof MONITORING_PRESETS)[number];

const stationCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Station code must be 3 letters');

const money = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try {
    return dollarsToCents(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid amount, for example 128.50' });
    return z.NEVER;
  }
});

const clockTime = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, for example 07:05')
  .optional()
  .nullable();

export const createWatchSchema = z
  .object({
    originCode: stationCode,
    destinationCode: stationCode,
    desiredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date'),
    passengers: z.coerce.number().int().min(1).max(8).default(1),
    amountPaid: money,
    dateFlexibilityDays: z.coerce
      .number()
      .int()
      .refine((v) => v === 0 || v === 1 || v === 2)
      .default(1),
    travelClass: z.enum(['COACH', 'BUSINESS', 'FIRST', 'SLEEPER']).default('COACH'),
    fareFamily: z.enum(['FLEXIBLE', 'VALUE', 'SAVER']).default('FLEXIBLE'),
    preferredDepartureTime: clockTime,
    monitoringPreset: z.enum(MONITORING_PRESETS).default('48H'),
    customMonitoringHours: z.coerce.number().int().min(1).max(720).optional().nullable(),
    minimumSavings: money.optional(),
    targetPrice: money.optional().nullable(),
    // A round trip is two legs, each with its own receipt total. RailDrop
    // never splits one combined amount across two dates — that would be
    // inventing the number this product exists to avoid inventing.
    returnDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
      .optional()
      .nullable(),
    returnAmountPaid: money.optional().nullable(),
    includeThruway: z.coerce.boolean().default(false),
    includeRestrictedFares: z.coerce.boolean().default(false),
    timezone: z.string().default('America/New_York'),
    originalTrainNumber: z.string().trim().max(20).optional().nullable(),
    originalDepartureTime: clockTime,
  })
  .refine((v) => v.originCode !== v.destinationCode, {
    message: 'Origin and destination must be different stations',
    path: ['destinationCode'],
  })
  .refine((v) => v.monitoringPreset !== 'CUSTOM' || Boolean(v.customMonitoringHours), {
    message: 'Enter how many hours to monitor',
    path: ['customMonitoringHours'],
  })
  .refine(
    (v) => !v.returnDate || (v.returnAmountPaid !== null && v.returnAmountPaid !== undefined),
    {
      // RailDrop never splits one combined receipt total across two legs —
      // that would be inventing the number the product exists not to invent.
      message: 'Enter what you paid for the return leg',
      path: ['returnAmountPaid'],
    },
  )
  .refine((v) => !v.returnDate || v.returnDate >= v.desiredDate, {
    message: 'The return has to be on or after the outbound date',
    path: ['returnDate'],
  })
  .refine(
    (v) => v.targetPrice === null || v.targetPrice === undefined || v.targetPrice < v.amountPaid,
    {
      // A target at or above what you paid is met by the very first check and
      // then by every check after it — an alert generator, not a target.
      message: 'A target has to be below what you paid',
      path: ['targetPrice'],
    },
  );

export type CreateWatchInput = z.infer<typeof createWatchSchema>;

export const rebookSchema = z.object({
  amountPaid: money,
  travelDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  trainNumber: z.string().trim().max(20).optional().nullable(),
  departureTime: clockTime,
  fareFamily: z.enum(['FLEXIBLE', 'VALUE', 'SAVER']).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export type RebookInput = z.infer<typeof rebookSchema>;

export function clockToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const [h, m] = value.split(':').map(Number);
  if (h === undefined || m === undefined) return null;
  return h * 60 + m;
}

/**
 * The monitoring window. Always capped at the end of the desired travel day in
 * the watch's timezone: once the train has gone, there is nothing to rebook.
 */
export function computeMonitoringEnd(
  preset: MonitoringPreset,
  customHours: number | null | undefined,
  startsAt: Date,
  desiredDate: string,
  timezone: string,
): Date {
  const departureCutoff = zonedTimeToInstant(desiredDate, 23 * 60 + 59, timezone);

  const hoursByPreset: Record<Exclude<MonitoringPreset, 'UNTIL_DEPARTURE' | 'CUSTOM'>, number> = {
    '24H': 24,
    '48H': 48,
    '72H': 72,
  };

  let end: Date;
  if (preset === 'UNTIL_DEPARTURE') {
    end = departureCutoff;
  } else if (preset === 'CUSTOM') {
    end = new Date(startsAt.getTime() + (customHours ?? 48) * 3_600_000);
  } else {
    end = new Date(startsAt.getTime() + hoursByPreset[preset] * 3_600_000);
  }

  if (end > departureCutoff) end = departureCutoff;
  // Always give at least one full slot cycle so a watch is never born dead.
  const minimumEnd = new Date(startsAt.getTime() + 60_000);
  return end > minimumEnd ? end : minimumEnd;
}

export class WatchValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'WatchValidationError';
  }
}

export async function createWatch(
  db: SupabaseClient,
  userId: string,
  input: CreateWatchInput,
  now: Date = new Date(),
): Promise<WatchRow> {
  const env = getServerEnv();
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : env.defaultTimezone;

  assertCalendarDate(input.desiredDate);
  const today = todayInTimeZone(now, timezone);
  if (compareDates(input.desiredDate, today) < 0) {
    throw new WatchValidationError('That travel date is already in the past.', 'desiredDate');
  }

  // Per-user ceiling: a cheap, hard stop on runaway credit consumption.
  const { count, error: countError } = await db
    .from('watches')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'ACTIVE');
  if (countError) throw new Error(`Could not count watches: ${countError.message}`);
  if ((count ?? 0) >= env.maxActiveWatchesPerUser) {
    throw new WatchValidationError(
      `You can monitor up to ${env.maxActiveWatchesPerUser} trips at once. Pause or delete one first.`,
    );
  }

  // The active-watch cap alone is not a spend ceiling: create -> immediate scan
  // -> delete -> repeat resets it every time while still charging the provider,
  // and the cascade delete erases the evidence. This counts searches actually
  // consumed in the last 24h, which deleting a watch does not undo.
  if (await isUserOverSearchCeiling(db, userId, now)) {
    throw new WatchValidationError(
      'You have run a lot of fare checks today. Try again tomorrow, or pause a trip you are no longer watching.',
    );
  }

  const { data: stations, error: stationError } = await db
    .from('stations')
    .select('code')
    .in('code', [input.originCode, input.destinationCode]);
  if (stationError) throw new Error(`Could not verify stations: ${stationError.message}`);
  if ((stations ?? []).length < 2) {
    throw new WatchValidationError('We do not recognise one of those stations.', 'originCode');
  }

  // A user's configured default applies unless this watch overrides it.
  let minimumSavingsCents = input.minimumSavings ?? null;
  if (minimumSavingsCents === null) {
    const { data: profile } = await db
      .from('profiles')
      .select('default_min_savings_cents')
      .eq('id', userId)
      .maybeSingle();
    minimumSavingsCents =
      (profile as { default_min_savings_cents: number | null } | null)?.default_min_savings_cents ??
      env.alertMaterialDropCents;
  }

  const monitoringEndsAt = computeMonitoringEnd(
    input.monitoringPreset,
    input.customMonitoringHours,
    now,
    input.desiredDate,
    timezone,
  );

  const { data, error } = await db
    .from('watches')
    .insert({
      user_id: userId,
      origin_code: input.originCode,
      destination_code: input.destinationCode,
      desired_date: input.desiredDate,
      passengers: input.passengers,
      benchmark_cents: input.amountPaid,
      benchmark_version: 1,
      original_train_number: input.originalTrainNumber ?? null,
      original_departure_local: input.originalDepartureTime ?? null,
      original_fare_family: input.fareFamily,
      booked_at: now.toISOString(),
      date_flexibility_days: input.dateFlexibilityDays,
      travel_class: input.travelClass,
      benchmark_fare_family: input.fareFamily,
      include_thruway: input.includeThruway,
      include_restricted_fares: input.includeRestrictedFares,
      minimum_savings_cents: minimumSavingsCents,
      target_price_cents: input.targetPrice ?? null,
      preferred_departure_minutes: clockToMinutes(input.preferredDepartureTime),
      timezone,
      status: 'ACTIVE',
      monitoring_starts_at: now.toISOString(),
      monitoring_ends_at: monitoringEndsAt.toISOString(),
    })
    .select('*')
    .single();

  if (error) throw new Error(`Could not create watch: ${error.message}`);
  const row = data as unknown as WatchRow;

  // Append-only benchmark history starts here.
  const { error: ledgerError } = await db.from('booking_price_events').insert({
    watch_id: row.id,
    user_id: userId,
    event_type: 'INITIAL_PURCHASE',
    amount_cents: input.amountPaid,
    benchmark_version: 1,
    travel_date: input.desiredDate,
    train_number: input.originalTrainNumber ?? null,
    departure_local: input.originalDepartureTime ?? null,
    fare_family: input.fareFamily,
  });
  // Not fatal — the watch exists and is worth keeping — but it must be loud.
  // Discarding this error is how the ledger came to be silently empty.
  if (ledgerError) {
    logger.error('could not open the benchmark ledger', {
      watch_id: row.id,
      error: ledgerError.message,
    });
  }

  logger.info('watch created', { watch_id: row.id, user_id: userId });
  return row;
}

/**
 * Create a round trip as two linked one-way watches.
 *
 * Each leg keeps its own benchmark, dates, eligible trains and alert state —
 * which is exactly what the rest of the pipeline already does correctly — and
 * the two rows simply learn about each other. Fares on the two directions move
 * independently, so a drop on the return is worth an alert whether or not the
 * outbound moved.
 *
 * The outbound is created first and returned. If linking the pair fails the
 * legs still exist and still work; they are merely not shown as a pair, which
 * is a cosmetic loss rather than a lost watch.
 */
export async function createRoundTrip(
  db: SupabaseClient,
  userId: string,
  input: CreateWatchInput,
  now: Date = new Date(),
): Promise<{ outbound: WatchRow; inbound: WatchRow | null }> {
  const outbound = await createWatch(db, userId, input, now);
  if (
    !input.returnDate ||
    input.returnAmountPaid === null ||
    input.returnAmountPaid === undefined
  ) {
    return { outbound, inbound: null };
  }

  let inbound: WatchRow;
  try {
    inbound = await createWatch(
      db,
      userId,
      {
        ...input,
        originCode: input.destinationCode,
        destinationCode: input.originCode,
        desiredDate: input.returnDate,
        amountPaid: input.returnAmountPaid,
        // A target is a number for one specific leg's fare, so it does not
        // carry over to the other direction.
        targetPrice: null,
        returnDate: null,
        returnAmountPaid: null,
      },
      now,
    );
  } catch (error) {
    // The outbound is already watched and charged for. Losing it because the
    // return hit the per-user cap would be the wrong trade.
    logger.error('return leg could not be created', {
      watch_id: outbound.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new WatchValidationError(
      error instanceof WatchValidationError
        ? `The outbound leg is being watched. The return could not be added: ${error.message}`
        : 'The outbound leg is being watched, but the return could not be added.',
      'returnDate',
    );
  }

  // Two updates rather than an upsert: an upsert carrying only these two
  // columns is an INSERT that would fail every NOT NULL column on the table.
  const [{ error: outLink }, { error: inLink }] = await Promise.all([
    db.from('watches').update({ linked_watch_id: inbound.id }).eq('id', outbound.id),
    db.from('watches').update({ linked_watch_id: outbound.id }).eq('id', inbound.id),
  ]);
  const linkError = outLink ?? inLink;
  if (linkError) {
    logger.error('round trip legs could not be linked', {
      watch_id: outbound.id,
      error: linkError.message,
    });
    return { outbound, inbound };
  }

  return {
    outbound: { ...outbound, linked_watch_id: inbound.id },
    inbound: { ...inbound, linked_watch_id: outbound.id },
  };
}

/**
 * Record a rebooking. History is append-only and the previous benchmark is never
 * rewritten; the watch simply gets a new active benchmark and a fresh alert state.
 */
export async function rebookWatch(
  db: SupabaseClient,
  watch: WatchRow,
  input: RebookInput,
  now: Date = new Date(),
): Promise<WatchRow> {
  const nextVersion = watch.benchmark_version + 1;

  const { error: ledgerError } = await db.from('booking_price_events').insert({
    watch_id: watch.id,
    user_id: watch.user_id,
    event_type: 'REBOOKED',
    amount_cents: input.amountPaid,
    benchmark_version: nextVersion,
    travel_date: input.travelDate ?? watch.desired_date,
    train_number: input.trainNumber ?? null,
    departure_local: input.departureTime ?? null,
    fare_family: input.fareFamily ?? watch.benchmark_fare_family,
    note: input.note ?? null,
  });
  // The ledger is the only record of what was paid before this moment. Losing
  // it silently is how it came to be empty in the first place.
  if (ledgerError) throw new Error(`Could not record the rebooking: ${ledgerError.message}`);

  const stillMonitoring = new Date(watch.monitoring_ends_at) > now && watch.status !== 'COMPLETED';

  const { data, error } = await db
    .from('watches')
    .update({
      benchmark_cents: input.amountPaid,
      benchmark_version: nextVersion,
      desired_date: input.travelDate ?? watch.desired_date,
      original_train_number: input.trainNumber ?? watch.original_train_number,
      original_departure_local: input.departureTime ?? watch.original_departure_local,
      benchmark_fare_family: input.fareFamily ?? watch.benchmark_fare_family,
      original_fare_family: input.fareFamily ?? watch.original_fare_family,
      status: stillMonitoring ? 'ACTIVE' : 'COMPLETED',
      // A new benchmark means previous alerts say nothing about the new one.
      last_alerted_at: null,
      last_alert_best_total_cents: null,
      last_alert_signature: null,
      last_alert_convenience_score: null,
      best_total_cents: null,
    })
    .eq('id', watch.id)
    .select('*')
    .single();

  if (error) throw new Error(`Could not record rebooking: ${error.message}`);
  logger.info('watch rebooked', { watch_id: watch.id, benchmark_version: nextVersion });
  return data as unknown as WatchRow;
}

/**
 * Atomically reserve a manual check, or refuse.
 *
 * The previous implementation read for a recent MANUAL cycle and then, an entire
 * provider round-trip later, wrote the row it was guarding - so a double-click
 * put two requests through the gate seconds apart and charged the provider
 * twice, then raced on the alert state and could send two emails. The insert IS
 * the reservation now, so the race is decided in a single statement.
 *
 * Returns the reserved cycle id, or null when still cooling down.
 */
export async function claimManualCheck(
  db: SupabaseClient,
  watch: WatchRow,
  now: Date = new Date(),
): Promise<{ cycleId: string | null; retryAfterSeconds: number }> {
  const env = getServerEnv();
  const { data, error } = await db.rpc('claim_manual_check', {
    p_watch_id: watch.id,
    p_user_id: watch.user_id,
    p_benchmark_cents: watch.benchmark_cents,
    p_benchmark_version: watch.benchmark_version,
    p_cooldown_minutes: env.manualCheckCooldownMinutes,
  });

  if (error) {
    logger.error('claim_manual_check failed', { watch_id: watch.id, error: error.message });
    return { cycleId: null, retryAfterSeconds: 60 };
  }
  if (data) return { cycleId: String(data), retryAfterSeconds: 0 };

  // Refused: report how long is left on the cooldown.
  const { data: last } = await db
    .from('fare_check_cycles')
    .select('started_at')
    .eq('watch_id', watch.id)
    .eq('trigger', 'MANUAL')
    .order('started_at', { ascending: false })
    .limit(1);

  const startedAt = (last ?? [])[0] as { started_at: string } | undefined;
  const elapsed = startedAt ? now.getTime() - new Date(startedAt.started_at).getTime() : 0;
  const remaining = env.manualCheckCooldownMinutes * 60_000 - elapsed;
  return { cycleId: null, retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)) };
}

/** Per-user spend ceiling, counted from an append-only source so delete-and-recreate cannot reset it. */
export async function isUserOverSearchCeiling(
  db: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const env = getServerEnv();
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const used = await getUserSearchCount(db, userId, since);
  // A watch legitimately consumes ~12 searches/day (INITIAL + 3 slots x 3 dates).
  return used >= env.maxActiveWatchesPerUser * 12 * 2;
}
