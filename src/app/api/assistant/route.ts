import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/services";
import { routeGuard } from "@/lib/api/respond";
import { askAssistant, AssistantNotConfiguredError } from "@/lib/assistant/ask";
import { buildAssistantFacts } from "@/lib/domain/assistant-grounding";
import { collectEligibleFares } from "@/lib/domain/eligibility";
import { rankCandidates } from "@/lib/domain/ranking";
import { summarizeCorridor } from "@/lib/domain/corridor-stats";
import { localIsoDate } from "@/lib/domain/timezone";

export const maxDuration = 60;
export const runtime = "nodejs";

/* One question about one trip.
 *
 * The board is rebuilt here rather than posted from the browser. A client that
 * sends its own fares decides what the assistant may say about money, and the
 * whole verification story collapses into "the page was honest" — which is not
 * something a server can check. The question is the only thing taken from the
 * request.
 */

const askSchema = z.object({
  watchId: z.string().uuid("Unknown trip"),
  question: z.string().trim().min(2, "Ask a question").max(500, "Keep the question shorter"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4_000),
      }),
    )
    // Enough for a follow-up or two. Longer threads drift off the fact sheet.
    .max(6)
    .optional(),
});

export async function POST(request: Request) {
  return routeGuard({ route: "/api/assistant", method: "POST" }, async () => {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = askSchema.parse(await request.json());
    const repo = getRepository();
    const watch = await repo.getWatch(body.watchId);
    if (!watch || watch.userId !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const renderedAt = new Date();
    const journeys = watch.lastCheckCycleId
      ? (await repo.listJourneysForCycle(watch.lastCheckCycleId)).map((item) => item.option)
      : [];
    const cycle = watch.lastCheckCycleId ? await repo.getCycle(watch.lastCheckCycleId) : null;
    const cycles = await repo.listCyclesForWatch(watch.id);

    const eligible = collectEligibleFares(journeys, {
      includeRestrictedFares: watch.includeRestrictedFares,
      includeThruway: watch.includeThruway,
      travelClass: watch.travelClass,
      requireAvailable: true,
    });
    const board = rankCandidates(eligible, {
      desiredTravelDate: watch.desiredTravelDate,
      preferredDepartureTime: watch.preferredDepartureTime,
      currentBookedPriceCents: watch.currentBookedPriceCents,
    });

    const corridor = summarizeCorridor(
      await repo.corridorObservations({
        originCode: watch.originCode,
        destinationCode: watch.destinationCode,
        sinceIso: new Date(renderedAt.getTime() - 30 * 86_400_000).toISOString(),
      }),
    );

    const facts = buildAssistantFacts({
      trip: {
        originCode: watch.originCode,
        destinationCode: watch.destinationCode,
        desiredTravelDate: watch.desiredTravelDate,
        dateFlexibilityDays: watch.dateFlexibilityDays,
        passengerCount: watch.passengerCount ?? 1,
        bookedPriceCents: watch.currentBookedPriceCents,
      },
      board,
      corridor,
      failedDates: cycle?.datesFailed ?? [],
      today: localIsoDate(renderedAt, watch.timezone),
      scanCount: cycles.length,
    });

    try {
      const result = await askAssistant({
        question: body.question,
        facts,
        history: body.history,
      });
      return NextResponse.json({
        answer: result.answer,
        blocked: result.blocked,
        /* So the board and the answer can be read against each other. A reader
           who can see which fares the answer was built from can check it. */
        groundedIn: facts.observedCents.length,
      });
    } catch (error) {
      if (error instanceof AssistantNotConfiguredError) {
        return NextResponse.json({ error: error.message }, { status: 503 });
      }
      throw error;
    }
  });
}
