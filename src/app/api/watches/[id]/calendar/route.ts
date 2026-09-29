import { getSessionUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/services";
import { routeGuard } from "@/lib/api/respond";
import { NextResponse } from "next/server";
import { buildIcs, icsFilename, type CalendarEvent } from "@/lib/domain/ics";
import { collectEligibleFares } from "@/lib/domain/eligibility";
import { rankCandidates } from "@/lib/domain/ranking";
import { formatUsdCompact } from "@/lib/domain/money";

/* The trip, as a calendar file.
 *
 * A route rather than a click handler, so the link works with JavaScript off
 * and can be pasted, mailed, or opened on a phone that is not the one that
 * made the watch.
 *
 * It describes the train they booked when we know which one that is, and
 * otherwise the cheapest listed journey — labelled as such, because those are
 * different claims. The price goes in the description and never in the title:
 * a title is what a lock screen shows at 6am, and a fare that moved after the
 * file was saved would be read there as current.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return routeGuard({ route: "/api/watches/[id]/calendar", method: "GET" }, async () => {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    const repo = getRepository();
    const watch = await repo.getWatch(id);
    if (!watch || watch.userId !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const journeys = watch.lastCheckCycleId
      ? (await repo.listJourneysForCycle(watch.lastCheckCycleId)).map((item) => item.option)
      : [];
    const ranked = rankCandidates(
      collectEligibleFares(journeys, {
        includeRestrictedFares: watch.includeRestrictedFares,
        includeThruway: watch.includeThruway,
        travelClass: watch.travelClass,
        requireAvailable: true,
      }),
      {
        desiredTravelDate: watch.desiredTravelDate,
        preferredDepartureTime: watch.preferredDepartureTime,
        currentBookedPriceCents: watch.currentBookedPriceCents,
      },
    );

    /* Their own train if we know it, otherwise the cheapest we saw. The two
       are labelled differently because they are different claims. */
    const booked = watch.bookedTrainNumber
      ? ranked.find((candidate) => candidate.journey.trainNumber === watch.bookedTrainNumber)
      : undefined;
    const chosen = booked ?? ranked[0];

    if (!chosen && !watch.bookedDepartureAt) {
      return NextResponse.json(
        { error: "Nothing has been listed for this trip yet, so there is no departure to add." },
        { status: 409 },
      );
    }

    const startsAt = chosen?.journey.departureAt ?? watch.bookedDepartureAt!;
    const endsAt = chosen?.journey.arrivalAt ?? startsAt;
    const train = chosen
      ? `${chosen.journey.serviceName ?? "Train"}${chosen.journey.trainNumber ? ` ${chosen.journey.trainNumber}` : ""}`
      : `Train ${watch.bookedTrainNumber ?? ""}`.trim();

    const lines = [
      booked
        ? "The train you booked."
        : chosen
          ? "The cheapest listed journey at the time this file was made — not a booking."
          : "The departure you recorded.",
      chosen
        ? `Listed at ${formatUsdCompact(chosen.totalPartyPriceCents)} when this was downloaded.`
        : "",
      "Fares move. Confirm on Amtrak before travelling; RailDrop never books and never invents a price.",
    ].filter(Boolean);

    const event: CalendarEvent = {
      uid: `raildrop-${watch.id}@raildrop`,
      startsAt,
      endsAt,
      stamp: new Date().toISOString(),
      title: `${train} · ${watch.originCode} → ${watch.destinationCode}`,
      description: lines.join("\n"),
      location: watch.originCode,
      url: "https://www.amtrak.com/home.html",
    };

    return new NextResponse(buildIcs([event]), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${icsFilename(watch.originCode, watch.destinationCode, watch.desiredTravelDate)}"`,
        // A fare moves; a cached calendar file would quietly stop matching it.
        "Cache-Control": "no-store",
      },
    });
  });
}
