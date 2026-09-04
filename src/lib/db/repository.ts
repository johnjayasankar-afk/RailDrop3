import type { CheckSlot, JourneyOption, OpportunityFingerprint } from "@/lib/domain/types";
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
  claimScheduledRun(run: ScheduledCheckRun): Promise<ScheduledCheckRun | null>;
  insertProviderRequest(request: ProviderRequestRecord): Promise<ProviderRequestRecord>;
  findFreshSearch(searchKey: string, notBeforeIso: string): Promise<ProviderRequestRecord | null>;
  getProviderRequest(id: string): Promise<ProviderRequestRecord | null>;
  insertDateSnapshot(snapshot: DateSnapshotRecord): Promise<DateSnapshotRecord>;
  listDateSnapshots(cycleId: string): Promise<DateSnapshotRecord[]>;
  insertJourneys(journeys: StoredJourney[]): Promise<void>;
  listJourneysForCycle(cycleId: string): Promise<StoredJourney[]>;
  getCachedJourneys(providerRequestId: string): Promise<JourneyOption[]>;
  cacheJourneys(providerRequestId: string, journeys: JourneyOption[]): Promise<void>;
  insertAlert(alert: AlertRecord): Promise<AlertRecord>;
  listAlertsForWatch(watchId: string): Promise<AlertRecord[]>;
  insertNotification(delivery: NotificationDeliveryRecord): Promise<NotificationDeliveryRecord>;
  insertPriceEvent(event: BookingPriceEvent): Promise<BookingPriceEvent>;
  listPriceEvents(watchId: string): Promise<BookingPriceEvent[]>;
  incrementUsage(
    day: string,
    credits: number,
    requests: number,
    successes: number,
    failures: number,
  ): Promise<void>;
  getUsage(day: string): Promise<{
    day: string;
    credits: number;
    requests: number;
    successes: number;
    failures: number;
  } | null>;
  searchStations(
    query: string,
  ): Promise<Array<{ code: string; name: string; city: string; state: string }>>;
  upsertStations(
    stations: Array<{ code: string; name: string; city: string; state: string }>,
  ): Promise<number>;
}
