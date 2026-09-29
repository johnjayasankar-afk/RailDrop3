import { IN_FLIGHT_TTL_MS } from "@/lib/domain/search-dedup";
import { STATIONS } from "@/lib/stations/catalog";
import type { JourneyOption } from "@/lib/domain/types";
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
import type { RailDropRepository, WatchUpdate } from "./repository";
import { isExpired } from "@/lib/domain/run-lease";

export class MemoryRepository implements RailDropRepository {
  profiles = new Map<string, Profile>();
  watches = new Map<string, WatchRecord>();
  cycles = new Map<string, FareCheckCycleRecord>();
  scheduled = new Map<string, ScheduledCheckRun>();
  providerRequests = new Map<string, ProviderRequestRecord>();
  snapshots = new Map<string, DateSnapshotRecord>();
  journeys: StoredJourney[] = [];
  cachedJourneys = new Map<string, JourneyOption[]>();
  alerts: AlertRecord[] = [];
  notifications: NotificationDeliveryRecord[] = [];
  priceEvents: BookingPriceEvent[] = [];
  usage = new Map<
    string,
    {
      day: string;
      credits: number;
      requests: number;
      successes: number;
      failures: number;
      reused: number;
    }
  >();
  suppressions = new Map<string, { reason: string; detail: string | null }>();
  alertDecisions: AlertDecisionRecord[] = [];
  stations = STATIONS.map((station) => ({ ...station }));

  async upsertProfile(profile: Profile): Promise<Profile> {
    this.profiles.set(profile.id, profile);
    return profile;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    return this.profiles.get(userId) ?? null;
  }

  async createWatch(watch: WatchRecord): Promise<WatchRecord> {
    this.watches.set(watch.id, watch);
    return watch;
  }

  async getWatch(id: string): Promise<WatchRecord | null> {
    return this.watches.get(id) ?? null;
  }

  async listWatchesForUser(userId: string): Promise<WatchRecord[]> {
    return [...this.watches.values()]
      .filter((watch) => watch.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listActiveWatches(): Promise<WatchRecord[]> {
    return [...this.watches.values()].filter((watch) => watch.status === "ACTIVE");
  }

  async updateWatch(id: string, patch: WatchUpdate): Promise<WatchRecord> {
    const current = this.watches.get(id);
    if (!current) throw new Error(`Watch ${id} not found`);
    const cleaned = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as WatchUpdate;
    const next = { ...current, ...cleaned, updatedAt: new Date().toISOString() };
    this.watches.set(id, next);
    return next;
  }

  async deleteWatch(id: string, userId: string): Promise<void> {
    const watch = this.watches.get(id);
    if (!watch || watch.userId !== userId) return;
    this.watches.delete(id);
  }

  async insertCycle(cycle: FareCheckCycleRecord): Promise<FareCheckCycleRecord> {
    this.cycles.set(cycle.id, cycle);
    return cycle;
  }

  async updateCycle(
    id: string,
    patch: Partial<FareCheckCycleRecord>,
  ): Promise<FareCheckCycleRecord> {
    const current = this.cycles.get(id);
    if (!current) throw new Error(`Cycle ${id} not found`);
    const next = { ...current, ...patch };
    this.cycles.set(id, next);
    return next;
  }

  async getCycle(id: string): Promise<FareCheckCycleRecord | null> {
    return this.cycles.get(id) ?? null;
  }

  async listCyclesForWatch(watchId: string): Promise<FareCheckCycleRecord[]> {
    return [...this.cycles.values()]
      .filter((cycle) => cycle.watchId === watchId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async leaseScheduledRun(input: {
    id: string;
    watchId: string;
    localCheckDate: string;
    checkSlot: ScheduledCheckRun["checkSlot"];
    now: Date;
    leaseExpiresAt: string;
  }): Promise<ScheduledCheckRun | null> {
    const key = `${input.watchId}:${input.localCheckDate}:${input.checkSlot}`;
    const existing = this.scheduled.get(key);

    if (existing) {
      // Finished means finished. Anything else is either live work or a slot
      // handed back by the reaper, and only the latter may be taken.
      if (existing.status === "DONE" || existing.status === "ABANDONED") return null;
      if (existing.status === "RUNNING" && !isExpired(existing, input.now)) return null;
      const taken: ScheduledCheckRun = {
        ...existing,
        status: "RUNNING",
        attempts: existing.attempts + 1,
        claimedAt: input.now.toISOString(),
        startedAt: input.now.toISOString(),
        leaseExpiresAt: input.leaseExpiresAt,
      };
      this.scheduled.set(key, taken);
      return taken;
    }

    const run: ScheduledCheckRun = {
      id: input.id,
      watchId: input.watchId,
      localCheckDate: input.localCheckDate,
      checkSlot: input.checkSlot,
      cycleId: null,
      createdAt: input.now.toISOString(),
      status: "RUNNING",
      attempts: 1,
      claimedAt: input.now.toISOString(),
      startedAt: input.now.toISOString(),
      finishedAt: null,
      leaseExpiresAt: input.leaseExpiresAt,
      failureReason: null,
    };
    this.scheduled.set(key, run);
    return run;
  }

  async finishScheduledRun(
    id: string,
    result: { status: "DONE" | "FAILED"; cycleId?: string | null; failureReason?: string | null },
  ): Promise<void> {
    for (const [key, run] of this.scheduled) {
      if (run.id !== id) continue;
      this.scheduled.set(key, {
        ...run,
        status: result.status,
        cycleId: result.cycleId ?? run.cycleId,
        failureReason: result.failureReason ?? null,
        finishedAt: new Date().toISOString(),
        leaseExpiresAt: null,
      });
      return;
    }
  }

  async listExpiredRuns(now: Date): Promise<ScheduledCheckRun[]> {
    return [...this.scheduled.values()].filter((run) => isExpired(run, now));
  }

  async reclaimScheduledRun(id: string, attempts: number): Promise<void> {
    for (const [key, run] of this.scheduled) {
      if (run.id !== id) continue;
      this.scheduled.set(key, {
        ...run,
        status: "PENDING",
        attempts,
        leaseExpiresAt: null,
        startedAt: null,
      });
      return;
    }
  }

  async abandonScheduledRun(id: string, reason: string): Promise<void> {
    for (const [key, run] of this.scheduled) {
      if (run.id !== id) continue;
      this.scheduled.set(key, {
        ...run,
        status: "ABANDONED",
        failureReason: reason,
        finishedAt: new Date().toISOString(),
        leaseExpiresAt: null,
      });
      return;
    }
  }

  async listRunsForDates(localDates: readonly string[]): Promise<ScheduledCheckRun[]> {
    const wanted = new Set(localDates);
    return [...this.scheduled.values()].filter((run) => wanted.has(run.localCheckDate));
  }

  async listScheduledRuns(watchId: string, limit = 50): Promise<ScheduledCheckRun[]> {
    return [...this.scheduled.values()]
      .filter((run) => run.watchId === watchId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async insertProviderRequest(request: ProviderRequestRecord): Promise<ProviderRequestRecord> {
    this.providerRequests.set(request.id, request);
    return request;
  }

  async findFreshSearch(
    searchKey: string,
    notBeforeIso: string,
  ): Promise<ProviderRequestRecord | null> {
    return (
      [...this.providerRequests.values()]
        .filter(
          (request) =>
            request.searchKey === searchKey &&
            request.reusedFromId === null &&
            request.status !== "PROVIDER_ERROR" &&
            // An in-flight marker has no journeys yet; serving it would render
            // "still searching" as "nothing available".
            request.status !== "IN_FLIGHT" &&
            request.createdAt >= notBeforeIso,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  async finishProviderRequest(
    id: string,
    outcome: {
      status: ProviderRequestRecord["status"];
      creditsConsumed: number | null;
      latencyMs: number;
      errorMessage: string | null;
      cheapestPriceCents?: number | null;
    },
  ): Promise<void> {
    const existing = this.providerRequests.get(id);
    if (!existing) return;
    this.providerRequests.set(id, { ...existing, ...outcome });
  }

  async corridorObservations(input: {
    originCode: string;
    destinationCode: string;
    sinceIso: string;
    limit?: number;
  }): Promise<CorridorObservation[]> {
    const since = Date.parse(input.sinceIso);
    const origin = input.originCode.trim().toUpperCase();
    const destination = input.destinationCode.trim().toUpperCase();
    return [...this.providerRequests.values()]
      .filter(
        (request) =>
          request.cheapestPriceCents != null &&
          request.cheapestPriceCents > 0 &&
          request.originCode.toUpperCase() === origin &&
          request.destinationCode.toUpperCase() === destination &&
          Date.parse(request.createdAt) >= since,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit ?? 500)
      .map((request) => ({
        at: request.createdAt,
        travelDate: request.travelDate,
        cheapestPriceCents: request.cheapestPriceCents as number,
      }));
  }

  async findNewestSearch(searchKey: string): Promise<ProviderRequestRecord | null> {
    return (
      [...this.providerRequests.values()]
        .filter((r) => r.searchKey === searchKey && !r.reusedFromId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  async markSearchInFlight(row: ProviderRequestRecord): Promise<boolean> {
    /* A claim expires. This is the half that did not know that.
     *
     * planSearch already decides an IN_FLIGHT marker older than
     * IN_FLIGHT_TTL_MS is abandoned — "the worker that claimed it is not
     * coming back" — and returns `search`. This function then refused the
     * claim, because it asked only whether an in-flight row EXISTS, with no
     * notion of age. Two components with different definitions of "somebody
     * is working on this", and the disagreement is a deadlock: the planner
     * says go, the store says no, the loop re-plans, forever, until
     * MAX_TURNS trips and the date is recorded as PROVIDER_ERROR.
     *
     * It is permanent and it is per-corridor. Any worker killed between
     * claiming and finishing strands a marker, and that search key never
     * searches again. Measured here on 2026-09-29: three rows stranded at
     * 17:09:28 by a dev server I killed mid-scan, and every BOS→NYP scan
     * afterwards failed with `search.plan_did_not_settle` — which reads like
     * a provider outage and is not one. On Vercel a killed invocation is
     * ordinary, so this is a production fault, not a local one.
     *
     * The reference clock is the INCOMING row's own createdAt, not
     * Date.now(). Every row here is stamped from the cycle's injected clock,
     * and my first version compared those stamps against wall time — which
     * made a test that runs a cycle at a fixed 2026-09-26 see every live
     * claim as three days stale and hand out a second one, breaking the race
     * guarantee this function exists to provide. Two claimants comparing
     * their own stamps to each other is the same question asked in one
     * clock domain.
     *
     * Still atomic: no await between the read and the write. */
    const claimedAt = Date.parse(row.createdAt);
    const reference = Number.isFinite(claimedAt) ? claimedAt : Date.now();
    const cutoff = reference - IN_FLIGHT_TTL_MS;
    const stale: ProviderRequestRecord[] = [];
    for (const held of this.providerRequests.values()) {
      if (held.searchKey !== row.searchKey || held.status !== "IN_FLIGHT") continue;
      const startedAt = Date.parse(held.createdAt);
      // An unparseable timestamp is treated as abandoned rather than as a
      // live claim: a marker nobody can date is one nobody can wait out.
      if (Number.isFinite(startedAt) && startedAt > cutoff) return false;
      stale.push(held);
    }
    /* The abandoned claim becomes a recorded failure rather than vanishing.
       Something did start a search here and never came back, and that is a
       fact about this corridor worth keeping — deleting it would make the
       history claim the search was never attempted. */
    for (const abandoned of stale) {
      this.providerRequests.set(abandoned.id, {
        ...abandoned,
        status: "PROVIDER_ERROR",
        errorMessage: "Search was claimed and never finished; the claim expired.",
      });
    }
    this.providerRequests.set(row.id, row);
    return true;
  }

  async getProviderRequest(id: string): Promise<ProviderRequestRecord | null> {
    return this.providerRequests.get(id) ?? null;
  }

  async insertDateSnapshot(snapshot: DateSnapshotRecord): Promise<DateSnapshotRecord> {
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  async listDateSnapshots(cycleId: string): Promise<DateSnapshotRecord[]> {
    return [...this.snapshots.values()].filter((snapshot) => snapshot.cycleId === cycleId);
  }

  async insertJourneys(journeys: StoredJourney[]): Promise<void> {
    this.journeys.push(...journeys);
  }

  async listJourneysForCycle(cycleId: string): Promise<StoredJourney[]> {
    return this.journeys.filter((journey) => journey.cycleId === cycleId);
  }

  async getCachedJourneys(providerRequestId: string): Promise<JourneyOption[] | null> {
    // `?? []` here made a miss indistinguishable from an empty search.
    return this.cachedJourneys.get(providerRequestId) ?? null;
  }

  async cacheJourneys(providerRequestId: string, journeys: JourneyOption[]): Promise<void> {
    this.cachedJourneys.set(providerRequestId, journeys);
  }

  async insertAlert(alert: AlertRecord): Promise<AlertRecord> {
    this.alerts.push(alert);
    return alert;
  }

  async listAlertsForWatch(watchId: string): Promise<AlertRecord[]> {
    return this.alerts.filter((alert) => alert.watchId === watchId);
  }

  async insertAlertDecision(decision: AlertDecisionRecord): Promise<void> {
    this.alertDecisions.push(decision);
  }

  async listAlertDecisions(watchId: string, limit = 50): Promise<AlertDecisionRecord[]> {
    return this.alertDecisions
      .filter((d) => d.watchId === watchId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async isEmailSuppressed(email: string): Promise<boolean> {
    return this.suppressions.has(email.trim().toLowerCase());
  }

  async suppressEmail(input: {
    email: string;
    reason: "UNSUBSCRIBED" | "BOUNCED" | "COMPLAINED" | "MANUAL";
    watchId?: string | null;
    detail?: string | null;
  }): Promise<void> {
    this.suppressions.set(input.email.trim().toLowerCase(), {
      reason: input.reason,
      detail: input.detail ?? null,
    });
  }

  async insertNotification(
    delivery: NotificationDeliveryRecord,
  ): Promise<NotificationDeliveryRecord> {
    this.notifications.push(delivery);
    return delivery;
  }

  async insertPriceEvent(event: BookingPriceEvent): Promise<BookingPriceEvent> {
    this.priceEvents.push(event);
    return event;
  }

  async listPriceEvents(watchId: string): Promise<BookingPriceEvent[]> {
    return this.priceEvents
      .filter((event) => event.watchId === watchId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async incrementUsage(
    day: string,
    credits: number,
    requests: number,
    successes: number,
    failures: number,
    reused = 0,
  ): Promise<void> {
    const current = this.usage.get(day) ?? {
      day,
      credits: 0,
      requests: 0,
      successes: 0,
      failures: 0,
      reused: 0,
    };
    current.credits += credits;
    current.requests += requests;
    current.successes += successes;
    current.failures += failures;
    current.reused += reused;
    this.usage.set(day, current);
  }

  async sumUsage(fromDay: string, toDay: string) {
    let requests = 0;
    let credits = 0;
    for (const row of this.usage.values()) {
      if (row.day < fromDay || row.day > toDay) continue;
      requests += row.requests;
      credits += row.credits;
    }
    return { requests, credits };
  }

  async getUsage(day: string) {
    return this.usage.get(day) ?? null;
  }

  async searchStations(query: string) {
    const q = query.trim().toLowerCase();
    return this.stations
      .filter((station) =>
        [station.code, station.name, station.city, station.state]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 8);
  }

  async upsertStations(
    stations: Array<{ code: string; name: string; city: string; state: string }>,
  ): Promise<number> {
    let added = 0;
    for (const station of stations) {
      const existing = this.stations.find((item) => item.code === station.code);
      if (existing) {
        Object.assign(existing, station);
      } else {
        this.stations.push({ ...station });
        added += 1;
      }
    }
    return added;
  }
}
