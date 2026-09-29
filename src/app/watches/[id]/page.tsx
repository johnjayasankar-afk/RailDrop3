import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { getSessionUser, guestEntryHref } from "@/lib/auth/session";
import { getRepository } from "@/lib/services";
import { collectEligibleFares } from "@/lib/domain/eligibility";
import { summarizeCorridor } from "@/lib/domain/corridor-stats";
import { cheapestByDate, rankCandidates } from "@/lib/domain/ranking";
import { generateSearchDates } from "@/lib/domain/calendar";
import { localIsoDate } from "@/lib/domain/timezone";
import { boardMoves } from "@/lib/domain/board-moves";
import { WatchDetail } from "@/components/watch-detail";
import { fareProviderStatus } from "@/lib/providers/create-provider";
import { loadPageData } from "@/lib/pages/load-guard";
import { RecordsUnreachable } from "@/components/records-unreachable";
import { AssistantPanel } from "@/components/assistant-panel";
import type { Route } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  /* The page's own guard does not cover this: Next renders metadata separately,
   * so an unreachable database threw here too and logged a second, uncaught
   * error for a request the page had already handled gracefully. A title is
   * cosmetic — the outage is logged once, by the page — so this degrades
   * quietly rather than logging the same failure twice. */
  try {
    const watch = await getRepository().getWatch(id);
    if (!watch) return { title: "Watch" };
    return { title: `${watch.originCode} → ${watch.destinationCode}` };
  } catch {
    return { title: "Watch" };
  }
}

/* A static shell with the board behind a boundary.
 *
 * Everything visible on this route belongs to one watch, so the shell is the
 * header, the footer and the board's own footprint — but that is the whole
 * point of a shell: the chrome and the layout land immediately instead of
 * after a session read, a database round trip and a corridor query. Reading
 * the clock on the first line is also what made this the noisiest of the
 * three prerender errors the production build could not see. */
export default function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageFrame>
      <Suspense fallback={<BoardSkeleton />}>
        <Board params={params} />
      </Suspense>
    </PageFrame>
  );
}

/** The board's own footprint, so the page does not jump when it lands. */
function BoardSkeleton() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8" aria-hidden>
      <div className="skeleton h-4 max-w-[8rem]" />
      <div className="skeleton mt-6 h-24" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="skeleton h-[4.5rem]" />
        <div className="skeleton h-[4.5rem]" />
        <div className="skeleton h-[4.5rem]" />
        <div className="skeleton h-[4.5rem]" />
      </div>
      <div className="mt-8 space-y-2">
        <div className="skeleton h-14" />
        <div className="skeleton h-14" />
        <div className="skeleton h-14" />
        <div className="skeleton h-14" />
        <div className="skeleton h-14" />
      </div>
    </main>
  );
}

async function Board({ params }: { params: Promise<{ id: string }> }) {
  /* The clock is a request-time read the same way cookies() is: it produces
     different output per request, so prerendering it would bake one day's
     answer into the shell. connection() is how you say that about a value the
     framework cannot detect on its own. */
  await connection();
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) redirect(guestEntryHref(`/watches/${id}`));
  /* One clock read for the whole render.
   *
   * There were three, and they could straddle a midnight in the watch's zone —
   * the search window built against one day and `today` against the next, which
   * would mark every date in the window as one day out. Reading it once also
   * satisfies the compiler's purity rule, which is pointing at a real hazard
   * even on a server component. */
  const renderedAt = new Date();

  /* Every read this page needs, behind one guard.
   *
   * There were eight unguarded repository calls here. A database we cannot
   * reach threw past all of them into app/error.tsx, which told the reader the
   * board could not load and to try again shortly — see src/lib/pages/load-guard.ts
   * for why all three of those claims were wrong. notFound() is raised inside
   * this block on purpose: the guard rethrows it untouched, so a watch that is
   * not yours is still a 404 and not an outage. */
  const loaded = await loadPageData(
    { page: "/watches/[id]", watchId: id, userId: user.id },
    async () => {
      const repo = getRepository();
      const watch = await repo.getWatch(id);
      if (!watch || watch.userId !== user.id) notFound();
      const journeys = watch.lastCheckCycleId
        ? (await repo.listJourneysForCycle(watch.lastCheckCycleId)).map((item) => item.option)
        : [];
      const snapshots = watch.lastCheckCycleId
        ? await repo.listDateSnapshots(watch.lastCheckCycleId)
        : [];
      const events = await repo.listPriceEvents(id);
      const cycle = watch.lastCheckCycleId ? await repo.getCycle(watch.lastCheckCycleId) : null;
      const cycles = await repo.listCyclesForWatch(id);
      const previousCycle = cycles.find(
        (item) =>
          item.id !== watch.lastCheckCycleId &&
          item.status !== "RUNNING" &&
          item.journeysReturned > 0,
      );
      const previousJourneys = previousCycle
        ? (await repo.listJourneysForCycle(previousCycle.id)).map((item) => item.option)
        : [];
      const alerts = (await repo.listAlertsForWatch(id))
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5)
        .map((alert) => ({ id: alert.id, subject: alert.subject, createdAt: alert.createdAt }));
      /* What this route has cost across every watch, not just this one.
       *
       * The shared half of the product. A watch only ever knew about itself, so
       * its first words were "we have no price history for this trip yet" — while
       * we had been scraping this exact corridor for somebody else all week.
       * Thirty days is long enough to describe a route and short enough that it
       * still describes the one running now. */
      const observations = await repo.corridorObservations({
        originCode: watch.originCode,
        destinationCode: watch.destinationCode,
        sinceIso: new Date(renderedAt.getTime() - 30 * 86_400_000).toISOString(),
      });
      return {
        watch,
        journeys,
        snapshots,
        events,
        cycle,
        cycles,
        previousJourneys,
        alerts,
        observations,
      };
    },
  );

  if (!loaded.reachable) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        {/* The page still needs its one h1, the same way /dashboard keeps
              "Your watches" above this card. Without it the board's unreachable
              state has no h1 at all and opens at h2 — both of the rules in
              docs/A11Y.md, broken in the one state nobody can see in a test
              run. It cannot name the route: reading the watch is what failed. */}
        <h1 className="serif text-4xl">Your watch</h1>
        <RecordsUnreachable
          what="board"
          retryHref={`/watches/${id}` as Route}
          permanent={loaded.permanent}
        />
      </main>
    );
  }

  const {
    watch,
    journeys,
    snapshots,
    events,
    cycle,
    cycles,
    previousJourneys,
    alerts,
    observations,
  } = loaded.data;
  const previousEligible = collectEligibleFares(previousJourneys, {
    includeRestrictedFares: watch.includeRestrictedFares,
    includeThruway: watch.includeThruway,
    travelClass: watch.travelClass,
    requireAvailable: true,
  });
  const previousRanked = rankCandidates(previousEligible, {
    desiredTravelDate: watch.desiredTravelDate,
    preferredDepartureTime: watch.preferredDepartureTime,
    currentBookedPriceCents: watch.currentBookedPriceCents,
  });
  const eligible = collectEligibleFares(journeys, {
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
  const byDate = cheapestByDate(ranked);
  const window = generateSearchDates(
    watch.desiredTravelDate,
    watch.dateFlexibilityDays,
    localIsoDate(renderedAt, watch.timezone),
  );
  const fareSource = fareProviderStatus();

  const corridor = summarizeCorridor(observations);

  return (
    <>
      <WatchDetail
        watch={watch}
        ranked={ranked}
        dates={window.dates}
        byDate={[...byDate.entries()]}
        snapshots={snapshots}
        events={events}
        cycleStatus={cycle?.status ?? null}
        datesFailed={cycle?.datesFailed ?? []}
        today={localIsoDate(renderedAt, watch.timezone)}
        /* Computed here, from the same server clock as `today`, because a
           Date read during render is the hydration bug RelativeTime exists to
           avoid. Exact when the traveler told us which train they are on;
           null when they did not, so the board falls back to whole days
           rather than to a figure nobody measured. */
        hoursToDeparture={
          watch.bookedDepartureAt
            ? Math.max(0, (Date.parse(watch.bookedDepartureAt) - renderedAt.getTime()) / 3_600_000)
            : null
        }
        moves={boardMoves(previousRanked, ranked).slice(0, 5)}
        alerts={alerts}
        scanCount={cycles.length}
        corridor={corridor}
        /* Every look this watch has taken, oldest first — the fare history the
           product was checking three times a day and throwing away. A null
           price is a real observation: looked, saw nothing. */
        observations={[...cycles]
          .filter((cycle) => cycle.status !== "RUNNING")
          .map((cycle) => ({
            at: cycle.completedAt ?? cycle.startedAt,
            cents: cycle.bestPriceCents,
            travelDate: cycle.bestTravelDate,
          }))}
        fareSourceLabel={
          fareSource.provider.startsWith("wanderu")
            ? "Wanderu"
            : fareSource.provider.startsWith("parse")
              ? "Parse"
              : "live board"
        }
        scans={[...cycles]
          .slice(0, 8)
          .reverse()
          .map((cycle) => ({ id: cycle.id, status: cycle.status, at: cycle.startedAt }))}
      />
      {/* Below the board on purpose. The answers are derived from it, so the
          evidence should already be on screen when the reader gets here. */}
      <div className="mx-auto max-w-6xl px-4 pb-10">
        <AssistantPanel watchId={watch.id} />
      </div>
    </>
  );
}
