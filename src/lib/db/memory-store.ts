import { STATIONS } from "@/lib/stations/catalog";
import type { JourneyOption } from "@/lib/domain/types";
import type {
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
} from "./models";
import type { RailDropRepository, WatchUpdate } from "./repository";

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
    { day: string; credits: number; requests: number; successes: number; failures: number }
  >();
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

  async claimScheduledRun(run: ScheduledCheckRun): Promise<ScheduledCheckRun | null> {
    const key = `${run.watchId}:${run.localCheckDate}:${run.checkSlot}`;
    if (this.scheduled.has(key)) return null;
    this.scheduled.set(key, run);
    return run;
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
            request.createdAt >= notBeforeIso,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
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

  async getCachedJourneys(providerRequestId: string): Promise<JourneyOption[]> {
    return this.cachedJourneys.get(providerRequestId) ?? [];
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
  ): Promise<void> {
    const current = this.usage.get(day) ?? {
      day,
      credits: 0,
      requests: 0,
      successes: 0,
      failures: 0,
    };
    current.credits += credits;
    current.requests += requests;
    current.successes += successes;
    current.failures += failures;
    this.usage.set(day, current);
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
