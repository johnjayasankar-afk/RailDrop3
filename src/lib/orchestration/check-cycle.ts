import { appOrigin, getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { BookingLinkResolver } from "@/lib/booking/booking-link-resolver";
import { generateSearchDates } from "@/lib/domain/calendar";
import { collectEligibleFares } from "@/lib/domain/eligibility";
import { cheapestByDate, rankCandidates } from "@/lib/domain/ranking";
import { OpportunityComparator } from "@/lib/domain/opportunity";
import { shouldCompleteWatch, usableSearchDates } from "@/lib/domain/monitoring";
import { canonicalSearchKey, DEFAULT_PROVIDER_ID } from "@/lib/domain/search-key";
import { PEER_POLL_INTERVAL_MS, planSearch } from "@/lib/domain/search-dedup";
import {
  DEADLINE_SKIP_MESSAGE,
  hasTimeForAnotherSearch,
  searchDeadline,
} from "@/lib/domain/cycle-budget";
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
  /** Epoch ms after which no new provider search is started. Tests inject it. */
  searchDeadlineAt?: number;
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
  // Local can fan out; Vercel keeps concurrency low (Chromium memory) but >1 when possible.
  const parallel = config.isE2E ? 1 : config.isLocal ? 3 : 1;

  // With concurrency 1 on serverless, three slow dates can ask for more wall
  // clock than the function has. Past the deadline the remaining dates are
  // recorded as not-checked so the cycle finishes as PARTIAL_SUCCESS, instead
  // of the platform killing the invocation with nothing written down.
  // Wall clock, not the cycle's logical `now`: the budget is about how long
  // this invocation has actually been running, and a backfill or a test may
  // pass a timestamp from another day entirely.
  const deadline = input.searchDeadlineAt ?? searchDeadline(new Date());
  const observedMs: number[] = [];

  const dateResults = await mapPool(dates, parallel, async (travelDate) => {
    const request = {
      originCode: watch.originCode,
      destinationCode: watch.destinationCode,
      travelDate,
      passengers: { adultCount: watch.passengerCount },
    };
    const searchKey = canonicalSearchKey(DEFAULT_PROVIDER_ID, request);

    let result = input.searchCache?.get(searchKey) ?? null;
    let reused = false;

    /* Reuse, or wait for whoever is already doing it.
     *
     * The reuse itself is not new: a completed row for this canonical key
     * inside the freshness window is served from search_cache. What is new is
     * the waiting. Dispatch used to run watches one at a time, so the second
     * watch on a corridor always saw the first one's finished row. Now each
     * watch has its own invocation, and two can start the same search in the
     * same second — both miss, both launch a browser. So a search announces
     * itself first, and a peer waits for the answer rather than paying for it
     * twice. It gives up waiting rather than stalling its own cycle. */
    let waitedMs = 0;
    while (!result) {
      const newest = await input.repo.findNewestSearch(searchKey);
      const plan = planSearch({ newest, now: new Date(), waitedMs });

      if (plan.action === "reuse" && newest && newest.status !== "IN_FLIGHT") {
        const cached = await input.repo.getCachedJourneys(newest.id);
        result = {
          request,
          status: newest.status,
          journeys: cached,
          metadata: {
            provider: DEFAULT_PROVIDER_ID,
            requestId: newest.id,
            retrievedAt: newest.createdAt,
            latencyMs: newest.latencyMs,
            creditsCharged: 0,
          },
        };
        reused = true;
        break;
      }

      if (plan.action === "wait") {
        const nap = Math.min(PEER_POLL_INTERVAL_MS, plan.msRemaining);
        await new Promise((resolve) => setTimeout(resolve, nap));
        waitedMs += nap;
        continue;
      }

      break;
    }

    if (!result && !hasTimeForAnotherSearch({ now: Date.now(), deadline, observedMs })) {
      // Not attempted. Recorded as an error rather than as empty inventory:
      // we did not get an answer for this date, and "no cheaper fare" is a
      // claim this product does not make without one.
      return {
        travelDate,
        searchKey,
        result: {
          request,
          status: "PROVIDER_ERROR" as const,
          journeys: [],
          providerError: {
            code: "CYCLE_DEADLINE",
            message: DEADLINE_SKIP_MESSAGE,
            retryable: true,
          },
          metadata: {
            provider: DEFAULT_PROVIDER_ID,
            requestId: crypto.randomUUID(),
            retrievedAt: new Date().toISOString(),
            latencyMs: 0,
            creditsCharged: 0,
          },
        },
        reused: false,
        skipped: true,
      };
    }

    if (!result) {
      result = await input.provider.searchTrips(request);
      observedMs.push(result.metadata.latencyMs);
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

    return { travelDate, searchKey, result, reused, skipped: false };
  });

  for (const { travelDate, searchKey, result, reused, skipped } of dateResults) {
    if (skipped) {
      // No call was made, so no credit and no provider request to count.
      datesFailed.push(travelDate);
      await input.repo.insertDateSnapshot({
        id: crypto.randomUUID(),
        cycleId,
        watchId: watch.id,
        travelDate,
        status: "PROVIDER_ERROR",
        searchKey,
        providerRequestId: null,
        errorMessage: DEADLINE_SKIP_MESSAGE,
      });
      continue;
    }
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
      // appOrigin() rather than config.appUrl: NEXT_PUBLIC_APP_URL defaults to
      // localhost, and the setup docs have you set it AFTER the first deploy —
      // so the first production alerts went out with a dead CTA.
      appUrl: `${appOrigin()}/watches/${watch.id}`,
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
  return `Fare drop: ${watch.originCode} → ${watch.destinationCode} from $${price} · save $${save}`;
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
