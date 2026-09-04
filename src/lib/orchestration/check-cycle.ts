import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { BookingLinkResolver } from "@/lib/booking/booking-link-resolver";
import { generateSearchDates } from "@/lib/domain/calendar";
import { collectEligibleFares } from "@/lib/domain/eligibility";
import { cheapestByDate, rankCandidates } from "@/lib/domain/ranking";
import { OpportunityComparator } from "@/lib/domain/opportunity";
import { shouldCompleteWatch, usableSearchDates } from "@/lib/domain/monitoring";
import { canonicalSearchKey, DEFAULT_PROVIDER_ID } from "@/lib/domain/search-key";
import { localIsoDate, nextSlotAfter } from "@/lib/domain/timezone";
import type {
  CycleStatus,
  CycleTrigger,
  DateSearchStatus,
  FareSearchResult,
  JourneyOption,
} from "@/lib/domain/types";
import type { FareCheckCycleRecord, WatchRecord } from "@/lib/db/models";
import type { RailDropRepository } from "@/lib/db/repository";
import type { FareProvider } from "@/lib/providers/fare-provider";
import { sendFareDropEmail, type Mailer } from "@/lib/notifications/send-alert";

const SEARCH_FRESHNESS_MS = 20 * 60 * 1000;

export interface CycleResult {
  cycle: FareCheckCycleRecord;
  watch: WatchRecord;
  rankedCount: number;
  qualifyingCount: number;
  alertSent: boolean;
}

export async function runWatchCycle(input: {
  watch: WatchRecord;
  trigger: CycleTrigger;
  checkSlot?: WatchRecord["nextCheckSlot"];
  localCheckDate?: string;
  now?: Date;
  repo: RailDropRepository;
  provider: FareProvider;
  mailer?: Mailer;
  searchCache?: Map<string, FareSearchResult>;
}): Promise<CycleResult> {
  const now = input.now ?? new Date();
  const config = getConfig();
  const watch = input.watch;

  if (
    shouldCompleteWatch({
      now,
      monitorEndAt: watch.monitorEndAt ? new Date(watch.monitorEndAt) : null,
      desiredTravelDate: watch.desiredTravelDate,
      flexibilityDays: watch.dateFlexibilityDays,
      timeZone: watch.timezone,
    })
  ) {
    const completed = await input.repo.updateWatch(watch.id, { status: "COMPLETED" });
    logger.info("watch.completed", { watchId: watch.id });
    return {
      cycle: emptyCompletedCycle(watch.id, input.trigger),
      watch: completed,
      rankedCount: 0,
      qualifyingCount: 0,
      alertSent: false,
    };
  }

  const dates = usableSearchDates({
    now,
    desiredTravelDate: watch.desiredTravelDate,
    flexibilityDays: watch.dateFlexibilityDays,
    timeZone: watch.timezone,
  });
  const window = generateSearchDates(
    watch.desiredTravelDate,
    watch.dateFlexibilityDays,
    localIsoDate(now, watch.timezone),
  );

  const cycleId = crypto.randomUUID();
  const cycle = await input.repo.insertCycle({
    id: cycleId,
    watchId: watch.id,
    trigger: input.trigger,
    checkSlot: input.checkSlot ?? null,
    localCheckDate: input.localCheckDate ?? null,
    status: "RUNNING",
    startedAt: now.toISOString(),
    completedAt: null,
    datesRequested: dates,
    datesSucceeded: [],
    datesFailed: [],
    journeysReturned: 0,
    alertsSent: 0,
    providerRequests: 0,
    reusedSearches: 0,
  });

  const datesSucceeded: string[] = [];
  const datesFailed: string[] = [];
  const allJourneys: JourneyOption[] = [];
  let providerRequests = 0;
  let reusedSearches = 0;
  let credits = 0;
  const parallel = config.isLocal && !config.isE2E;

  const dateResults = await mapPool(dates, parallel ? 3 : 1, async (travelDate) => {
    const request = {
      originCode: watch.originCode,
      destinationCode: watch.destinationCode,
      travelDate,
      passengers: { adultCount: watch.passengerCount },
    };
    const searchKey = canonicalSearchKey(DEFAULT_PROVIDER_ID, request);
    const freshnessFloor = new Date(now.getTime() - SEARCH_FRESHNESS_MS).toISOString();

    let result = input.searchCache?.get(searchKey) ?? null;
    let reused = false;

    if (!result) {
      const existing = await input.repo.findFreshSearch(searchKey, freshnessFloor);
      if (existing) {
        const cached = await input.repo.getCachedJourneys(existing.id);
        result = {
          request,
          status: existing.status,
          journeys: cached,
          metadata: {
            provider: DEFAULT_PROVIDER_ID,
            requestId: existing.id,
            retrievedAt: existing.createdAt,
            latencyMs: existing.latencyMs,
            creditsCharged: 0,
          },
        };
      }
    }

    if (!result) {
      result = await input.provider.searchTrips(request);
      const requestId = result.metadata.requestId;
      await input.repo.insertProviderRequest({
        id: requestId,
        searchKey,
        cycleId,
        originCode: request.originCode,
        destinationCode: request.destinationCode,
        travelDate,
        passengerCount: watch.passengerCount,
        status: result.status,
        creditsConsumed: result.metadata.creditsCharged,
        latencyMs: result.metadata.latencyMs,
        errorMessage: result.providerError?.message ?? null,
        reusedFromId: null,
        createdAt: now.toISOString(),
      });
      if (result.status !== "PROVIDER_ERROR") {
        await input.repo.cacheJourneys(requestId, result.journeys);
      }
      input.searchCache?.set(searchKey, result);
    } else {
      reused = true;
      await input.repo.insertProviderRequest({
        id: crypto.randomUUID(),
        searchKey,
        cycleId,
        originCode: request.originCode,
        destinationCode: request.destinationCode,
        travelDate,
        passengerCount: watch.passengerCount,
        status: result.status,
        creditsConsumed: 0,
        latencyMs: 0,
        errorMessage: null,
        reusedFromId: result.metadata.requestId,
        createdAt: now.toISOString(),
      });
    }

    return { travelDate, searchKey, result, reused };
  });

  for (const { travelDate, searchKey, result, reused } of dateResults) {
    if (reused) {
      reusedSearches += 1;
    } else {
      providerRequests += 1;
      credits +=
        result.metadata.creditsCharged ??
        (result.status === "PROVIDER_ERROR" ? 0 : config.providerCreditsPerSearch);
    }

    const status: DateSearchStatus =
      result.status === "SUCCESS" && result.journeys.length === 0 ? "NO_INVENTORY" : result.status;

    if (status === "PROVIDER_ERROR") {
      datesFailed.push(travelDate);
    } else {
      datesSucceeded.push(travelDate);
      allJourneys.push(...result.journeys);
    }

    await input.repo.insertDateSnapshot({
      id: crypto.randomUUID(),
      cycleId,
      watchId: watch.id,
      travelDate,
      status,
      searchKey,
      providerRequestId: result.metadata.requestId,
      errorMessage: result.providerError?.message ?? null,
    });
  }

  const eligible = collectEligibleFares(allJourneys, {
    includeRestrictedFares: watch.includeRestrictedFares,
    includeThruway: watch.includeThruway,
    travelClass: watch.travelClass,
    requireAvailable: true,
  });
  const ranked = rankCandidates(eligible, {
    desiredTravelDate: watch.desiredTravelDate,
    preferredDepartureTime: watch.preferredDepartureTime,
    currentBookedPriceCents: watch.currentBookedPriceCents,
  });
  const comparator = new OpportunityComparator();
  const opportunity = comparator.decide(
    watch.lastOpportunity,
    ranked,
    watch.currentBookedPriceCents,
    watch.minimumSavingsCents,
  );

  await input.repo.insertJourneys(
    allJourneys.map((option) => ({
      id: crypto.randomUUID(),
      cycleId,
      watchId: watch.id,
      travelDate: option.searchedTravelDate,
      option,
    })),
  );

  let alertSent = false;
  const alertTo = watch.alertEmail?.trim() ?? "";
  if (opportunity.decision.notify && opportunity.fingerprint && input.mailer && alertTo) {
    const cheapest = cheapestByDate(opportunity.qualifying);
    const subject = buildAlertSubject(watch, opportunity.qualifying[0]);
    const alert = await input.repo.insertAlert({
      id: crypto.randomUUID(),
      watchId: watch.id,
      cycleId,
      fingerprint: opportunity.fingerprint,
      subject,
      createdAt: now.toISOString(),
    });
    const delivery = await sendFareDropEmail({
      mailer: input.mailer,
      to: alertTo,
      watch,
      best: opportunity.qualifying[0],
      others: opportunity.qualifying.slice(1, 4),
      byDate: cheapest,
      appUrl: `${config.appUrl}/watches/${watch.id}`,
      checkedAt: now,
      cycleStatus: resolveCycleStatus(dates, datesSucceeded, datesFailed, allJourneys.length),
      skippedPastDates: window.skippedPastDates,
    });
    await input.repo.insertNotification({
      id: crypto.randomUUID(),
      alertId: alert.id,
      watchId: watch.id,
      toEmail: alertTo,
      status: delivery.status,
      providerMessageId: delivery.providerMessageId,
      errorMessage: delivery.errorMessage,
      createdAt: now.toISOString(),
    });
    alertSent = delivery.status === "ACCEPTED";
  }

  const status = resolveCycleStatus(dates, datesSucceeded, datesFailed, allJourneys.length);
  const next = nextSlotAfter(now, watch.timezone);
  const best = ranked[0] ?? null;
  const updatedCycle = await input.repo.updateCycle(cycle.id, {
    status,
    completedAt: new Date().toISOString(),
    datesSucceeded,
    datesFailed,
    journeysReturned: allJourneys.length,
    alertsSent: alertSent ? 1 : 0,
    providerRequests,
    reusedSearches,
  });
  const updatedWatch = await input.repo.updateWatch(watch.id, {
    lastCheckCycleId: cycle.id,
    lastCheckedAt: now.toISOString(),
    nextCheckSlot: next.slot,
    nextCheckAtLabel: next.label,
    bestPriceCents: best?.totalPartyPriceCents ?? null,
    bestSavingsCents: best && best.savingsCents > 0 ? best.savingsCents : null,
    lastOpportunity: opportunity.fingerprint ?? watch.lastOpportunity,
  });

  await input.repo.incrementUsage(
    localIsoDate(now, "UTC"),
    credits,
    providerRequests,
    datesSucceeded.length,
    datesFailed.length,
  );

  logger.info("cycle.completed", {
    cycleId: cycle.id,
    watchId: watch.id,
    trigger: input.trigger,
    watchCount: 1,
    dateSearches: dates.length,
    dedupSavings: reusedSearches,
    status,
    journeysReturned: allJourneys.length,
    alertsSent: alertSent ? 1 : 0,
    providerRequests,
  });

  return {
    cycle: updatedCycle,
    watch: updatedWatch,
    rankedCount: ranked.length,
    qualifyingCount: opportunity.qualifying.length,
    alertSent,
  };
}

function resolveCycleStatus(
  requested: string[],
  succeeded: string[],
  failed: string[],
  journeyCount: number,
): CycleStatus {
  if (requested.length === 0) return "NO_AVAILABLE_ITINERARIES";
  if (failed.length === requested.length) return "PROVIDER_ERROR";
  if (failed.length > 0) return "PARTIAL_SUCCESS";
  if (journeyCount === 0) return "NO_AVAILABLE_ITINERARIES";
  if (succeeded.length === requested.length) return "SUCCESS";
  return "PARTIAL_SUCCESS";
}

function buildAlertSubject(
  watch: WatchRecord,
  best: { totalPartyPriceCents: number; savingsCents: number },
): string {
  const price = (best.totalPartyPriceCents / 100).toFixed(0);
  const save = (best.savingsCents / 100).toFixed(0);
  return `Fare drop: ${watch.originCode} → ${watch.destinationCode} from $${price} — save $${save}`;
}

function emptyCompletedCycle(watchId: string, trigger: CycleTrigger): FareCheckCycleRecord {
  return {
    id: "completed",
    watchId,
    trigger,
    checkSlot: null,
    localCheckDate: null,
    status: "SUCCESS",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    datesRequested: [],
    datesSucceeded: [],
    datesFailed: [],
    journeysReturned: 0,
    alertsSent: 0,
    providerRequests: 0,
    reusedSearches: 0,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  if (limit === 1) {
    const out: R[] = [];
    for (const item of items) out.push(await fn(item));
    return out;
  }
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

export { BookingLinkResolver };
