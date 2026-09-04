import { describe, expect, it } from "vitest";
import {
  cheaperCount,
  cheapestByBucket,
  connectionNote,
  fastestCheaper,
  isOvernight,
  sparklineValues,
  waitMinutes,
} from "@/lib/domain/board-insights";
import { sortBoard } from "@/lib/domain/board-tools";
import type { RankedCandidate } from "@/lib/domain/types";

function stub(input: {
  id: string;
  depart: string;
  arrive?: string;
  duration: number;
  price: number;
  savings: number;
}): RankedCandidate {
  return {
    totalPartyPriceCents: input.price,
    savingsCents: input.savings,
    dateOffsetDays: 0,
    preferredTimeDeltaMinutes: null,
    rankScore: 1,
    fare: {
      id: input.id,
      fareFamily: "FLEXIBLE",
      fareFamilyRaw: "WANDERU_LISTED",
      travelClass: "COACH",
      travelClassRaw: "COACH",
      availability: "AVAILABLE",
      observedPriceCents: input.price,
      priceSemantics: "PER_TRAVELER",
      pricePerTravelerCents: input.price,
      totalPartyPriceCents: input.price,
      priceFailureReason: null,
    },
    journey: {
      id: input.id,
      searchedTravelDate: "2026-09-23",
      serviceName: "Northeast Regional",
      trainNumber: "95",
      serviceType: "DIRECT_RAIL",
      originCode: "BOS",
      destinationCode: "NYP",
      departureAt: input.depart,
      arrivalAt: input.arrive ?? "2026-09-23T12:00:00",
      durationMinutes: input.duration,
      transferCount: 0,
      legs: [],
      fares: [],
      provider: {
        provider: "x",
        requestId: "r",
        retrievedAt: "2026-09-03T00:00:00Z",
        latencyMs: 1,
        creditsCharged: 0,
      },
    },
  };
}

describe("board insights", () => {
  it("detects overnight trips and connection waits", () => {
    expect(isOvernight("2026-09-23T22:00:00", "2026-09-24T06:10:00")).toBe(true);
    expect(isOvernight("2026-09-23T07:00:00", "2026-09-23T11:00:00")).toBe(false);
    expect(waitMinutes("2026-09-23T10:00:00", "2026-09-23T10:42:00")).toBe(42);
    expect(waitMinutes("2026-09-23T10:00:00", "2026-09-23T09:00:00")).toBeNull();
  });

  it("flags tight connections", () => {
    const connecting = stub({
      id: "c",
      depart: "2026-09-23T07:00:00",
      duration: 300,
      price: 4700,
      savings: 10,
    });
    connecting.journey.transferCount = 1;
    connecting.journey.legs = [
      {
        originCode: "BOS",
        destinationCode: "NHV",
        departureAt: "2026-09-23T07:00:00",
        arrivalAt: "2026-09-23T09:00:00",
        serviceName: "Regional",
        trainNumber: "95",
        serviceType: "CONNECTING_RAIL",
      },
      {
        originCode: "NHV",
        destinationCode: "NYP",
        departureAt: "2026-09-23T09:12:00",
        arrivalAt: "2026-09-23T11:10:00",
        serviceName: "Regional",
        trainNumber: "93",
        serviceType: "CONNECTING_RAIL",
      },
    ];
    expect(connectionNote(connecting).quality).toBe("tight");
    expect(connectionNote(connecting).label).toContain("12m");
    connecting.journey.legs[1]!.departureAt = "2026-09-23T11:00:00";
    expect(connectionNote(connecting).quality).toBe("long");
  });

  it("finds cheapest by time of day and the fastest cheaper train", () => {
    const morning = stub({
      id: "m",
      depart: "2026-09-23T07:00:00",
      duration: 240,
      price: 6100,
      savings: 20,
    });
    const afternoon = stub({
      id: "a",
      depart: "2026-09-23T13:00:00",
      duration: 180,
      price: 4700,
      savings: 8100,
    });
    const evening = stub({
      id: "e",
      depart: "2026-09-23T19:00:00",
      duration: 210,
      price: 8900,
      savings: 0,
    });
    const buckets = cheapestByBucket([morning, afternoon, evening]);
    expect(buckets.morning?.journey.id).toBe("m");
    expect(buckets.afternoon?.journey.id).toBe("a");
    expect(fastestCheaper([morning, afternoon, evening])?.journey.id).toBe("a");
    expect(cheaperCount([morning, afternoon, evening])).toBe(2);
    expect(sortBoard([evening, afternoon, morning], "price")[0]?.journey.id).toBe("a");
  });

  it("builds sparkline values from rebook events", () => {
    expect(sparklineValues([{ newPriceCents: 12800 }, { newPriceCents: 8900 }], 6100)).toEqual([
      12800, 8900, 6100,
    ]);
  });
});
