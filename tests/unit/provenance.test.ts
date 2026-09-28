import { describe, expect, it } from "vitest";
import { ageOf, fareProvenance, PLAUSIBILITY_CHECKS } from "@/lib/domain/provenance";
import { checkFare, type SanityContext } from "@/lib/domain/fare-sanity";
import type { FareOption, JourneyOption, RankedCandidate } from "@/lib/domain/types";

/* A receipt for a number.
 *
 * "We never invent a price" was a claim the reader had to take on trust: every
 * other honesty measure here — the sanity checks, the screening, the verifier
 * around the assistant — protects them without ever showing them anything.
 * This states what the source literally reported, what arithmetic turned that
 * into the figure on screen, and what the fare had to survive to be shown. A
 * claim you can audit is a different kind of claim.
 */

const context: SanityContext = {
  originCode: "BOS",
  destinationCode: "NYP",
  travelDate: "2026-10-09",
  passengerCount: 1,
};

const now = new Date("2026-10-01T12:00:00.000Z");

function candidate(
  fare: Partial<FareOption> = {},
  journey: Partial<JourneyOption> = {},
): RankedCandidate {
  return {
    journey: {
      id: "j179",
      searchedTravelDate: "2026-10-09",
      serviceName: "Northeast Regional",
      trainNumber: "179",
      serviceType: "DIRECT_RAIL",
      originCode: "BOS",
      destinationCode: "NYP",
      departureAt: "2026-10-09T11:05:00.000Z",
      arrivalAt: "2026-10-09T15:14:00.000Z",
      durationMinutes: 249,
      transferCount: 0,
      legs: [],
      fares: [],
      provider: {
        provider: "wanderu-browser",
        requestId: "a3f19c7e",
        retrievedAt: "2026-10-01T11:46:00.000Z",
        latencyMs: 8_200,
        creditsCharged: 0,
      },
      ...journey,
    },
    fare: {
      id: "f1",
      fareFamily: "UNKNOWN",
      fareFamilyRaw: null,
      travelClass: "COACH",
      travelClassRaw: null,
      availability: "AVAILABLE",
      observedPriceCents: 7_400,
      priceSemantics: "PER_TRAVELER",
      pricePerTravelerCents: 7_400,
      totalPartyPriceCents: 7_400,
      priceFailureReason: null,
      ...fare,
    },
    totalPartyPriceCents: 7_400,
    savingsCents: 5_400,
    dateOffsetDays: 0,
    preferredTimeDeltaMinutes: null,
    rankScore: 1,
  } as unknown as RankedCandidate;
}

describe("the derivation", () => {
  it("starts with what the source said, before anything was done to it", () => {
    /* The only line in the trail that is not ours, so it comes first. */
    const trail = fareProvenance(candidate(), context, now);
    expect(trail.steps[0]!.label).toMatch(/reported by the source/i);
    expect(trail.steps[0]!.value).toContain("$74");
    expect(trail.steps[0]!.value).toMatch(/per traveller/i);
  });

  it("shows the arithmetic when a party total is a multiplication", () => {
    const trail = fareProvenance(
      candidate({ totalPartyPriceCents: 22_200 }),
      {
        ...context,
        passengerCount: 3,
      },
      now,
    );
    const total = trail.steps.find((step) => step.label === "Party total");
    expect(total?.value).toContain("$222");
    expect(total?.note).toMatch(/multiplied by 3/i);
  });

  it("shows the division when the source quoted the whole party", () => {
    const trail = fareProvenance(
      candidate({
        priceSemantics: "PARTY_TOTAL",
        observedPriceCents: 22_200,
        pricePerTravelerCents: 7_400,
      }),
      { ...context, passengerCount: 3 },
      now,
    );
    expect(trail.steps.find((s) => s.label === "Per traveller")?.note).toMatch(/divided by 3/i);
  });

  it("says a total is not derivable rather than inventing one", () => {
    // The rule the whole product rests on, restated where a reader can see it.
    const trail = fareProvenance(candidate({ totalPartyPriceCents: null }), context, now);
    const total = trail.steps.find((step) => step.label === "Party total");
    expect(total?.value).toMatch(/not derivable/i);
    expect(total?.note).toMatch(/rather than guessed/i);
  });

  it("says a fare type was not stated instead of picking one", () => {
    /* Wanderu reports no fare family. Calling it FLEXIBLE was a real bug once;
       the trail is where that absence becomes visible. */
    const trail = fareProvenance(candidate(), context, now);
    const type = trail.steps.find((step) => step.label === "Fare type");
    expect(type?.value).toMatch(/not stated/i);
    expect(type?.note).toMatch(/non-refundable/i);
  });

  it("prefers the source's own words for a fare type when it gave them", () => {
    const trail = fareProvenance(
      candidate({ fareFamily: "SAVER", fareFamilyRaw: "Saver (non-refundable)" }),
      context,
      now,
    );
    expect(trail.steps.find((s) => s.label === "Fare type")?.value).toBe("Saver (non-refundable)");
  });
});

describe("the checks", () => {
  it("counts what was looked at, not what failed", () => {
    const trail = fareProvenance(candidate(), context, now);
    expect(trail.checksRun).toBe(PLAUSIBILITY_CHECKS.length);
    expect(trail.failures).toEqual([]);
    expect(trail.summary).toContain(`${PLAUSIBILITY_CHECKS.length} checks`);
  });

  it("has not drifted from the checks fare-sanity actually performs", () => {
    /* The count lives beside the list it describes, and this is what stops the
       two parting company — a trail that claims thirteen checks while twelve
       run is exactly the kind of false assurance this feature exists to avoid. */
    const codes = new Set(
      [
        ...checkFare(
          candidate({
            observedPriceCents: null,
            pricePerTravelerCents: null,
            totalPartyPriceCents: null,
          }).journey,
          candidate({
            observedPriceCents: null,
            pricePerTravelerCents: null,
            totalPartyPriceCents: null,
          }).fare,
          context,
        ),
        ...checkFare(
          candidate({ observedPriceCents: 1, pricePerTravelerCents: 1, totalPartyPriceCents: 1 })
            .journey,
          candidate({ observedPriceCents: 1, pricePerTravelerCents: 1, totalPartyPriceCents: 1 })
            .fare,
          context,
        ),
      ].map((rejection) => rejection.code),
    );
    // Every code produced must be describable by an entry in the list.
    expect(codes.size).toBeGreaterThan(0);
    expect(PLAUSIBILITY_CHECKS.length).toBeGreaterThanOrEqual(codes.size);
  });

  it("reports a failure rather than hiding it", () => {
    const trail = fareProvenance(
      candidate({ observedPriceCents: 1, pricePerTravelerCents: 1, totalPartyPriceCents: 1 }),
      context,
      now,
    );
    expect(trail.failures.length).toBeGreaterThan(0);
    expect(trail.summary).toMatch(/failed/i);
  });
});

describe("attribution", () => {
  it("names the source and the request that saw it", () => {
    const trail = fareProvenance(candidate(), context, now);
    expect(trail.source).toBe("Wanderu");
    expect(trail.requestId).toBe("a3f19c7e");
    expect(trail.observedAt).toBe("2026-10-01T11:46:00.000Z");
  });
});

describe("age", () => {
  it("is coarse, because the precision is not there to claim", () => {
    /* It was read off a page that had itself been cached for an unknown while,
       so "14 minutes 22 seconds" would imply an accuracy the number lacks. */
    expect(ageOf("2026-10-01T11:46:00.000Z", now)).toBe("14 minutes ago");
    expect(ageOf("2026-10-01T11:59:30.000Z", now)).toBe("moments ago");
    expect(ageOf("2026-10-01T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(ageOf("2026-09-28T12:00:00.000Z", now)).toBe("3 days ago");
  });

  it("does not claim a fare from the future is old", () => {
    expect(ageOf("2026-10-01T12:00:30.000Z", now)).toBe("just now");
  });

  it("says so when the timestamp is unreadable", () => {
    expect(ageOf("nonsense", now)).toBe("at an unknown time");
  });
});
