import { describe, expect, it } from "vitest";
import { OpportunityComparator, compareOpportunities } from "@/lib/domain/opportunity";
import type { OpportunityFingerprint, RankedCandidate } from "@/lib/domain/types";

const fingerprint = (
  partial: Partial<OpportunityFingerprint> & Pick<OpportunityFingerprint, "bestPriceCents">,
): OpportunityFingerprint => ({
  bestJourneyKey: "key",
  bestTravelDate: "2026-09-19",
  sameDayBestPriceCents: null,
  sameDayJourneyKey: null,
  qualifyingCount: 1,
  ...partial,
});

describe("OpportunityComparator", () => {
  it("emails the first qualifying drop and not an unchanged repeat", () => {
    expect(compareOpportunities(null, fingerprint({ bestPriceCents: 9900 }))).toEqual({
      notify: true,
      reason: "first_qualifying",
    });
    expect(
      compareOpportunities(
        fingerprint({ bestPriceCents: 9900 }),
        fingerprint({ bestPriceCents: 9900 }),
      ),
    ).toEqual({ notify: false, reason: "unchanged" });
  });

  it("emails when the best price improves", () => {
    expect(
      compareOpportunities(
        fingerprint({ bestPriceCents: 9900 }),
        fingerprint({ bestPriceCents: 8900 }),
      ),
    ).toEqual({ notify: true, reason: "better_price" });
  });

  it("may email when a same-day alternative appears near the best price", () => {
    expect(
      compareOpportunities(
        fingerprint({ bestPriceCents: 8900, sameDayBestPriceCents: null }),
        fingerprint({
          bestPriceCents: 8900,
          sameDayBestPriceCents: 9000,
          sameDayJourneyKey: "same",
        }),
      ),
    ).toEqual({ notify: true, reason: "better_convenience" });
  });

  it("does not treat a $128 booking with no cheaper fare as an alert", () => {
    const comparator = new OpportunityComparator();
    const result = comparator.decide(null, [], 12800, 100);
    expect(result.decision).toEqual({ notify: false, reason: "no_qualifying" });
  });

  it("qualifies any window date under the threshold", () => {
    const comparator = new OpportunityComparator();
    const candidate = {
      totalPartyPriceCents: 7400,
      savingsCents: 5400,
      dateOffsetDays: -1,
      preferredTimeDeltaMinutes: null,
      rankScore: 0,
      journey: {
        id: "179",
        searchedTravelDate: "2026-09-19",
        trainNumber: "179",
        departureAt: "2026-09-19T07:05:00",
      },
      fare: { fareFamily: "FLEXIBLE", travelClass: "COACH" },
    } as RankedCandidate;
    const result = comparator.decide(null, [candidate], 12800, 100);
    expect(result.decision.notify).toBe(true);
    expect(result.qualifying).toHaveLength(1);
  });
});
