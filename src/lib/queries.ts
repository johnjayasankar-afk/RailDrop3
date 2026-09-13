import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { attributeOutcomes, type AlertOutcome } from '@/lib/domain/alert-outcomes';
import { realisedSavings, type RealisedSavings } from '@/lib/domain/savings';
import { isPushConfigured } from '@/lib/push/config';
import { nextScheduledCheckAt } from '@/lib/domain/schedule';
import type { Watch } from '@/lib/domain/types';
import { toDateString, toIsoString, toWatch } from '@/lib/services/mappers';
import { WATCH_COLUMNS } from '@/lib/services/dispatcher';
import type {
  CycleRow,
  FareOptionRow,
  JourneyOptionRow,
  SnapshotRow,
  WatchRow,
} from '@/lib/db/types';

export interface OptionView {
  fareOptionId: string;
  journeyOptionId: string;
  totalCents: number;
  savingsCents: number | null;
  displacementDays: number;
  travelDate: string;
  serviceName: string | null;
  trainNumber: string | null;
  departureLocal: string;
  arrivalLocal: string;
  durationMinutes: number;
  transfers: number;
  serviceType: string;
  fareFamily: string;
  travelClass: string;
  availability: string;
  restricted: boolean;
  seatsRemaining: number | null;
  pricingConfidence: string;
  bookingUrl: string | null;
  isQualifying: boolean;
  rank: number | null;
}

export interface DateStripEntry {
  travelDate: string;
  displacementDays: number;
  status: SnapshotRow['status'];
  cheapestTotalCents: number | null;
  errorKind: string | null;
  journeysReturned: number;
}

export interface PricePoint {
  at: string;
  cents: number | null;
}

export interface WatchSummary {
  row: WatchRow;
  watch: Watch;
  latestCycle: CycleRow | null;
  bestOption: OptionView | null;
  qualifyingCount: number;
  nextCheckAt: string | null;
  /** Best price at each completed check, oldest first. Null = check failed. */
  priceHistory: PricePoint[];
}

export interface WatchDetail extends WatchSummary {
  strip: DateStripEntry[];
  options: OptionView[];
  recentCycles: CycleRow[];
  alertCount: number;
  lastDeliveryFailed: boolean;
  /** When each alert fired, for markers on the price chart. */
  alertMarkers: Array<{ at: string; savingsCents: number }>;
  /** Everything that has happened to this trip, newest first. */
  timeline: TimelineEntry[];
  /** The other leg of a round trip, if there is one and it still exists. */
  linkedLeg: LinkedLeg | null;
}

export interface LinkedLeg {
  id: string;
  originCode: string;
  destinationCode: string;
  desiredDate: string;
  benchmarkCents: number;
  bestTotalCents: number | null;
  status: string;
  lastCycleStatus: string | null;
}

const TERMINAL_CYCLE_STATUSES = '("PENDING","RUNNING")';

function joinOptions(
  fares: FareOptionRow[],
  journeys: Map<string, JourneyOptionRow>,
): OptionView[] {
  const out: OptionView[] = [];
  for (const fare of fares) {
    const journey = journeys.get(fare.journey_option_id);
    if (!journey) continue;
    out.push({
      fareOptionId: fare.id,
      journeyOptionId: journey.id,
      totalCents: fare.party_total_cents,
      savingsCents: fare.savings_cents,
      displacementDays: fare.displacement_days,
      travelDate: toDateString(journey.travel_date),
      serviceName: journey.service_name,
      trainNumber: journey.train_number,
      departureLocal: journey.departure_local,
      arrivalLocal: journey.arrival_local,
      durationMinutes: journey.duration_minutes,
      transfers: journey.transfers,
      serviceType: journey.service_type,
      fareFamily: fare.fare_family,
      travelClass: fare.travel_class,
      availability: fare.availability,
      restricted: fare.restricted,
      seatsRemaining: fare.seats_remaining,
      pricingConfidence: fare.pricing_confidence,
      bookingUrl: journey.booking_url,
      isQualifying: fare.is_qualifying,
      rank: fare.rank,
    });
  }
  return out;
}

/** Best price per completed check, oldest first; a failed check is a null. */
function toPriceHistory(cycles: CycleRow[], limit = 40): PricePoint[] {
  return cycles
    .slice(0, limit)
    .map((c) => ({
      at: toIsoString(c.started_at),
      cents:
        c.status === 'FAILED' || c.status === 'SKIPPED_BUDGET' || c.status === 'SKIPPED_EXPIRED'
          ? null
          : c.best_total_cents,
    }))
    .reverse();
}

async function loadCycleOptions(
  db: SupabaseClient,
  cycleId: string,
  limit: number,
): Promise<OptionView[]> {
  const { data: snapshots } = await db.from('fare_snapshots').select('id').eq('cycle_id', cycleId);
  const snapshotIds = ((snapshots ?? []) as Array<{ id: string }>).map((s) => s.id);
  if (snapshotIds.length === 0) return [];

  const { data: fareRows } = await db
    .from('fare_options')
    .select('*')
    .in('snapshot_id', snapshotIds)
    .order('party_total_cents', { ascending: true })
    .limit(limit);

  const fares = (fareRows ?? []) as unknown as FareOptionRow[];
  if (fares.length === 0) return [];

  const { data: journeyRows } = await db
    .from('journey_options')
    .select('*')
    .in('id', [...new Set(fares.map((f) => f.journey_option_id))]);

  const journeys = new Map(
    ((journeyRows ?? []) as unknown as JourneyOptionRow[]).map((j) => [j.id, j]),
  );
  return joinOptions(fares, journeys);
}

/**
 * The dashboard, in a bounded number of round trips.
 *
 * Deliberately NOT one query per watch: at the 25-watch ceiling that was 75+
 * sequential round trips and a dashboard that got slower the more you used it.
 * Cycles, snapshots, journeys and fares are each fetched once for all watches.
 */
export async function loadDashboard(db: SupabaseClient, now = new Date()): Promise<WatchSummary[]> {
  const { data: watchRows } = await db
    .from('watches')
    .select(WATCH_COLUMNS)
    .is('deleted_at', null)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (watchRows ?? []) as unknown as WatchRow[];
  if (rows.length === 0) return [];

  const watchIds = rows.map((r) => r.id);

  // 1. Every completed cycle for every watch, newest first.
  const { data: cycleRows } = await db
    .from('fare_check_cycles')
    .select('*')
    .in('watch_id', watchIds)
    .not('status', 'in', TERMINAL_CYCLE_STATUSES)
    .order('started_at', { ascending: false })
    .limit(1200);

  const cyclesByWatch = new Map<string, CycleRow[]>();
  for (const cycle of (cycleRows ?? []) as unknown as CycleRow[]) {
    const list = cyclesByWatch.get(cycle.watch_id) ?? [];
    list.push(cycle);
    cyclesByWatch.set(cycle.watch_id, list);
  }

  // 2. The single newest cycle per watch is the one whose options we render.
  const latestCycleIds = [...cyclesByWatch.values()]
    .map((list) => list[0]?.id)
    .filter((id): id is string => Boolean(id));

  const optionsByCycle = new Map<string, OptionView[]>();
  if (latestCycleIds.length > 0) {
    const { data: snapshotRows } = await db
      .from('fare_snapshots')
      .select('id, cycle_id')
      .in('cycle_id', latestCycleIds);

    const snapshots = (snapshotRows ?? []) as Array<{ id: string; cycle_id: string }>;
    const cycleBySnapshot = new Map(snapshots.map((s) => [s.id, s.cycle_id]));

    if (snapshots.length > 0) {
      const { data: fareRows } = await db
        .from('fare_options')
        .select('*')
        .in(
          'snapshot_id',
          snapshots.map((s) => s.id),
        )
        .eq('is_qualifying', true)
        .order('party_total_cents', { ascending: true })
        .limit(2000);

      const fares = (fareRows ?? []) as unknown as FareOptionRow[];
      if (fares.length > 0) {
        const { data: journeyRows } = await db
          .from('journey_options')
          .select('*')
          .in('id', [...new Set(fares.map((f) => f.journey_option_id))]);

        const journeys = new Map(
          ((journeyRows ?? []) as unknown as JourneyOptionRow[]).map((j) => [j.id, j]),
        );

        for (const option of joinOptions(fares, journeys)) {
          const fare = fares.find((f) => f.id === option.fareOptionId);
          const cycleId = fare ? cycleBySnapshot.get(fare.snapshot_id) : undefined;
          if (!cycleId) continue;
          const list = optionsByCycle.get(cycleId) ?? [];
          list.push(option);
          optionsByCycle.set(cycleId, list);
        }
      }
    }
  }

  return rows.map((row) => {
    const watch = toWatch(row);
    const cycles = cyclesByWatch.get(row.id) ?? [];
    const latestCycle = cycles[0] ?? null;
    const options = latestCycle ? (optionsByCycle.get(latestCycle.id) ?? []) : [];
    const next = nextScheduledCheckAt(watch, now);

    return {
      row,
      watch,
      latestCycle,
      bestOption: options[0] ?? null,
      qualifyingCount: options.length,
      nextCheckAt: next ? next.toISOString() : null,
      priceHistory: toPriceHistory(cycles),
    };
  });
}

export async function loadWatchDetail(
  db: SupabaseClient,
  watchId: string,
  now = new Date(),
): Promise<WatchDetail | null> {
  const { data } = await db
    .from('watches')
    .select(WATCH_COLUMNS)
    .eq('id', watchId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as WatchRow;
  const watch = toWatch(row);

  const { data: cycleRows } = await db
    .from('fare_check_cycles')
    .select('*')
    .eq('watch_id', watchId)
    .not('status', 'in', TERMINAL_CYCLE_STATUSES)
    .order('started_at', { ascending: false })
    .limit(60);

  const cycles = (cycleRows ?? []) as unknown as CycleRow[];
  const latestCycle = cycles[0] ?? null;

  const strip: DateStripEntry[] = [];
  let options: OptionView[] = [];

  if (latestCycle) {
    const { data: snapshotRows } = await db
      .from('fare_snapshots')
      .select('*')
      .eq('cycle_id', latestCycle.id)
      .order('travel_date');

    for (const s of (snapshotRows ?? []) as unknown as SnapshotRow[]) {
      strip.push({
        travelDate: toDateString(s.travel_date),
        displacementDays: s.displacement_days,
        status: s.status,
        cheapestTotalCents: s.cheapest_total_cents,
        errorKind: s.error_kind,
        journeysReturned: s.journeys_returned,
      });
    }
    options = await loadCycleOptions(db, latestCycle.id, 60);
  }

  const { data: alertRows } = await db
    .from('alerts')
    .select('created_at, savings_cents, reason, best_total_cents')
    .eq('watch_id', watchId)
    .order('created_at', { ascending: true })
    .limit(60);
  const alerts = (alertRows ?? []) as Array<{
    created_at: string;
    savings_cents: number;
    reason: string;
    best_total_cents: number;
  }>;
  const alertMarkers = alerts.map((a) => ({
    at: toIsoString(a.created_at),
    savingsCents: a.savings_cents,
  }));

  // The other leg of a round trip. Filtered on deleted_at so a soft-deleted
  // partner stops being shown rather than rendering as a dead link.
  let linkedLeg: LinkedLeg | null = null;
  if (row.linked_watch_id) {
    const { data: legRow } = await db
      .from('watches')
      .select(
        'id, origin_code, destination_code, desired_date, benchmark_cents, best_total_cents, status, last_cycle_status',
      )
      .eq('id', row.linked_watch_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (legRow) {
      const leg = legRow as {
        id: string;
        origin_code: string;
        destination_code: string;
        desired_date: string;
        benchmark_cents: number;
        best_total_cents: number | null;
        status: string;
        last_cycle_status: string | null;
      };
      linkedLeg = {
        id: leg.id,
        originCode: leg.origin_code,
        destinationCode: leg.destination_code,
        desiredDate: toDateString(leg.desired_date),
        benchmarkCents: leg.benchmark_cents,
        bestTotalCents: leg.best_total_cents,
        status: leg.status,
        lastCycleStatus: leg.last_cycle_status,
      };
    }
  }

  const { data: eventRows } = await db
    .from('watch_events')
    .select('id, kind, detail, created_at')
    .eq('watch_id', watchId)
    .order('created_at', { ascending: false })
    .limit(60);

  // An aged PENDING row means a send died mid-flight; that is just as much a
  // "we could not email you" as an explicit failure.
  const stalePending = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: failedDelivery } = await db
    .from('notification_deliveries')
    .select('id, status, updated_at')
    .eq('watch_id', watchId)
    .in('status', ['FAILED', 'ABANDONED', 'PENDING'])
    .lt('updated_at', stalePending)
    .limit(1);

  const qualifying = options.filter((o) => o.isQualifying);
  const next = nextScheduledCheckAt(watch, now);

  return {
    row,
    watch,
    latestCycle,
    bestOption: qualifying[0] ?? options[0] ?? null,
    qualifyingCount: qualifying.length,
    nextCheckAt: next ? next.toISOString() : null,
    priceHistory: toPriceHistory(cycles),
    strip,
    options,
    recentCycles: cycles.slice(0, 8),
    alertCount: alertMarkers.length,
    alertMarkers,
    lastDeliveryFailed: (failedDelivery ?? []).length > 0,
    linkedLeg,
    timeline: buildTimeline(
      (eventRows ?? []) as Array<{
        id: string;
        kind: string;
        detail: Record<string, unknown> | null;
        created_at: string;
      }>,
      cycles,
      alerts,
    ),
  };
}

// ─── Timeline ────────────────────────────────────────────────────────────────

export type TimelineEntry =
  | {
      kind: 'EVENT';
      id: string;
      at: string;
      event: string;
      detail: Record<string, unknown>;
    }
  | {
      kind: 'CHECK';
      id: string;
      at: string;
      status: string;
      trigger: string;
      bestTotalCents: number | null;
      datesSucceeded: number;
      datesTotal: number;
      errorKind: string | null;
    }
  | {
      kind: 'ALERT';
      id: string;
      at: string;
      reason: string;
      bestTotalCents: number;
      savingsCents: number;
    };

/**
 * One chronology from three sources.
 *
 * Checks and alerts already had durable tables; what a person *did* did not,
 * which is why watch_events exists. Merging here rather than in the database
 * keeps the three write paths independent — a union view would have coupled
 * every one of them to the shape of this list.
 */
export function buildTimeline(
  events: Array<{
    id: string;
    kind: string;
    detail: Record<string, unknown> | null;
    created_at: string;
  }>,
  cycles: CycleRow[],
  alerts: Array<{
    created_at: string;
    savings_cents: number;
    reason: string;
    best_total_cents: number;
  }>,
  limit = 40,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const event of events) {
    entries.push({
      kind: 'EVENT',
      id: `event-${event.id}`,
      at: toIsoString(event.created_at),
      event: event.kind,
      detail: event.detail ?? {},
    });
  }

  for (const cycle of cycles) {
    entries.push({
      kind: 'CHECK',
      id: `check-${cycle.id}`,
      at: toIsoString(cycle.completed_at ?? cycle.started_at),
      status: cycle.status,
      trigger: cycle.trigger,
      bestTotalCents: cycle.best_total_cents,
      datesSucceeded: cycle.dates_succeeded,
      datesTotal: cycle.dates_total,
      errorKind: cycle.error_kind,
    });
  }

  for (const [index, alert] of alerts.entries()) {
    entries.push({
      kind: 'ALERT',
      id: `alert-${index}-${alert.created_at}`,
      at: toIsoString(alert.created_at),
      reason: alert.reason,
      bestTotalCents: alert.best_total_cents,
      savingsCents: alert.savings_cents,
    });
  }

  // Newest first. Where an alert and the check that produced it share a
  // timestamp, the alert sorts above so the outcome reads before its cause.
  const weight = (entry: TimelineEntry) =>
    entry.kind === 'ALERT' ? 2 : entry.kind === 'EVENT' ? 1 : 0;

  return entries
    .sort((a, b) => {
      const delta = new Date(b.at).getTime() - new Date(a.at).getTime();
      return delta !== 0 ? delta : weight(b) - weight(a);
    })
    .slice(0, limit);
}

export interface AlertHistoryRow {
  /** What happened after this alert, from the benchmark ledger. */
  outcome: AlertOutcome;
  id: string;
  watchId: string;
  createdAt: string;
  reason: string;
  originCode: string;
  destinationCode: string;
  desiredDate: string;
  benchmarkCents: number;
  bestTotalCents: number;
  savingsCents: number;
  cycleStatus: string;
  uncheckedDates: string[];
  deliveries: Array<{ channel: string; status: string; error: string | null }>;
  best: {
    travelDate: string | null;
    displacementDays: number | null;
    serviceName: string | null;
    trainNumber: string | null;
    departureLocal: string | null;
  } | null;
}

/**
 * Every alert this user has been sent, newest first, with what happened to each
 * delivery. This is the accountability page: if RailDrop claims it told you,
 * this is where you check.
 */
export async function loadAlertHistory(
  db: SupabaseClient,
  limit = 100,
): Promise<AlertHistoryRow[]> {
  const { data: alertRows } = await db
    .from('alerts')
    .select(
      'id, watch_id, created_at, reason, benchmark_cents, best_total_cents, savings_cents, cycle_status, unchecked_dates, options_snapshot',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  const alerts = (alertRows ?? []) as Array<{
    id: string;
    watch_id: string;
    created_at: string;
    reason: string;
    benchmark_cents: number;
    best_total_cents: number;
    savings_cents: number;
    cycle_status: string;
    unchecked_dates: unknown;
    options_snapshot: unknown;
  }>;
  if (alerts.length === 0) return [];

  const watchIds = [...new Set(alerts.map((a) => a.watch_id))];
  const { data: watchRows } = await db
    .from('watches')
    .select('id, origin_code, destination_code, desired_date')
    .in('id', watchIds);
  const watchById = new Map(
    (
      (watchRows ?? []) as Array<{
        id: string;
        origin_code: string;
        destination_code: string;
        desired_date: string;
      }>
    ).map((w) => [w.id, w]),
  );

  const { data: deliveryRows } = await db
    .from('notification_deliveries')
    .select('alert_id, channel, status, error')
    .in(
      'alert_id',
      alerts.map((a) => a.id),
    );
  const deliveriesByAlert = new Map<
    string,
    Array<{ channel: string; status: string; error: string | null }>
  >();
  for (const row of (deliveryRows ?? []) as Array<{
    alert_id: string;
    channel: string;
    status: string;
    error: string | null;
  }>) {
    const list = deliveriesByAlert.get(row.alert_id) ?? [];
    list.push({ channel: row.channel, status: row.status, error: row.error });
    deliveriesByAlert.set(row.alert_id, list);
  }

  // Rebookings, so each alert can say whether anything followed it. Read in
  // version order per trip so consecutive amounts are the real before/after.
  const { data: ledgerRows } = await db
    .from('booking_price_events')
    .select('watch_id, benchmark_version, amount_cents, created_at')
    .order('benchmark_version', { ascending: true })
    .limit(2000);

  const ledgerByWatch = new Map<string, Array<{ amount: number; at: string }>>();
  for (const row of (ledgerRows ?? []) as Array<{
    watch_id: string;
    amount_cents: number;
    created_at: string;
  }>) {
    const list = ledgerByWatch.get(row.watch_id) ?? [];
    list.push({ amount: row.amount_cents, at: toIsoString(row.created_at) });
    ledgerByWatch.set(row.watch_id, list);
  }

  const rebookings = [...ledgerByWatch.entries()].flatMap(([watchId, entries]) =>
    entries.slice(1).map((entry, index) => ({
      watchId,
      createdAt: entry.at,
      fromCents: (entries[index] as { amount: number }).amount,
      toCents: entry.amount,
    })),
  );

  const outcomes = attributeOutcomes(
    alerts.map((alert) => ({
      id: alert.id,
      watchId: alert.watch_id,
      createdAt: toIsoString(alert.created_at),
    })),
    rebookings,
  );

  return alerts.flatMap((alert) => {
    const watch = watchById.get(alert.watch_id);
    if (!watch) return []; // the trip was deleted; its alerts go with it
    const snapshot = Array.isArray(alert.options_snapshot)
      ? (alert.options_snapshot[0] as Record<string, unknown> | undefined)
      : undefined;

    return [
      {
        outcome: outcomes.get(alert.id) ?? { kind: 'NONE' as const },
        id: alert.id,
        watchId: alert.watch_id,
        createdAt: toIsoString(alert.created_at),
        reason: alert.reason,
        originCode: watch.origin_code,
        destinationCode: watch.destination_code,
        desiredDate: toDateString(watch.desired_date),
        benchmarkCents: alert.benchmark_cents,
        bestTotalCents: alert.best_total_cents,
        savingsCents: alert.savings_cents,
        cycleStatus: alert.cycle_status,
        uncheckedDates: Array.isArray(alert.unchecked_dates)
          ? alert.unchecked_dates.map((d) => toDateString(d))
          : [],
        deliveries: deliveriesByAlert.get(alert.id) ?? [],
        best: snapshot
          ? {
              travelDate: snapshot.travelDate ? toDateString(snapshot.travelDate) : null,
              displacementDays:
                typeof snapshot.displacementDays === 'number' ? snapshot.displacementDays : null,
              serviceName: (snapshot.serviceName as string | null) ?? null,
              trainNumber: (snapshot.trainNumber as string | null) ?? null,
              departureLocal: (snapshot.departureLocal as string | null) ?? null,
            }
          : null,
      },
    ];
  });
}

// Presentation helpers live in a client-safe module; re-exported for callers
// that already import from here.
export { alertReasonLabel, cycleStatusLabel } from '@/lib/labels';

/**
 * Money the user actually saved, read from the append-only benchmark ledger.
 *
 * Distinct from "savings found", which only claims a cheaper fare existed.
 */
export async function loadRealisedSavings(db: SupabaseClient): Promise<RealisedSavings> {
  const { data } = await db
    .from('booking_price_events')
    .select('watch_id, benchmark_version, amount_cents')
    .order('benchmark_version', { ascending: true })
    .limit(2000);

  const rows = (data ?? []) as Array<{
    watch_id: string;
    benchmark_version: number;
    amount_cents: number;
  }>;

  return realisedSavings(
    rows.map((row) => ({
      watchId: row.watch_id,
      benchmarkVersion: row.benchmark_version,
      amountCents: row.amount_cents,
    })),
  );
}

// ─── First-run setup ─────────────────────────────────────────────────────────

export interface SetupProgress {
  hasTrip: boolean;
  hasPush: boolean;
  hasTarget: boolean;
  /**
   * False when the deployment has no VAPID keys. The push step is then dropped
   * entirely rather than sitting permanently unticked — a checklist with a step
   * nobody can complete never goes away, which is worse than not having one.
   */
  pushAvailable: boolean;
  /** Set once the user dismisses the checklist, or completes every step. */
  dismissed: boolean;
  complete: boolean;
}

/**
 * What the user has and has not set up yet.
 *
 * Push and target prices are the two settings that most change how well
 * RailDrop works, and both are invisible until you go looking. A checklist is
 * the difference between a product that works and one a person knows how to
 * make work.
 */
export async function loadSetupProgress(
  db: SupabaseClient,
  userId: string,
): Promise<SetupProgress> {
  const [{ count: trips }, { count: pushes }, { count: targets }, { data: profile }] =
    await Promise.all([
      db.from('watches').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      db.from('push_subscriptions').select('id', { count: 'exact', head: true }),
      db
        .from('watches')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .not('target_price_cents', 'is', null),
      db.from('profiles').select('onboarded_at').eq('id', userId).maybeSingle(),
    ]);

  const pushAvailable = isPushConfigured();
  const hasTrip = (trips ?? 0) > 0;
  const hasPush = (pushes ?? 0) > 0;
  const hasTarget = (targets ?? 0) > 0;
  const complete = hasTrip && hasTarget && (!pushAvailable || hasPush);

  return {
    hasTrip,
    hasPush,
    hasTarget,
    pushAvailable,
    dismissed: Boolean((profile as { onboarded_at: string | null } | null)?.onboarded_at),
    complete,
  };
}
