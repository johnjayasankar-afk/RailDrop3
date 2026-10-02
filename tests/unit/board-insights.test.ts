import { describe, expect, it } from "vitest";
import {
  cheaperCount,
  cheapestByBucket,
  changeNote,
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
    /* The count comes from transferCount; the station and the minutes come
       from the legs, and only when the legs account for the changes. */
    expect(changeNote(connecting)).toEqual({
      changes: 1,
      label: "1 change at NHV · 12m to connect",
    });

    connecting.journey.legs[1]!.departureAt = "2026-09-23T11:00:00";
    expect(changeNote(connecting).label).toBe("1 change at NHV · 120m to connect");
  });

  it("says how many changes even when the legs do not account for them", () => {
    /* The regression this exists for. wanderu-trips.json entry 3 has
       `transfers: 2` and ONE itinerary leg, because the normalizer builds
       legs from the train legs only and a train-bus-train journey loses its
       middle. The old helper returned "Nonstop" for it — `transferCount === 0
       || legs.length < 2` — so a two-change trip rendered with no flag, and
       a reader who knows a nonstop is unmarked read that silence as
       "nonstop". */
    const partial = stub({
      id: "p",
      depart: "2026-09-23T12:57:00",
      duration: 642,
      price: 6500,
      savings: 0,
    });
    partial.journey.transferCount = 2;
    partial.journey.legs = [
      {
        originCode: "BOS",
        destinationCode: "NWK",
        departureAt: "2026-09-23T12:57:00",
        arrivalAt: "2026-09-23T15:21:00",
        serviceName: "Lake Shore Limited",
        trainNumber: "449",
        serviceType: "CONNECTING_RAIL",
      },
    ];
    expect(changeNote(partial)).toEqual({
      changes: 2,
      label: "2 changes, station not stated",
    });
  });

  it("says nothing at all about a nonstop", () => {
    /* Not the word "nonstop": the absence of a flag already says it, and
       asserting it was false for the case above. */
    const direct = stub({
      id: "d",
      depart: "2026-09-23T07:00:00",
      duration: 240,
      price: 4700,
      savings: 0,
    });
    direct.journey.transferCount = 0;
    expect(changeNote(direct)).toEqual({ changes: 0, label: null });
  });

  it("will not name a station the normalizer could not resolve", () => {
    const vague = stub({
      id: "v",
      depart: "2026-09-23T07:00:00",
      duration: 300,
      price: 4700,
      savings: 0,
    });
    vague.journey.transferCount = 1;
    vague.journey.legs = [
      {
        originCode: "BOS",
        destinationCode: "—",
        departureAt: "2026-09-23T07:00:00",
        arrivalAt: "2026-09-23T09:00:00",
        serviceName: "Regional",
        trainNumber: "95",
        serviceType: "CONNECTING_RAIL",
      },
      {
        originCode: "—",
        destinationCode: "NYP",
        departureAt: "2026-09-23T09:20:00",
        arrivalAt: "2026-09-23T11:10:00",
        serviceName: "Regional",
        trainNumber: "93",
        serviceType: "CONNECTING_RAIL",
      },
    ];
    // The minutes survive — both timestamps are real — but no station is named.
    expect(changeNote(vague).label).toBe("1 change · 20m to connect");
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
