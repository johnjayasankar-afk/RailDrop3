import type {
  CheckSlot,
  CycleStatus,
  CycleTrigger,
  DateSearchStatus,
  FareFamily,
  JourneyOption,
  MonitorPreset,
  OpportunityFingerprint,
  TravelClass,
  WatchStatus,
} from "@/lib/domain/types";
import type { DateFlexibilityDays } from "@/lib/domain/calendar";

export interface Profile {
  id: string;
  email: string;
  timezone: string;
  createdAt: string;
}

export interface WatchRecord {
  id: string;
  userId: string;
  originCode: string;
  destinationCode: string;
  desiredTravelDate: string;
  dateFlexibilityDays: DateFlexibilityDays;
  preferredDepartureTime: string | null;
  passengerCount: number;
  bookedTrainNumber: string | null;
  bookedDepartureAt: string | null;
  bookedFareFamily: FareFamily;
  travelClass: TravelClass;
  currentBookedPriceCents: number;
  includeRestrictedFares: boolean;
  includeThruway: boolean;
  minimumSavingsCents: number;
  bookedAt: string;
  monitorStartAt: string;
  monitorEndAt: string | null;
  monitorPreset: MonitorPreset;
  timezone: string;
  alertEmail: string;
  status: WatchStatus;
  lastCheckCycleId: string | null;
  lastCheckedAt: string | null;
  nextCheckSlot: CheckSlot | null;
  nextCheckAtLabel: string | null;
  bestPriceCents: number | null;
  bestSavingsCents: number | null;
  lastOpportunity: OpportunityFingerprint | null;
  createdAt: string;
  updatedAt: string;
}

export interface FareCheckCycleRecord {
  id: string;
  watchId: string;
  trigger: CycleTrigger;
  checkSlot: CheckSlot | null;
  localCheckDate: string | null;
  status: CycleStatus;
  startedAt: string;
  completedAt: string | null;
  datesRequested: string[];
  datesSucceeded: string[];
  datesFailed: string[];
  journeysReturned: number;
  alertsSent: number;
  providerRequests: number;
  reusedSearches: number;
}

export interface DateSnapshotRecord {
  id: string;
  cycleId: string;
  watchId: string;
  travelDate: string;
  status: DateSearchStatus;
  searchKey: string;
  providerRequestId: string | null;
  errorMessage: string | null;
}

export interface ProviderRequestRecord {
  id: string;
  searchKey: string;
  cycleId: string | null;
  originCode: string;
  destinationCode: string;
  travelDate: string;
  passengerCount: number;
  status: DateSearchStatus;
  creditsConsumed: number | null;
  latencyMs: number;
  errorMessage: string | null;
  reusedFromId: string | null;
  createdAt: string;
}

export interface StoredJourney {
  id: string;
  cycleId: string;
  watchId: string;
  travelDate: string;
  option: JourneyOption;
}

export interface AlertRecord {
  id: string;
  watchId: string;
  cycleId: string;
  fingerprint: OpportunityFingerprint;
  subject: string;
  createdAt: string;
}

export interface NotificationDeliveryRecord {
  id: string;
  alertId: string;
  watchId: string;
  toEmail: string;
  status: "ATTEMPTED" | "ACCEPTED" | "FAILED";
  providerMessageId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface BookingPriceEvent {
  id: string;
  watchId: string;
  previousPriceCents: number;
  newPriceCents: number;
  previousTravelDate: string | null;
  newTravelDate: string | null;
  note: string;
  createdAt: string;
}

export interface ScheduledCheckRun {
  id: string;
  watchId: string;
  localCheckDate: string;
  checkSlot: CheckSlot;
  cycleId: string;
  createdAt: string;
}
