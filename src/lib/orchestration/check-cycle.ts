import { appOrigin, getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { BookingLinkResolver } from "@/lib/booking/booking-link-resolver";
import { generateSearchDates } from "@/lib/domain/calendar";
import { collectEligibleFares } from "@/lib/domain/eligibility";
import { screenJourneys } from "@/lib/domain/fare-screen";
import { suspectEmptyDates, type DateOutcome } from "@/lib/domain/empty-result";
import { cheapestByDate, rankCandidates } from "@/lib/domain/ranking";
import { OpportunityComparator } from "@/lib/domain/opportunity";
import { decideAlert } from "@/lib/domain/alert-policy";
import { formatUsdCompact } from "@/lib/domain/money";
import { sendOpportunityLostEmail } from "@/lib/notifications/send-alert";
import { shouldCompleteWatch, usableSearchDates } from "@/lib/domain/monitoring";
import { canonicalSearchKey, DEFAULT_PROVIDER_ID } from "@/lib/domain/search-key";
import { PEER_POLL_INTERVAL_MS, planSearch } from "@/lib/domain/search-dedup";
import { budgetDecision, monthStart } from "@/lib/domain/provider-budget";
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
import type { DateSnapshotRecord, FareCheckCycleRecord, WatchRecord } from "@/lib/db/models";
import type { RailDropRepository } from "@/lib/db/repository";
import type { FareProvider } from "@/lib/providers/fare-provider";
import { sendFareDropEmail, type Mailer } from "@/lib/notifications/send-alert";

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
    bestPriceCents: null,
    bestTravelDate: null,
  });

  const datesSucceeded: string[] = [];
  const datesFailed: string[] = [];
  /** Dates we reached but could not read. Different from a date we never got. */
  const unreadableDates: string[] = [];
  /* What each date returned, so a zero can be judged against its neighbours.
   *
   * The provider eval found PHL→NYP returning zero trains on one date,
   * reproducibly, while the next day on the same corridor returned 33. A
   * served corridor runs trains daily, so that is a failed read — but from
   * inside a single date's search it is indistinguishable from an empty
   * timetable, and the board was calling it "nothing listed, not a problem at
   * our end". The window as a whole knows better. */
  const outcomes: DateOutcome[] = [];
  /** Snapshots for empty dates, held until the window can judge them. */
  const deferredSnapshots: Array<{ travelDate: string; snapshot: DateSnapshotRecord }> = [];
  const allJourneys: JourneyOption[] = [];
  let providerRequests = 0;
  let reusedSearches = 0;
  let credits = 0;
  /* How many dates to search at once.
   *
   * Three locally, measured — see the note on MAX_CONCURRENT_PAGES in
   * wanderu-browser-provider.ts for the numbers and for why the first, wrong
   * answer looked so convincing. One on serverless, for memory rather than
   * speed. RAILDROP_SEARCH_PARALLEL overrides, for tuning without a deploy. */
  const parallel = config.isE2E ? 1 : searchParallelism(config.isLocal);

  // With concurrency 1 on serverless, three slow dates can ask for more wall
  // clock than the function has. Past the deadline the remaining dates are
  // recorded as not-checked so the cycle finishes as PARTIAL_SUCCESS, instead
  // of the platform killing the invocation with nothing written down.
  // Wall clock, not the cycle's logical `now`: the budget is about how long
  // this invocation has actually been running, and a backfill or a test may
  // pass a timestamp from another day entirely.
  const deadline = input.searchDeadlineAt ?? searchDeadline(new Date());

  /* The spending ceiling, read once for the whole cycle.
   *
   * It existed only as a projection on the settings page before this: shown,
   * never enforced. Dispatch dying after two or three watches used to be an
   * accidental cap; 5.1 removed that, so this is the real one. */
  const usageDay = localIsoDate(now, "UTC");
  const [todayUsage, monthUsage] = await Promise.all([
    input.repo.getUsage(usageDay),
    input.repo.sumUsage(monthStart(usageDay), usageDay),
  ]);
  const budget = budgetDecision({
    searchesToday: todayUsage?.requests ?? 0,
    searchesThisMonth: monthUsage.requests,
    dailyCap: config.providerDailySearchBudget,
    monthlyCap: config.providerMonthlyCreditBudget,
  });
  if (!budget.allow) {
    logger.warn("cycle.budget_exhausted", {
      watch_id: watch.id,
      scope: budget.scope,
      searches_today: todayUsage?.requests ?? 0,
      searches_this_month: monthUsage.requests,
    });
  }
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
    /** Set only when this worker owns the claim and must therefore do the search. */
    let ownedRequestId: string | null = null;

    while (!result) {
      const newest = await input.repo.findNewestSearch(searchKey);
      const plan = planSearch({ newest, now, waitedMs });

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

      // Nothing usable and nobody working on it — but only if there is time
      // and money. Both checked before claiming, so a refused date never
      // strands an in-flight marker.
      if (!budget.allow) break;
      if (!hasTimeForAnotherSearch({ now: Date.now(), deadline, observedMs })) break;

      const candidateId = crypto.randomUUID();
      const won = await input.repo.markSearchInFlight({
        id: candidateId,
        searchKey,
        cycleId,
        originCode: request.originCode,
        destinationCode: request.destinationCode,
        travelDate,
        passengerCount: watch.passengerCount,
        status: "IN_FLIGHT",
        creditsConsumed: 0,
        latencyMs: 0,
        errorMessage: null,
        reusedFromId: null,
        // Not known until the search returns; finishProviderRequest fills it.
        cheapestPriceCents: null,
        createdAt: now.toISOString(),
      });

      if (!won) {
        // Someone claimed it between our look and our write. Wait for them.
        continue;
      }

      ownedRequestId = candidateId;
      break;
    }

    if (!result && !ownedRequestId) {
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
            code: budget.allow ? "CYCLE_DEADLINE" : "PROVIDER_BUDGET",
            // Either way this is "we did not get an answer", never "there was
            // nothing to find". A paused check must not read as a quiet market.
            message: budget.allow
              ? DEADLINE_SKIP_MESSAGE
              : (budget.reason ?? DEADLINE_SKIP_MESSAGE),
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

    if (!result && ownedRequestId) {
      const requestId = ownedRequestId;
      result = await input.provider.searchTrips(request);
      observedMs.push(result.metadata.latencyMs);

      /* What this search saw, for the corridor history.
       *
       * Screened first, deliberately. An unscreened minimum would let one
       * misparse set a corridor's floor at forty cents, and every traveler on
       * that route would then be told they had overpaid — a false claim about
       * the market, built out of our own bug, shown to people who have no way
       * to check it. Only fares that survived fare-sanity count. */
      const observed = screenJourneys(result.journeys, {
        originCode: request.originCode,
        destinationCode: request.destinationCode,
        travelDate,
        passengerCount: watch.passengerCount,
      });
      const cheapest = observed.journeys
        .flatMap((journey) => journey.fares)
        .map((fare) => fare.totalPartyPriceCents)
        .filter((cents): cents is number => cents != null && cents > 0)
        .reduce<number | null>((low, cents) => (low === null || cents < low ? cents : low), null);

      await input.repo.finishProviderRequest(requestId, {
        status: result.status,
        creditsConsumed: result.metadata.creditsCharged,
        latencyMs: result.metadata.latencyMs,
        errorMessage: result.providerError?.message ?? null,
        // Per traveler, so a party of four does not read as an expensive
        // corridor. The board's own figures stay party totals.
        cheapestPriceCents:
          cheapest === null ? null : Math.round(cheapest / Math.max(1, watch.passengerCount)),
      });
      if (result.status !== "PROVIDER_ERROR") {
        await input.repo.cacheJourneys(requestId, result.journeys);
      }
      input.searchCache?.set(searchKey, result);
    } else if (result) {
      // Served from another watch's search. Recorded as a reuse row so the
      // saving is visible in provider_requests, not just implied.
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
        /* Null, not the price it served.
         *
         * A reuse row is an accounting record for a search that did not happen.
         * Counting its price would weight one real observation by however many
         * watches happened to share it, which would quietly tell whoever is on
         * a busy corridor that it is more stable than it is. */
        cheapestPriceCents: null,
        createdAt: now.toISOString(),
      });
    }

    if (!result) {
      // Unreachable: the loop above either reuses a result, wins a claim and
      // searches, or returns the skipped shape. Asserted rather than assumed,
      // because a silent null here would become a date with no snapshot.
      throw new Error(`No search result for ${searchKey} and no deadline skip recorded`);
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
        // The reason the date was skipped, not a fixed one. Out of time and
        // out of budget are different facts, and the board shows this string.
        errorMessage: result.providerError?.message ?? DEADLINE_SKIP_MESSAGE,
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

    /* Nothing reaches the board or an inbox without being believable.
     *
     * "We never invent a price" was read as a promise about fabrication, and
     * that half held — nothing here synthesises a fare. The other half did not:
     * a scraper that misread a page and reported $0.42 for Boston to New York
     * would have been ranked first, drawn as a $127 saving, and emailed. The
     * only check between a parsed number and a person was that it was a number.
     *
     * A handful of bad rows is a bad parse of a few cards and they are dropped.
     * A third of them is a broken parser, and the rows that passed are only the
     * ones whose errors happened to land inside the bounds — so the whole date
     * is failed rather than half-believed. That is a claim about us, and it
     * shows on the board as one. */
    const screened = screenJourneys(result.journeys, {
      originCode: watch.originCode,
      destinationCode: watch.destinationCode,
      travelDate,
      passengerCount: watch.passengerCount,
    });
    if (screened.verdict.summary) {
      logger.warn("provider.implausible_fares", {
        watch_id: watch.id,
        cycle_id: cycleId,
        travel_date: travelDate,
        provider_request_id: result.metadata.requestId,
        trustworthy: screened.verdict.trustworthy,
        kept: screened.verdict.kept,
        rejected: screened.verdict.rejected,
        reasons: screened.verdict.byCode.map((entry) => `${entry.code}x${entry.count}`).join(","),
      });
    }

    const status: DateSearchStatus =
      result.status === "PROVIDER_ERROR"
        ? "PROVIDER_ERROR"
        : !screened.verdict.trustworthy
          ? // Not NO_INVENTORY: "nothing cheaper is listed" is a claim about the
            // market, and a search we could not read gives us no basis for one.
            "PROVIDER_ERROR"
          : screened.journeys.length === 0
            ? "NO_INVENTORY"
            : "SUCCESS";

    if (status === "PROVIDER_ERROR") {
      datesFailed.push(travelDate);
      if (!screened.verdict.trustworthy) unreadableDates.push(travelDate);
    } else {
      datesSucceeded.push(travelDate);
      allJourneys.push(...screened.journeys);
    }

    outcomes.push({
      travelDate,
      journeyCount: result.journeys.length,
      ok: result.status !== "PROVIDER_ERROR",
    });

    const snapshot: DateSnapshotRecord = {
      id: crypto.randomUUID(),
      cycleId,
      watchId: watch.id,
      travelDate,
      status,
      searchKey,
      providerRequestId: result.metadata.requestId,
      errorMessage:
        result.providerError?.message ??
        (screened.verdict.trustworthy ? null : screened.verdict.summary),
    };
    // An empty date cannot be judged until its neighbours have reported.
    if (status === "NO_INVENTORY") deferredSnapshots.push({ travelDate, snapshot });
    else await input.repo.insertDateSnapshot(snapshot);
  }

  /* Now the window can say which zeros to believe. A date with no trains at
   * all, beside dates with dozens, is a failed read — not an empty corridor,
   * and certainly not grounds for telling the traveler nothing is listed. */
  const suspect = suspectEmptyDates(outcomes);
  for (const { travelDate, snapshot } of deferredSnapshots) {
    const reason = suspect.get(travelDate);
    if (!reason) {
      await input.repo.insertDateSnapshot(snapshot);
      continue;
    }
    logger.warn("provider.implausibly_empty", {
      watch_id: watch.id,
      cycle_id: cycleId,
      travel_date: travelDate,
      reason,
    });
    await input.repo.insertDateSnapshot({
      ...snapshot,
      status: "PROVIDER_ERROR",
      errorMessage: reason,
    });
    const at = datesSucceeded.indexOf(travelDate);
    if (at >= 0) datesSucceeded.splice(at, 1);
    if (!datesFailed.includes(travelDate)) datesFailed.push(travelDate);
    unreadableDates.push(travelDate);
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

  /* Whether to speak is decided against what the traveler was TOLD, not
   * against what we last saw. Those were one column until now, which is why a
   * sold-out $47 could silence a perfectly good $60. */
  const alertPolicy = decideAlert({
    state: {
      lastAlerted: watch.lastAlertedOpportunity,
      lostNotified: watch.opportunityLostNotified,
      imminentNotified: watch.departureAlertSent,
    },
    observed: opportunity.fingerprint,
    hoursToDeparture: hoursUntilDeparture(watch, now),
    improvementCents: watch.alertImprovementCents ?? undefined,
  });

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
  const requestedTo = watch.alertEmail?.trim() ?? "";
  /* Consulted before every send, not just on the unsubscribe path. A bounce or
   * a spam complaint has to stop the mail as firmly as a request does, and the
   * check belongs here so no future caller can forget it. */
  const suppressed = requestedTo ? await input.repo.isEmailSuppressed(requestedTo) : false;
  if (suppressed) {
    logger.info("alert.suppressed", { watch_id: watch.id, reason: "suppression_list" });
  }
  const alertTo = suppressed ? "" : requestedTo;
  /* The lost notice is its own email: there is no better option to show,
   * which is the entire message. Sending the fare-drop template with an empty
   * body — or saying nothing — both leave the traveler holding a price that no
   * longer exists. */
  if (alertPolicy.notify && alertPolicy.reason === "opportunity_lost" && input.mailer && alertTo) {
    const lost = watch.lastAlertedOpportunity;
    if (lost) {
      // Recorded as an alert like any other, so the history on the watch shows
      // what the traveler was told and when — including the bad news.
      const alert = await input.repo.insertAlert({
        id: crypto.randomUUID(),
        watchId: watch.id,
        cycleId,
        fingerprint: lost,
        subject: `Sold out: the ${formatUsdCompact(lost.bestPriceCents)} on ${watch.originCode} → ${watch.destinationCode} is gone`,
        createdAt: now.toISOString(),
      });
      const delivery = await sendOpportunityLostEmail({
        mailer: input.mailer,
        to: alertTo,
        watch,
        lostPriceCents: lost.bestPriceCents,
        currentCheapestCents: ranked[0]?.totalPartyPriceCents ?? null,
        appUrl: `${appOrigin()}/watches/${watch.id}`,
        checkedAt: now,
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
  } else if (alertPolicy.notify && opportunity.fingerprint && input.mailer && alertTo) {
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
    /* What this look at the market found.
     *
     * Recorded here because it is known here and nowhere else afterwards: the
     * product checks three times a day and used to keep only the newest number,
     * so there was no fare history to chart, to find a best-ever in, or to read
     * a direction from. null is a real observation — looked, saw nothing — and
     * the chart draws it as a gap rather than a fall to zero. */
    bestPriceCents: best?.totalPartyPriceCents ?? null,
    bestTravelDate: best?.journey.searchedTravelDate ?? null,
  });
  /* The silences are the half nobody could explain before. An alert row only
   * existed when mail went out, so "why didn't you tell me about the $60?" had
   * no answer but a re-derivation from code. This stores the reasoning as it
   * actually ran, for both outcomes. */
  await input.repo.insertAlertDecision({
    id: crypto.randomUUID(),
    watchId: watch.id,
    cycleId,
    reason: alertPolicy.reason,
    notified: alertSent,
    alertedFingerprint: watch.lastAlertedOpportunity,
    observedFingerprint: opportunity.fingerprint,
    explanation: suppressed
      ? `${alertPolicy.explanation} No email was sent: this address has asked not to be written to.`
      : alertPolicy.explanation,
    createdAt: now.toISOString(),
  });

  const updatedWatch = await input.repo.updateWatch(watch.id, {
    lastCheckCycleId: cycle.id,
    lastCheckedAt: now.toISOString(),
    nextCheckSlot: next.slot,
    nextCheckAtLabel: next.label,
    bestPriceCents: best?.totalPartyPriceCents ?? null,
    bestSavingsCents: best && best.savingsCents > 0 ? best.savingsCents : null,
    // The observation is recorded as observed — null when nothing qualifies,
    // which is the truth. Keeping the old value here is what made a
    // disappeared fare invisible.
    lastOpportunity: opportunity.fingerprint,
    lastAlertedOpportunity: alertSent ? alertPolicy.nextAlerted : watch.lastAlertedOpportunity,
    opportunityLostNotified: alertSent
      ? alertPolicy.nextLostNotified
      : watch.opportunityLostNotified,
    departureAlertSent: alertSent ? alertPolicy.nextImminentNotified : watch.departureAlertSent,
  });

  // reusedSearches is recorded too: without it the cost model in
  // ARCHITECTURE.md is a claim nobody can check against the table.
  await input.repo.incrementUsage(
    localIsoDate(now, "UTC"),
    credits,
    providerRequests,
    datesSucceeded.length,
    datesFailed.length,
    reusedSearches,
  );

  logger.info("cycle.completed", {
    cycleId: cycle.id,
    watchId: watch.id,
    trigger: input.trigger,
    watchCount: 1,
    dateSearches: dates.length,
    dedupSavings: reusedSearches,
    /* Dates we reached and could not read, as distinct from dates we never got.
       Both land in datesFailed and they are different operational problems: one
       is the provider being down, the other is the provider changing its page
       out from under the parser. */
    unreadableDates: unreadableDates.length,
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

/** Hours until the booked departure, or null when it is not known. */
function hoursUntilDeparture(
  watch: { bookedDepartureAt: string | null; desiredTravelDate: string },
  now: Date,
): number | null {
  const iso = watch.bookedDepartureAt ?? `${watch.desiredTravelDate}T12:00:00.000Z`;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return (at - now.getTime()) / 3_600_000;
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
    bestPriceCents: null,
    bestTravelDate: null,
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

/** Date-level fan-out. See the note at its call site. */
function searchParallelism(isLocal: boolean): number {
  const raw = Number.parseInt(process.env.RAILDROP_SEARCH_PARALLEL ?? "", 10);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 4) return raw;
  return isLocal ? 3 : 1;
}
