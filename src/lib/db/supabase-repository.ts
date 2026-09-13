import type { SupabaseClient } from "@supabase/supabase-js";
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

export class SupabaseRepository implements RailDropRepository {
  constructor(private readonly db: SupabaseClient) {}

  async upsertProfile(profile: Profile): Promise<Profile> {
    const { error } = await this.db.from("profiles").upsert({
      id: profile.id,
      email: profile.email,
      timezone: profile.timezone,
    });
    if (error) throw new Error(error.message);
    return profile;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.db
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapProfile(data) : null;
  }

  async createWatch(watch: WatchRecord): Promise<WatchRecord> {
    const { error } = await this.db.from("watches").insert(watchToRow(watch));
    if (error) throw new Error(error.message);
    return watch;
  }

  async getWatch(id: string): Promise<WatchRecord | null> {
    const { data, error } = await this.db.from("watches").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? mapWatch(data) : null;
  }

  async listWatchesForUser(userId: string): Promise<WatchRecord[]> {
    const { data, error } = await this.db
      .from("watches")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapWatch);
  }

  async listActiveWatches(): Promise<WatchRecord[]> {
    const { data, error } = await this.db.from("watches").select("*").eq("status", "ACTIVE");
    if (error) throw error;
    return (data ?? []).map(mapWatch);
  }

  async updateWatch(id: string, patch: WatchUpdate): Promise<WatchRecord> {
    const { data, error } = await this.db
      .from("watches")
      .update(watchPatchToRow(patch))
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return mapWatch(data);
  }

  async deleteWatch(id: string, userId: string): Promise<void> {
    const { error } = await this.db.from("watches").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
  }

  async insertCycle(cycle: FareCheckCycleRecord): Promise<FareCheckCycleRecord> {
    const { error } = await this.db.from("fare_check_cycles").insert(cycleToRow(cycle));
    if (error) throw error;
    return cycle;
  }

  async updateCycle(
    id: string,
    patch: Partial<FareCheckCycleRecord>,
  ): Promise<FareCheckCycleRecord> {
    const { data, error } = await this.db
      .from("fare_check_cycles")
      .update(cycleToRow(patch as FareCheckCycleRecord, true))
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return mapCycle(data);
  }

  async getCycle(id: string): Promise<FareCheckCycleRecord | null> {
    const { data, error } = await this.db
      .from("fare_check_cycles")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapCycle(data) : null;
  }

  async listCyclesForWatch(watchId: string): Promise<FareCheckCycleRecord[]> {
    const { data, error } = await this.db
      .from("fare_check_cycles")
      .select("*")
      .eq("watch_id", watchId)
      .order("started_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapCycle);
  }

  async claimScheduledRun(run: ScheduledCheckRun): Promise<ScheduledCheckRun | null> {
    const { data, error } = await this.db
      .from("scheduled_check_runs")
      .insert({
        id: run.id,
        watch_id: run.watchId,
        local_check_date: run.localCheckDate,
        check_slot: run.checkSlot,
        cycle_id: run.cycleId,
      })
      .select("*")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") return null;
      throw error;
    }
    return data ? run : null;
  }

  async insertProviderRequest(request: ProviderRequestRecord): Promise<ProviderRequestRecord> {
    const { error } = await this.db.from("provider_requests").insert({
      id: request.id,
      search_key: request.searchKey,
      cycle_id: request.cycleId,
      origin_code: request.originCode,
      destination_code: request.destinationCode,
      travel_date: request.travelDate,
      passenger_count: request.passengerCount,
      status: request.status,
      credits_consumed: request.creditsConsumed,
      latency_ms: request.latencyMs,
      error_message: request.errorMessage,
      reused_from_id: request.reusedFromId,
    });
    if (error) throw error;
    return request;
  }

  async findFreshSearch(
    searchKey: string,
    notBeforeIso: string,
  ): Promise<ProviderRequestRecord | null> {
    const { data, error } = await this.db
      .from("provider_requests")
      .select("*")
      .eq("search_key", searchKey)
      .is("reused_from_id", null)
      .neq("status", "PROVIDER_ERROR")
      .gte("created_at", notBeforeIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapProviderRequest(data) : null;
  }

  async getProviderRequest(id: string): Promise<ProviderRequestRecord | null> {
    const { data, error } = await this.db
      .from("provider_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapProviderRequest(data) : null;
  }

  async insertDateSnapshot(snapshot: DateSnapshotRecord): Promise<DateSnapshotRecord> {
    const { error } = await this.db.from("fare_snapshots").insert({
      id: snapshot.id,
      cycle_id: snapshot.cycleId,
      watch_id: snapshot.watchId,
      travel_date: snapshot.travelDate,
      status: snapshot.status,
      search_key: snapshot.searchKey,
      provider_request_id: snapshot.providerRequestId,
      error_message: snapshot.errorMessage,
    });
    if (error) throw error;
    return snapshot;
  }

  async listDateSnapshots(cycleId: string): Promise<DateSnapshotRecord[]> {
    const { data, error } = await this.db
      .from("fare_snapshots")
      .select("*")
      .eq("cycle_id", cycleId);
    if (error) throw error;
    return (data ?? []).map(mapSnapshot);
  }

  async insertJourneys(journeys: StoredJourney[]): Promise<void> {
    if (journeys.length === 0) return;
    const { error } = await this.db.from("journey_options").insert(
      journeys.map((journey) => ({
        id: journey.id,
        cycle_id: journey.cycleId,
        watch_id: journey.watchId,
        travel_date: journey.travelDate,
        payload: journey.option,
      })),
    );
    if (error) throw error;
  }

  async listJourneysForCycle(cycleId: string): Promise<StoredJourney[]> {
    const { data, error } = await this.db
      .from("journey_options")
      .select("*")
      .eq("cycle_id", cycleId);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      cycleId: row.cycle_id,
      watchId: row.watch_id,
      travelDate: row.travel_date,
      option: row.payload as JourneyOption,
    }));
  }

  async getCachedJourneys(providerRequestId: string): Promise<JourneyOption[]> {
    const { data, error } = await this.db
      .from("search_cache")
      .select("payload")
      .eq("provider_request_id", providerRequestId)
      .maybeSingle();
    if (error) throw error;
    return (data?.payload as JourneyOption[]) ?? [];
  }

  async cacheJourneys(providerRequestId: string, journeys: JourneyOption[]): Promise<void> {
    const { error } = await this.db.from("search_cache").upsert({
      provider_request_id: providerRequestId,
      payload: journeys,
    });
    if (error) throw error;
  }

  async insertAlert(alert: AlertRecord): Promise<AlertRecord> {
    const { error } = await this.db.from("alerts").insert({
      id: alert.id,
      watch_id: alert.watchId,
      cycle_id: alert.cycleId,
      fingerprint: alert.fingerprint,
      subject: alert.subject,
    });
    if (error) throw error;
    return alert;
  }

  async listAlertsForWatch(watchId: string): Promise<AlertRecord[]> {
    const { data, error } = await this.db.from("alerts").select("*").eq("watch_id", watchId);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      watchId: row.watch_id,
      cycleId: row.cycle_id,
      fingerprint: row.fingerprint,
      subject: row.subject,
      createdAt: row.created_at,
    }));
  }

  async insertNotification(
    delivery: NotificationDeliveryRecord,
  ): Promise<NotificationDeliveryRecord> {
    const { error } = await this.db.from("notification_deliveries").insert({
      id: delivery.id,
      alert_id: delivery.alertId,
      watch_id: delivery.watchId,
      to_email: delivery.toEmail,
      status: delivery.status,
      provider_message_id: delivery.providerMessageId,
      error_message: delivery.errorMessage,
    });
    if (error) throw error;
    return delivery;
  }

  async insertPriceEvent(event: BookingPriceEvent): Promise<BookingPriceEvent> {
    const { error } = await this.db.from("booking_price_events").insert({
      id: event.id,
      watch_id: event.watchId,
      previous_price_cents: event.previousPriceCents,
      new_price_cents: event.newPriceCents,
      previous_travel_date: event.previousTravelDate,
      new_travel_date: event.newTravelDate,
      note: event.note,
    });
    if (error) throw error;
    return event;
  }

  async listPriceEvents(watchId: string): Promise<BookingPriceEvent[]> {
    const { data, error } = await this.db
      .from("booking_price_events")
      .select("*")
      .eq("watch_id", watchId)
      .order("created_at");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      watchId: row.watch_id,
      previousPriceCents: row.previous_price_cents,
      newPriceCents: row.new_price_cents,
      previousTravelDate: row.previous_travel_date,
      newTravelDate: row.new_travel_date,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  async incrementUsage(
    day: string,
    credits: number,
    requests: number,
    successes: number,
    failures: number,
  ): Promise<void> {
    const { error } = await this.db.rpc("increment_provider_usage", {
      usage_day: day,
      add_credits: credits,
      add_requests: requests,
      add_successes: successes,
      add_failures: failures,
    });
    if (error) throw error;
  }

  async getUsage(day: string) {
    const { data, error } = await this.db
      .from("provider_usage_daily")
      .select("*")
      .eq("day", day)
      .maybeSingle();
    if (error) throw error;
    return data
      ? {
          day: data.day,
          credits: data.credits,
          requests: data.requests,
          successes: data.successes,
          failures: data.failures,
        }
      : null;
  }

  async searchStations(query: string) {
    const { data, error } = await this.db
      .from("stations")
      .select("code,name,city,state")
      .or(`code.ilike.%${query}%,name.ilike.%${query}%,city.ilike.%${query}%`)
      .limit(8);
    if (error) throw error;
    return data ?? [];
  }

  async upsertStations(
    stations: Array<{ code: string; name: string; city: string; state: string }>,
  ): Promise<number> {
    const { error } = await this.db.from("stations").upsert(
      stations.map((station) => ({
        code: station.code,
        name: station.name,
        city: station.city,
        state: station.state,
        country: "US",
      })),
    );
    if (error) throw error;
    return stations.length;
  }
}

function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    email: String(row.email),
    timezone: String(row.timezone),
    createdAt: String(row.created_at),
  };
}

function mapWatch(row: Record<string, unknown>): WatchRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    originCode: String(row.origin_code),
    destinationCode: String(row.destination_code),
    desiredTravelDate: String(row.desired_travel_date),
    dateFlexibilityDays: Number(row.date_flexibility_days) as WatchRecord["dateFlexibilityDays"],
    preferredDepartureTime: (row.preferred_departure_time as string | null) ?? null,
    passengerCount: Number(row.passenger_count),
    bookedTrainNumber: (row.booked_train_number as string | null) ?? null,
    bookedDepartureAt: (row.booked_departure_at as string | null) ?? null,
    bookedFareFamily: row.booked_fare_family as WatchRecord["bookedFareFamily"],
    travelClass: row.travel_class as WatchRecord["travelClass"],
    currentBookedPriceCents: Number(row.current_booked_price_cents),
    includeRestrictedFares: Boolean(row.include_restricted_fares),
    includeThruway: Boolean(row.include_thruway),
    minimumSavingsCents: Number(row.minimum_savings_cents),
    bookedAt: String(row.booked_at),
    monitorStartAt: String(row.monitor_start_at),
    monitorEndAt: (row.monitor_end_at as string | null) ?? null,
    monitorPreset: row.monitor_preset as WatchRecord["monitorPreset"],
    timezone: String(row.timezone),
    alertEmail: String(row.alert_email),
    status: row.status as WatchRecord["status"],
    lastCheckCycleId: (row.last_check_cycle_id as string | null) ?? null,
    lastCheckedAt: (row.last_checked_at as string | null) ?? null,
    nextCheckSlot: (row.next_check_slot as WatchRecord["nextCheckSlot"]) ?? null,
    nextCheckAtLabel: (row.next_check_at_label as string | null) ?? null,
    bestPriceCents: (row.best_price_cents as number | null) ?? null,
    bestSavingsCents: (row.best_savings_cents as number | null) ?? null,
    lastOpportunity: (row.last_opportunity as WatchRecord["lastOpportunity"]) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function watchToRow(watch: WatchRecord) {
  return {
    id: watch.id,
    user_id: watch.userId,
    origin_code: watch.originCode,
    destination_code: watch.destinationCode,
    desired_travel_date: watch.desiredTravelDate,
    date_flexibility_days: watch.dateFlexibilityDays,
    preferred_departure_time: watch.preferredDepartureTime,
    passenger_count: watch.passengerCount,
    booked_train_number: watch.bookedTrainNumber,
    booked_departure_at: watch.bookedDepartureAt,
    booked_fare_family: watch.bookedFareFamily,
    travel_class: watch.travelClass,
    current_booked_price_cents: watch.currentBookedPriceCents,
    include_restricted_fares: watch.includeRestrictedFares,
    include_thruway: watch.includeThruway,
    minimum_savings_cents: watch.minimumSavingsCents,
    booked_at: watch.bookedAt,
    monitor_start_at: watch.monitorStartAt,
    monitor_end_at: watch.monitorEndAt,
    monitor_preset: watch.monitorPreset,
    timezone: watch.timezone,
    alert_email: watch.alertEmail,
    status: watch.status,
    last_opportunity: watch.lastOpportunity,
  };
}

function watchPatchToRow(patch: WatchUpdate) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.currentBookedPriceCents !== undefined)
    row.current_booked_price_cents = patch.currentBookedPriceCents;
  if (patch.desiredTravelDate !== undefined) row.desired_travel_date = patch.desiredTravelDate;
  if (patch.bookedTrainNumber !== undefined) row.booked_train_number = patch.bookedTrainNumber;
  if (patch.bookedDepartureAt !== undefined) row.booked_departure_at = patch.bookedDepartureAt;
  if (patch.bookedFareFamily !== undefined) row.booked_fare_family = patch.bookedFareFamily;
  if (patch.lastCheckCycleId !== undefined) row.last_check_cycle_id = patch.lastCheckCycleId;
  if (patch.lastCheckedAt !== undefined) row.last_checked_at = patch.lastCheckedAt;
  if (patch.nextCheckSlot !== undefined) row.next_check_slot = patch.nextCheckSlot;
  if (patch.nextCheckAtLabel !== undefined) row.next_check_at_label = patch.nextCheckAtLabel;
  if (patch.bestPriceCents !== undefined) row.best_price_cents = patch.bestPriceCents;
  if (patch.bestSavingsCents !== undefined) row.best_savings_cents = patch.bestSavingsCents;
  if (patch.lastOpportunity !== undefined) row.last_opportunity = patch.lastOpportunity;
  if (patch.monitorEndAt !== undefined) row.monitor_end_at = patch.monitorEndAt;
  if (patch.monitorPreset !== undefined) row.monitor_preset = patch.monitorPreset;
  if (patch.monitorStartAt !== undefined) row.monitor_start_at = patch.monitorStartAt;
  if (patch.alertEmail !== undefined) row.alert_email = patch.alertEmail;
  if (patch.minimumSavingsCents !== undefined)
    row.minimum_savings_cents = patch.minimumSavingsCents;
  if (patch.includeRestrictedFares !== undefined)
    row.include_restricted_fares = patch.includeRestrictedFares;
  if (patch.includeThruway !== undefined) row.include_thruway = patch.includeThruway;
  if (patch.preferredDepartureTime !== undefined)
    row.preferred_departure_time = patch.preferredDepartureTime;
  return row;
}

function cycleToRow(cycle: FareCheckCycleRecord, partial = false) {
  const row: Record<string, unknown> = {};
  if (!partial) {
    row.id = cycle.id;
    row.watch_id = cycle.watchId;
    row.trigger = cycle.trigger;
    row.check_slot = cycle.checkSlot;
    row.local_check_date = cycle.localCheckDate;
    row.started_at = cycle.startedAt;
  }
  if (cycle.status !== undefined) row.status = cycle.status;
  if (cycle.completedAt !== undefined) row.completed_at = cycle.completedAt;
  if (cycle.datesRequested !== undefined) row.dates_requested = cycle.datesRequested;
  if (cycle.datesSucceeded !== undefined) row.dates_succeeded = cycle.datesSucceeded;
  if (cycle.datesFailed !== undefined) row.dates_failed = cycle.datesFailed;
  if (cycle.journeysReturned !== undefined) row.journeys_returned = cycle.journeysReturned;
  if (cycle.alertsSent !== undefined) row.alerts_sent = cycle.alertsSent;
  if (cycle.providerRequests !== undefined) row.provider_requests = cycle.providerRequests;
  if (cycle.reusedSearches !== undefined) row.reused_searches = cycle.reusedSearches;
  return row;
}

function mapCycle(row: Record<string, unknown>): FareCheckCycleRecord {
  return {
    id: String(row.id),
    watchId: String(row.watch_id),
    trigger: row.trigger as FareCheckCycleRecord["trigger"],
    checkSlot: (row.check_slot as FareCheckCycleRecord["checkSlot"]) ?? null,
    localCheckDate: (row.local_check_date as string | null) ?? null,
    status: row.status as FareCheckCycleRecord["status"],
    startedAt: String(row.started_at),
    completedAt: (row.completed_at as string | null) ?? null,
    datesRequested: (row.dates_requested as string[]) ?? [],
    datesSucceeded: (row.dates_succeeded as string[]) ?? [],
    datesFailed: (row.dates_failed as string[]) ?? [],
    journeysReturned: Number(row.journeys_returned ?? 0),
    alertsSent: Number(row.alerts_sent ?? 0),
    providerRequests: Number(row.provider_requests ?? 0),
    reusedSearches: Number(row.reused_searches ?? 0),
  };
}

function mapProviderRequest(row: Record<string, unknown>): ProviderRequestRecord {
  return {
    id: String(row.id),
    searchKey: String(row.search_key),
    cycleId: (row.cycle_id as string | null) ?? null,
    originCode: String(row.origin_code),
    destinationCode: String(row.destination_code),
    travelDate: String(row.travel_date),
    passengerCount: Number(row.passenger_count),
    status: row.status as ProviderRequestRecord["status"],
    creditsConsumed: (row.credits_consumed as number | null) ?? null,
    latencyMs: Number(row.latency_ms ?? 0),
    errorMessage: (row.error_message as string | null) ?? null,
    reusedFromId: (row.reused_from_id as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapSnapshot(row: Record<string, unknown>): DateSnapshotRecord {
  return {
    id: String(row.id),
    cycleId: String(row.cycle_id),
    watchId: String(row.watch_id),
    travelDate: String(row.travel_date),
    status: row.status as DateSnapshotRecord["status"],
    searchKey: String(row.search_key),
    providerRequestId: (row.provider_request_id as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
  };
}
