import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { getSessionUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/services";
import { collectEligibleFares } from "@/lib/domain/eligibility";
import { cheapestByDate, rankCandidates } from "@/lib/domain/ranking";
import { generateSearchDates } from "@/lib/domain/calendar";
import { localIsoDate } from "@/lib/domain/timezone";
import { boardMoves } from "@/lib/domain/board-moves";
import { WatchDetail } from "@/components/watch-detail";
import { fareProviderStatus } from "@/lib/providers/create-provider";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const watch = await getRepository().getWatch(id);
  if (!watch) return { title: "Watch" };
  return { title: `${watch.originCode} → ${watch.destinationCode}` };
}

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
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
      item.id !== watch.lastCheckCycleId && item.status !== "RUNNING" && item.journeysReturned > 0,
  );
  const previousJourneys = previousCycle
    ? (await repo.listJourneysForCycle(previousCycle.id)).map((item) => item.option)
    : [];
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
  const alerts = (await repo.listAlertsForWatch(id))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)
    .map((alert) => ({ id: alert.id, subject: alert.subject, createdAt: alert.createdAt }));
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
    localIsoDate(new Date(), watch.timezone),
  );
  const fareSource = fareProviderStatus();

  return (
    <PageFrame email={user.email}>
      <WatchDetail
        watch={watch}
        ranked={ranked}
        dates={window.dates}
        byDate={[...byDate.entries()]}
        snapshots={snapshots}
        events={events}
        cycleStatus={cycle?.status ?? null}
        datesFailed={cycle?.datesFailed ?? []}
        today={localIsoDate(new Date(), watch.timezone)}
        moves={boardMoves(previousRanked, ranked).slice(0, 5)}
        alerts={alerts}
        scanCount={cycles.length}
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
    </PageFrame>
  );
}
