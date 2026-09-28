import type Anthropic from "@anthropic-ai/sdk";
import type { RailDropRepository } from "@/lib/db/repository";
import { buildAssistantFacts } from "@/lib/domain/assistant-grounding";
import { collectEligibleFares } from "@/lib/domain/eligibility";
import { rankCandidates } from "@/lib/domain/ranking";
import { summarizeCorridor } from "@/lib/domain/corridor-stats";
import { localIsoDate } from "@/lib/domain/timezone";
import { formatUsdCompact } from "@/lib/domain/money";
import { formatDisplayDate } from "@/lib/domain/calendar";

/* What the assistant can look up, when it is asked about more than one trip.
 *
 * On a single watch the fact sheet is the whole world and no tools are needed.
 * Across a dashboard that stops working: handing it every board for every trip
 * would be most of a context window, and almost all of it irrelevant to any one
 * question. So it gets a list of trips up front and fetches the boards it
 * actually needs.
 *
 * Two rules hold the price guarantee together here. Every tool reads; none of
 * them writes, cancels, books or rechecks, so no sentence the model produces
 * can change anything. And every fare a tool returns is added to the set of
 * amounts the answer is allowed to contain — the verifier's allowance grows
 * only through observations that actually came back, never through the model
 * asking for it.
 */

export interface ToolContext {
  repo: RailDropRepository;
  userId: string;
  /** Grows as tools return real fares. The verifier reads this afterwards. */
  observedCents: number[];
}

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_trips",
    description:
      "List every trip this traveller is watching: route, travel date, what they paid, and the cheapest fare currently listed. Call this first for any question that is not about one named trip.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    // Schema-valid arguments without forcing the call.
    strict: true,
  },
  {
    name: "get_trip_board",
    description:
      "The full board for one trip: every listed fare with its train, date and time, plus what this corridor has cost over the last thirty days. Use the tripId from list_trips.",
    input_schema: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "The tripId from list_trips." },
      },
      required: ["tripId"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export async function runAssistantTool(
  name: string,
  input: unknown,
  context: ToolContext,
): Promise<string> {
  if (name === "list_trips") return listTrips(context);
  if (name === "get_trip_board") {
    const tripId = (input as { tripId?: unknown })?.tripId;
    if (typeof tripId !== "string") return "That call was missing a tripId.";
    return getTripBoard(tripId, context);
  }
  return `There is no tool called ${name}.`;
}

async function listTrips(context: ToolContext): Promise<string> {
  const watches = await context.repo.listWatchesForUser(context.userId);
  if (watches.length === 0) return "This traveller is not watching any trips yet.";

  const lines = watches.map((watch) => {
    if (watch.currentBookedPriceCents > 0)
      context.observedCents.push(watch.currentBookedPriceCents);
    const best =
      typeof watch.bestPriceCents === "number" && watch.bestPriceCents > 0
        ? watch.bestPriceCents
        : null;
    if (best !== null) context.observedCents.push(best);
    return (
      `- tripId ${watch.id}: ${watch.originCode} to ${watch.destinationCode} on ` +
      `${formatDisplayDate(watch.desiredTravelDate)}, status ${watch.status}. ` +
      (watch.currentBookedPriceCents > 0
        ? `They paid ${formatUsdCompact(watch.currentBookedPriceCents)}. `
        : "No booked price recorded. ") +
      (best !== null
        ? `Cheapest seen so far ${formatUsdCompact(best)}.`
        : "Nothing cheaper found yet.")
    );
  });
  return `${watches.length} trip${watches.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

async function getTripBoard(tripId: string, context: ToolContext): Promise<string> {
  const watch = await context.repo.getWatch(tripId);
  // Ownership is checked here, not only at the route: a tool argument is model
  // output, and model output is never allowed to widen what a request can read.
  if (!watch || watch.userId !== context.userId) {
    return "There is no trip with that id for this traveller.";
  }

  const renderedAt = new Date();
  const journeys = watch.lastCheckCycleId
    ? (await context.repo.listJourneysForCycle(watch.lastCheckCycleId)).map((item) => item.option)
    : [];
  const cycle = watch.lastCheckCycleId ? await context.repo.getCycle(watch.lastCheckCycleId) : null;
  const cycles = await context.repo.listCyclesForWatch(watch.id);

  const board = rankCandidates(
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

  const corridor = summarizeCorridor(
    await context.repo.corridorObservations({
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

  // Whatever this board actually showed becomes sayable, and nothing else does.
  context.observedCents.push(...facts.observedCents);
  return facts.briefing;
}
