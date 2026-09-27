import type { CheckSlot, JourneyOption, OpportunityFingerprint } from "@/lib/domain/types";
import type {
  AlertDecisionRecord,
  AlertRecord,
  BookingPriceEvent,
  DateSnapshotRecord,
  FareCheckCycleRecord,
  NotificationDeliveryRecord,
  Profile,
  ProviderRequestRecord,
  ScheduledCheckRun,
  StoredJourney,
  WatchRecord,
  CorridorObservation,
} from "./models";

export interface WatchUpdate {
  status?: WatchRecord["status"];
  currentBookedPriceCents?: number;
  desiredTravelDate?: string;
  bookedTrainNumber?: string | null;
  bookedDepartureAt?: string | null;
  bookedFareFamily?: WatchRecord["bookedFareFamily"];
  lastCheckCycleId?: string | null;
  lastCheckedAt?: string | null;
  nextCheckSlot?: CheckSlot | null;
  nextCheckAtLabel?: string | null;
  bestPriceCents?: number | null;
  bestSavingsCents?: number | null;
  lastOpportunity?: OpportunityFingerprint | null;
  lastAlertedOpportunity?: OpportunityFingerprint | null;
  opportunityLostNotified?: boolean;
  departureAlertSent?: boolean;
  alertImprovementCents?: number | null;
  monitorEndAt?: string | null;
  monitorPreset?: WatchRecord["monitorPreset"];
  monitorStartAt?: string;
  alertEmail?: string;
  minimumSavingsCents?: number;
  includeRestrictedFares?: boolean;
  includeThruway?: boolean;
  preferredDepartureTime?: string | null;
}

export interface RailDropRepository {
  upsertProfile(profile: Profile): Promise<Profile>;
  getProfile(userId: string): Promise<Profile | null>;
  createWatch(watch: WatchRecord): Promise<WatchRecord>;
  getWatch(id: string): Promise<WatchRecord | null>;
  listWatchesForUser(userId: string): Promise<WatchRecord[]>;
  listActiveWatches(): Promise<WatchRecord[]>;
  updateWatch(id: string, patch: WatchUpdate): Promise<WatchRecord>;
  deleteWatch(id: string, userId: string): Promise<void>;
  insertCycle(cycle: FareCheckCycleRecord): Promise<FareCheckCycleRecord>;
  updateCycle(id: string, patch: Partial<FareCheckCycleRecord>): Promise<FareCheckCycleRecord>;
  getCycle(id: string): Promise<FareCheckCycleRecord | null>;
  listCyclesForWatch(watchId: string): Promise<FareCheckCycleRecord[]>;
  /**
   * Take the lease on a slot, or return null if someone else holds it.
   *
   * Replaces the old insert-as-claim: a row now means "being worked on", not
   * "spent". Only finishScheduledRun makes the slot permanently consumed, so a
   * dispatch that dies partway through leaves its unreached slots reclaimable
   * instead of silently skipping those travelers forever.
   */
  leaseScheduledRun(input: {
    id: string;
    watchId: string;
    localCheckDate: string;
    checkSlot: CheckSlot;
    now: Date;
    leaseExpiresAt: string;
  }): Promise<ScheduledCheckRun | null>;
  /** Mark a leased run finished, successfully or not. */
  finishScheduledRun(
    id: string,
    result: { status: "DONE" | "FAILED"; cycleId?: string | null; failureReason?: string | null },
  ): Promise<void>;
  /** RUNNING rows whose lease has expired — evidence of a crashed worker. */
  listExpiredRuns(now: Date): Promise<ScheduledCheckRun[]>;
  /** Hand an expired slot back, counting the attempt. */
  reclaimScheduledRun(id: string, attempts: number): Promise<void>;
  /** Give up on a slot, with a reason that can be read later. */
  abandonScheduledRun(id: string, reason: string): Promise<void>;
  /**
   * Every run row for the given local dates.
   *
   * One query so the enqueue step can drop slots that are already finished
   * before it picks a batch. Without it a batch can fill up with watches that
   * were checked hours ago, and the wake makes no progress at all.
   */
  listRunsForDates(localDates: readonly string[]): Promise<ScheduledCheckRun[]>;
  /** Run rows for one watch, newest first — the audit trail for a slot. */
  listScheduledRuns(watchId: string, limit?: number): Promise<ScheduledCheckRun[]>;
  insertProviderRequest(request: ProviderRequestRecord): Promise<ProviderRequestRecord>;
  /** Newest completed, reusable search for this key. Never an in-flight marker. */
  findFreshSearch(searchKey: string, notBeforeIso: string): Promise<ProviderRequestRecord | null>;
  /**
   * Newest row of any status for this key, including an IN_FLIGHT marker.
   *
   * Fan-out means two workers can want the same corridor and date at the same
   * moment. This is how the second one finds out that the first is already
   * doing it, instead of launching a second browser.
   */
  findNewestSearch(searchKey: string): Promise<ProviderRequestRecord | null>;
  /**
   * Claim this search key before running it.
   *
   * Returns false when another worker already holds the claim. Looking first
   * and then writing is check-then-act — two workers that look at the same
   * instant both see nothing — so the write itself has to arbitrate.
   */
  markSearchInFlight(row: ProviderRequestRecord): Promise<boolean>;
  /** Complete the row opened by markSearchInFlight. One row per search. */
  finishProviderRequest(
    id: string,
    outcome: {
      status: ProviderRequestRecord["status"];
      creditsConsumed: number | null;
      latencyMs: number;
      errorMessage: string | null;
      /** Cheapest believable fare found. See ProviderRequestRecord. */
      cheapestPriceCents?: number | null;
    },
  ): Promise<void>;
  /**
   * What this corridor has cost, across every watch, most recent first.
   *
   * Deliberately not scoped to a user: it is aggregate data about public train
   * fares and it answers a question no single watch can — "is what I paid any
   * good?". Nothing about who searched leaves this method.
   */
  corridorObservations(input: {
    originCode: string;
    destinationCode: string;
    sinceIso: string;
    limit?: number;
  }): Promise<CorridorObservation[]>;
  getProviderRequest(id: string): Promise<ProviderRequestRecord | null>;
  insertDateSnapshot(snapshot: DateSnapshotRecord): Promise<DateSnapshotRecord>;
  listDateSnapshots(cycleId: string): Promise<DateSnapshotRecord[]>;
  insertJourneys(journeys: StoredJourney[]): Promise<void>;
  listJourneysForCycle(cycleId: string): Promise<StoredJourney[]>;
  getCachedJourneys(providerRequestId: string): Promise<JourneyOption[]>;
  cacheJourneys(providerRequestId: string, journeys: JourneyOption[]): Promise<void>;
  insertAlert(alert: AlertRecord): Promise<AlertRecord>;
  listAlertsForWatch(watchId: string): Promise<AlertRecord[]>;
  /** Record why an alert was or was not sent. The silences matter most. */
  insertAlertDecision(decision: AlertDecisionRecord): Promise<void>;
  listAlertDecisions(watchId: string, limit?: number): Promise<AlertDecisionRecord[]>;
  /** True when this address has asked us to stop, bounced, or complained. */
  isEmailSuppressed(email: string): Promise<boolean>;
  /** Record a suppression. Idempotent: asking twice is not an error. */
  suppressEmail(input: {
    email: string;
    reason: "UNSUBSCRIBED" | "BOUNCED" | "COMPLAINED" | "MANUAL";
    watchId?: string | null;
    detail?: string | null;
  }): Promise<void>;
  insertNotification(delivery: NotificationDeliveryRecord): Promise<NotificationDeliveryRecord>;
  insertPriceEvent(event: BookingPriceEvent): Promise<BookingPriceEvent>;
  listPriceEvents(watchId: string): Promise<BookingPriceEvent[]>;
  incrementUsage(
    day: string,
    credits: number,
    requests: number,
    successes: number,
    failures: number,
    /** Searches served from cache. Without this the cost model is unverifiable. */
    reused?: number,
  ): Promise<void>;
  /** Total searches across a date range, for the monthly ceiling. */
  sumUsage(fromDay: string, toDay: string): Promise<{ requests: number; credits: number }>;
  getUsage(day: string): Promise<{
    day: string;
    credits: number;
    requests: number;
    successes: number;
    failures: number;
    reused: number;
  } | null>;
  searchStations(
    query: string,
  ): Promise<Array<{ code: string; name: string; city: string; state: string }>>;
  upsertStations(
    stations: Array<{ code: string; name: string; city: string; state: string }>,
  ): Promise<number>;
}
