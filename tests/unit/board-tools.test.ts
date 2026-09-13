import { describe, expect, it } from "vitest";
import { savingsPercent, departureBucket, filterBoard, isAcela } from "@/lib/domain/board-tools";
import type { RankedCandidate } from "@/lib/domain/types";

function stub(input: { depart: string; name: string; transfers?: number }): RankedCandidate {
  return {
    totalPartyPriceCents: 4700,
    savingsCents: 10,
    dateOffsetDays: 0,
    preferredTimeDeltaMinutes: null,
    rankScore: 1,
    fare: {
      id: input.depart,
      fareFamily: "FLEXIBLE",
      fareFamilyRaw: "WANDERU_LISTED",
      travelClass: "COACH",
      travelClassRaw: "COACH",
      availability: "AVAILABLE",
      observedPriceCents: 4700,
      priceSemantics: "PER_TRAVELER",
      pricePerTravelerCents: 4700,
      totalPartyPriceCents: 4700,
      priceFailureReason: null,
    },
    journey: {
      id: input.depart,
      searchedTravelDate: "2026-09-23",
      serviceName: input.name,
      trainNumber: "95",
      serviceType: (input.transfers ?? 0) > 0 ? "CONNECTING_RAIL" : "DIRECT_RAIL",
      originCode: "BOS",
      destinationCode: "NYP",
      departureAt: input.depart,
      arrivalAt: "2026-09-23T12:00:00",
      durationMinutes: 240,
      transferCount: input.transfers ?? 0,
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

describe("board tools", () => {
  it("computes savings percent and time of day", () => {
    expect(savingsPercent(25000, 3600)).toBe(86);
    expect(savingsPercent(3600, 3600)).toBeNull();
    expect(departureBucket("2026-09-23T07:10:00")).toBe("morning");
    expect(departureBucket("2026-09-23T15:10:00")).toBe("afternoon");
    expect(departureBucket("2026-09-23T19:10:00")).toBe("evening");
  });

  it("filters Acela and morning trains", () => {
    const a = stub({ depart: "2026-09-23T07:00:00", name: "Acela" });
    const b = stub({ depart: "2026-09-23T13:00:00", name: "Northeast Regional" });
    expect(isAcela(a)).toBe(true);
    const morning = filterBoard([a, b], {
      dateFilter: "all",
      service: "all",
      bucket: "morning",
      savingsOnly: false,
    });
    expect(morning).toHaveLength(1);
    expect(morning[0]?.journey.departureAt).toContain("T07:00");
    const after = filterBoard([a, b], {
      dateFilter: "all",
      service: "all",
      bucket: "all",
      savingsOnly: false,
      departAfter: "10:00",
    });
    expect(after).toHaveLength(1);
    expect(after[0]?.journey.departureAt).toContain("T13:00");
  });
});
