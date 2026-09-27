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
  /** The most recent observation. */
  lastOpportunity: OpportunityFingerprint | null;
  /**
   * The fare the traveler was actually told about.
   *
   * A different fact from lastOpportunity, and the only one a "worth another
   * email?" comparison may use. Conflating them is what left travelers holding
   * an email about a fare that had sold out.
   */
  lastAlertedOpportunity: OpportunityFingerprint | null;
  opportunityLostNotified: boolean;
  departureAlertSent: boolean;
  /** Null means the default. Per-watch re-alert threshold. */
  alertImprovementCents: number | null;
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
  /**
   * The cheapest eligible fare this cycle saw, or null for "looked, saw
   * nothing".
   *
   * Null is a real observation and not a missing value: a provider outage and
   * an empty corridor both produce it, and the chart draws a gap rather than a
   * crash to zero. Before this the product checked three times a day and kept
   * only the latest number, so there was no fare history to show — the panel
   * headed "Price history" plotted the traveler's own booking changes.
   */
  bestPriceCents: number | null;
  /** Which day in the window that fare was on. */
  bestTravelDate: string | null;
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
  /**
   * A date-search outcome, or IN_FLIGHT while a worker is running it.
   *
   * IN_FLIGHT is a provider-request fact, not a date outcome: it never reaches
   * a snapshot or a cycle status, and findFreshSearch filters it out so it can
   * never be served as a result with no journeys behind it.
   */
  status: DateSearchStatus | "IN_FLIGHT";
  creditsConsumed: number | null;
  latencyMs: number;
  errorMessage: string | null;
  reusedFromId: string | null;
  /**
   * Cheapest believable fare this search returned, at one adult.
   *
   * The corridor history. Every search already recorded where and when; this
   * records what it found, which is what lets a brand-new watch know anything
   * at all about a corridor the product has been scraping for a week.
   *
   * Believable meaning it passed fare-sanity: a misparse must not drag a
   * corridor's floor down and make every traveler on it think they overpaid.
   * Null is "found nothing, failed, or still in flight".
   */
  cheapestPriceCents: number | null;
  createdAt: string;
}

/** One search's outcome, for a corridor summary. See corridor-stats. */
export interface CorridorObservation {
  at: string;
  travelDate: string;
  cheapestPriceCents: number;
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

export type ScheduledRunStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "ABANDONED";

export interface ScheduledCheckRun {
  id: string;
  watchId: string;
  localCheckDate: string;
  checkSlot: CheckSlot;
  /** Null until the run finishes. It used to be the string "pending" forever. */
  cycleId: string | null;
  createdAt: string;
  status: ScheduledRunStatus;
  attempts: number;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  leaseExpiresAt: string | null;
  failureReason: string | null;
}

/** One alert decision, including the silent ones. See migration 20260926180000. */
export interface AlertDecisionRecord {
  id: string;
  watchId: string;
  cycleId: string | null;
  reason: string;
  notified: boolean;
  alertedFingerprint: OpportunityFingerprint | null;
  observedFingerprint: OpportunityFingerprint | null;
  explanation: string;
  createdAt: string;
}
