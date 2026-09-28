import { describe, expect, it } from "vitest";
import { buildAssistantFacts, type GroundingInput } from "@/lib/domain/assistant-grounding";
import { findPriceMentions, verifyAnswer } from "@/lib/domain/assistant-verify";
import type { RankedCandidate } from "@/lib/domain/types";

/* The fact sheet is the model's entire world.
 *
 * It has no database handle and no provider — everything it can say about a
 * fare comes from here. That makes "could it invent a price" answerable by
 * reading one function, which is the point.
 */

function candidate(cents: number, date: string, train: string, saving = 0): RankedCandidate {
  return {
    journey: {
      id: `j${train}`,
      searchedTravelDate: date,
      serviceName: "Northeast Regional",
      trainNumber: train,
      departureAt: `${date}T11:55:00.000Z`,
      arrivalAt: `${date}T15:14:00.000Z`,
    },
    fare: { id: `f${train}` },
    totalPartyPriceCents: cents,
    savingsCents: saving,
    dateOffsetDays: 0,
    preferredTimeDeltaMinutes: null,
    rankScore: 1,
  } as unknown as RankedCandidate;
}

const base: GroundingInput = {
  trip: {
    originCode: "BOS",
    destinationCode: "NYP",
    desiredTravelDate: "2026-10-04",
    dateFlexibilityDays: 1,
    passengerCount: 1,
    bookedPriceCents: 12_800,
  },
  board: [candidate(5_000, "2026-10-03", "169", 7_800), candidate(9_100, "2026-10-03", "65")],
  corridor: {
    count: 40,
    dates: 9,
    spanDays: 26,
    low: 4_700,
    p25: 6_100,
    median: 9_100,
    p75: 12_600,
    high: 21_100,
    newest: "2026-09-27",
    oldest: "2026-09-01",
  },
  failedDates: [],
  today: "2026-09-28",
  scanCount: 7,
};

describe("every price in the briefing is a price the answer may repeat", () => {
  it("holds for a full briefing", () => {
    /* The drift guard between the two halves. If the briefing could name an
       amount that is not in observedCents, the verifier would reject the
       assistant for repeating a fact we ourselves handed it — and the obvious
       fix at that point is to loosen the verifier, which is the wrong one. */
    const facts = buildAssistantFacts(base);
    for (const mention of findPriceMentions(facts.briefing)) {
      expect(verifyAnswer(mention.text, facts.observedCents).ok).toBe(true);
    }
  });

  it("holds when there is no board and no history", () => {
    const facts = buildAssistantFacts({
      ...base,
      board: [],
      corridor: null,
      trip: { ...base.trip, bookedPriceCents: null },
    });
    expect(findPriceMentions(facts.briefing)).toEqual([]);
    expect(facts.observedCents).toEqual([]);
  });
});

describe("naming the absences", () => {
  it("says the board is empty rather than leaving it out", () => {
    // A model handed a partial picture fills the gap plausibly.
    const facts = buildAssistantFacts({ ...base, board: [] });
    expect(facts.briefing).toMatch(/no fare to quote/i);
  });

  it("says there is no history rather than letting it be characterised", () => {
    const facts = buildAssistantFacts({ ...base, corridor: null });
    expect(facts.briefing).toMatch(/not enough history/i);
    expect(facts.briefing).toMatch(/do not characterise/i);
  });

  it("forbids the word saving when nothing was paid", () => {
    const facts = buildAssistantFacts({
      ...base,
      trip: { ...base.trip, bookedPriceCents: null },
    });
    expect(facts.briefing).toMatch(/do not describe any fare as a saving/i);
  });

  it("distinguishes a date that failed from a date with nothing on it", () => {
    /* The distinction the whole product rests on, restated for the model:
       unknown is not empty. */
    const facts = buildAssistantFacts({ ...base, failedDates: ["2026-10-05"] });
    expect(facts.briefing).toContain("2026-10-05");
    expect(facts.briefing).toMatch(/unknown, not empty/i);
  });
});

describe("the board it describes", () => {
  it("includes each fare's price, train and date", () => {
    const facts = buildAssistantFacts(base);
    expect(facts.briefing).toContain("$50");
    expect(facts.briefing).toContain("Northeast Regional 169");
    expect(facts.observedCents).toContain(5_000);
    expect(facts.observedCents).toContain(9_100);
  });

  it("caps the rows but says how many were left out", () => {
    // A long board should not crowd out the history and the caveats.
    const many = Array.from({ length: 30 }, (_, index) =>
      candidate(5_000 + index * 100, "2026-10-03", String(100 + index)),
    );
    const facts = buildAssistantFacts({ ...base, board: many });
    expect(facts.briefing).toMatch(/18 further fares/);
  });

  it("is deterministic, so the prompt prefix can be cached", () => {
    expect(buildAssistantFacts(base).briefing).toBe(buildAssistantFacts(base).briefing);
  });
});
