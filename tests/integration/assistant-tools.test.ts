import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/db/memory-store";
import { runAssistantTool, ASSISTANT_TOOLS, type ToolContext } from "@/lib/assistant/tools";
import type { RailDropRepository } from "@/lib/db/repository";
import type { WatchRecord } from "@/lib/db/models";

/* The tools the assistant gets when the question spans several trips.
 *
 * Two properties matter more than what they return. A tool argument is model
 * output, so it must never widen what a request can read — the ownership check
 * lives in the tool, not only in the route that called it. And every fare a
 * tool hands back has to join the set of amounts the answer may quote, or the
 * verifier will reject the assistant for repeating something we ourselves gave
 * it, and the tempting fix at that point is to loosen the verifier.
 */

function stubWatch(id: string, userId: string, patch: Partial<WatchRecord> = {}): WatchRecord {
  return {
    id,
    userId,
    originCode: "BOS",
    destinationCode: "NYP",
    desiredTravelDate: "2026-10-09",
    dateFlexibilityDays: 1,
    preferredDepartureTime: null,
    passengerCount: 1,
    bookedTrainNumber: null,
    bookedDepartureAt: null,
    bookedFareFamily: "FLEXIBLE",
    travelClass: "COACH",
    currentBookedPriceCents: 12_800,
    includeRestrictedFares: false,
    includeThruway: false,
    minimumSavingsCents: 100,
    bookedAt: "2026-09-03T00:00:00.000Z",
    monitorStartAt: "2026-09-03T00:00:00.000Z",
    monitorEndAt: null,
    monitorPreset: "48h",
    timezone: "America/New_York",
    alertEmail: "",
    status: "ACTIVE",
    lastCheckCycleId: null,
    lastCheckedAt: null,
    nextCheckSlot: null,
    nextCheckAtLabel: null,
    bestPriceCents: null,
    bestSavingsCents: null,
    lastOpportunity: null,
    lastAlertedOpportunity: null,
    opportunityLostNotified: false,
    departureAlertSent: false,
    alertImprovementCents: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...patch,
  };
}

async function seed() {
  const repo = new MemoryRepository();
  const mine = await repo.createWatch(stubWatch("trip-mine", "me"));
  const theirs = await repo.createWatch(
    stubWatch("trip-theirs", "someone-else", {
      originCode: "PHL",
      destinationCode: "WAS",
      desiredTravelDate: "2026-11-02",
      currentBookedPriceCents: 9_900,
    }),
  );
  return { repo: repo as unknown as RailDropRepository, mine, theirs };
}

function context(repo: RailDropRepository): ToolContext {
  return { repo, userId: "me", observedCents: [] };
}

describe("the tools on offer", () => {
  it("are read-only — nothing books, cancels, rechecks or changes anything", () => {
    /* The price guarantee survives a confident sentence; it does not survive a
       tool that acts. Every name here has to be a lookup. */
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.name).toMatch(/^(list|get)_/);
    }
    expect(ASSISTANT_TOOLS.map((tool) => tool.name).sort()).toEqual([
      "get_trip_board",
      "list_trips",
    ]);
  });

  it("declare strict schemas, so the arguments are valid without forcing the call", () => {
    // Opus 5.5 rejects forced tool_choice, so strict is what keeps inputs sane.
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.strict).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
    }
  });
});

describe("list_trips", () => {
  it("lists this traveller's trips and nobody else's", async () => {
    const { repo, mine, theirs } = await seed();
    const out = await runAssistantTool("list_trips", {}, context(repo));
    expect(out).toContain(mine.id);
    expect(out).not.toContain(theirs.id);
    expect(out).not.toContain("PHL");
  });

  it("says plainly when there is nothing to list", async () => {
    const { repo } = await seed();
    const out = await runAssistantTool(
      "list_trips",
      {},
      { repo, userId: "nobody", observedCents: [] },
    );
    expect(out).toMatch(/not watching any trips/i);
  });

  it("adds the prices it reported to what the answer may quote", async () => {
    const { repo } = await seed();
    const ctx = context(repo);
    await runAssistantTool("list_trips", {}, ctx);
    expect(ctx.observedCents).toContain(12_800);
  });
});

describe("get_trip_board", () => {
  it("refuses a trip belonging to someone else", async () => {
    /* The argument came from the model. If the ownership check lived only in
       the route, a guessed id would read another traveller's board — and the
       model would have no way of knowing it had done so. */
    const { repo, theirs } = await seed();
    const out = await runAssistantTool("get_trip_board", { tripId: theirs.id }, context(repo));
    expect(out).toMatch(/no trip with that id/i);
    expect(out).not.toContain("PHL");
  });

  it("refuses an id that does not exist at all, in the same words", async () => {
    // Telling the two apart would confirm which ids are real.
    const { repo } = await seed();
    const out = await runAssistantTool(
      "get_trip_board",
      { tripId: "11111111-1111-4111-8111-111111111111" },
      context(repo),
    );
    expect(out).toMatch(/no trip with that id/i);
  });

  it("returns the briefing for a trip they own", async () => {
    const { repo, mine } = await seed();
    const out = await runAssistantTool("get_trip_board", { tripId: mine.id }, context(repo));
    expect(out).toContain("BOS");
    expect(out).toContain("NYP");
  });

  it("handles a missing argument instead of throwing", async () => {
    const { repo } = await seed();
    expect(await runAssistantTool("get_trip_board", {}, context(repo))).toMatch(
      /missing a tripId/i,
    );
  });
});

describe("an unknown tool", () => {
  it("is answered, not thrown", async () => {
    // A thrown error ends the turn; a result lets the model correct itself.
    const { repo } = await seed();
    expect(await runAssistantTool("delete_everything", {}, context(repo))).toMatch(
      /no tool called/i,
    );
  });
});
