import { describe, expect, it } from "vitest";
import { collectEligibleFares } from "@/lib/domain/eligibility";
import { compareRankedCandidates, rankCandidates } from "@/lib/domain/ranking";
import type { FareOption, JourneyOption } from "@/lib/domain/types";

function fare(
  partial: Partial<FareOption> & Pick<FareOption, "id" | "totalPartyPriceCents">,
): FareOption {
  return {
    fareFamily: "FLEXIBLE",
    fareFamilyRaw: "FLX",
    travelClass: "COACH",
    travelClassRaw: "Coach",
    availability: "AVAILABLE",
    observedPriceCents: partial.totalPartyPriceCents,
    priceSemantics: "PER_TRAVELER",
    pricePerTravelerCents: partial.totalPartyPriceCents,
    priceFailureReason: null,
    ...partial,
  };
}

function journey(
  partial: Partial<JourneyOption> & Pick<JourneyOption, "id" | "fares">,
): JourneyOption {
  return {
    searchedTravelDate: "2026-09-20",
    serviceName: "Northeast Regional",
    trainNumber: "171",
    serviceType: "DIRECT_RAIL",
    originCode: "BOS",
    destinationCode: "NYP",
    departureAt: "2026-09-20T17:00:00",
    arrivalAt: "2026-09-20T21:00:00",
    durationMinutes: 240,
    transferCount: 0,
    legs: [],
    provider: {
      provider: "test",
      requestId: "1",
      retrievedAt: "2026-09-02T00:00:00Z",
      latencyMs: 1,
      creditsCharged: 2,
    },
    ...partial,
  };
}

const rules = {
  includeRestrictedFares: false,
  includeThruway: false,
  travelClass: "COACH" as const,
  requireAvailable: true,
};

describe("eligibility", () => {
  it("keeps Flexible coach and ignores Value by default", () => {
    const journeys = [
      journey({
        id: "a",
        fares: [
          fare({ id: "flx", fareFamily: "FLEXIBLE", totalPartyPriceCents: 10100 }),
          fare({ id: "vlu", fareFamily: "VALUE", totalPartyPriceCents: 5900 }),
        ],
      }),
    ];
    expect(collectEligibleFares(journeys, rules).map((item) => item.fare.id)).toEqual(["flx"]);
  });

  it("includes restricted fares when enabled", () => {
    const journeys = [
      journey({
        id: "a",
        fares: [fare({ id: "vlu", fareFamily: "VALUE", totalPartyPriceCents: 5900 })],
      }),
    ];
    expect(
      collectEligibleFares(journeys, { ...rules, includeRestrictedFares: true }).map(
        (item) => item.fare.id,
      ),
    ).toEqual(["vlu"]);
  });

  it("excludes wrong class, unavailable, and thruway by default", () => {
    const journeys = [
      journey({
        id: "biz",
        fares: [fare({ id: "biz", travelClass: "BUSINESS", totalPartyPriceCents: 8000 })],
      }),
      journey({
        id: "sold",
        fares: [fare({ id: "sold", availability: "UNAVAILABLE", totalPartyPriceCents: 5000 })],
      }),
      journey({
        id: "bus",
        serviceType: "THRUWAY_OR_BUS",
        fares: [fare({ id: "bus", totalPartyPriceCents: 4000 })],
      }),
    ];
    expect(collectEligibleFares(journeys, rules)).toEqual([]);
  });
});

describe("ranking", () => {
  it("orders cheapest first even if the date differs", () => {
    const ranked = rankCandidates(
      [
        {
          journey: journey({
            id: "later",
            searchedTravelDate: "2026-09-21",
            departureAt: "2026-09-21T17:00:00",
            fares: [],
          }),
          fare: fare({ id: "later", totalPartyPriceCents: 8600 }),
        },
        {
          journey: journey({
            id: "early",
            searchedTravelDate: "2026-09-19",
            departureAt: "2026-09-19T07:05:00",
            fares: [],
          }),
          fare: fare({ id: "early", totalPartyPriceCents: 7400 }),
        },
      ],
      {
        desiredTravelDate: "2026-09-20",
        preferredDepartureTime: "17:00",
        currentBookedPriceCents: 12800,
      },
    );
    expect(ranked[0].journey.id).toBe("early");
  });

  it("prefers desired date, then preferred time, then fewer transfers", () => {
    const samePrice = fare({ id: "x", totalPartyPriceCents: 8000 });
    const a = {
      journey: journey({
        id: "desired-close",
        searchedTravelDate: "2026-09-20",
        departureAt: "2026-09-20T17:05:00",
        transferCount: 0,
        durationMinutes: 240,
        fares: [],
      }),
      fare: samePrice,
    };
    const b = {
      journey: journey({
        id: "other-day",
        searchedTravelDate: "2026-09-19",
        departureAt: "2026-09-19T17:00:00",
        transferCount: 0,
        fares: [],
      }),
      fare: samePrice,
    };
    const ranked = rankCandidates([b, a], {
      desiredTravelDate: "2026-09-20",
      preferredDepartureTime: "17:00",
      currentBookedPriceCents: 12800,
    });
    expect(ranked[0].journey.id).toBe("desired-close");

    const closerTime = rankCandidates(
      [
        {
          journey: journey({
            id: "far",
            searchedTravelDate: "2026-09-20",
            departureAt: "2026-09-20T07:00:00",
            fares: [],
          }),
          fare: samePrice,
        },
        {
          journey: journey({
            id: "near",
            searchedTravelDate: "2026-09-20",
            departureAt: "2026-09-20T16:50:00",
            fares: [],
          }),
          fare: samePrice,
        },
      ],
      {
        desiredTravelDate: "2026-09-20",
        preferredDepartureTime: "17:00",
        currentBookedPriceCents: 12800,
      },
    );
    expect(closerTime[0].journey.id).toBe("near");

    const fewerTransfers = rankCandidates(
      [
        {
          journey: journey({
            id: "connect",
            searchedTravelDate: "2026-09-20",
            departureAt: "2026-09-20T17:00:00",
            transferCount: 1,
            fares: [],
          }),
          fare: samePrice,
        },
        {
          journey: journey({
            id: "direct",
            searchedTravelDate: "2026-09-20",
            departureAt: "2026-09-20T17:00:00",
            transferCount: 0,
            fares: [],
          }),
          fare: samePrice,
        },
      ],
      {
        desiredTravelDate: "2026-09-20",
        preferredDepartureTime: "17:00",
        currentBookedPriceCents: 12800,
      },
    );
    expect(fewerTransfers[0].journey.id).toBe("direct");
    expect(compareRankedCandidates(fewerTransfers[0], fewerTransfers[0])).toBe(0);
  });
});
