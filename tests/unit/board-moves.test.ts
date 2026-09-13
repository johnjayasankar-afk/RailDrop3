import { describe, expect, it } from "vitest";
import {
  boardMoves,
  hassleNote,
  journeyIdentity,
  moveLabel,
  travelUrgency,
} from "@/lib/domain/board-moves";
import type { RankedCandidate } from "@/lib/domain/types";

function stub(id: string, train: string, price: number): RankedCandidate {
  return {
    totalPartyPriceCents: price,
    savingsCents: 10,
    dateOffsetDays: 0,
    preferredTimeDeltaMinutes: null,
    rankScore: 1,
    fare: {
      id: `f-${id}`,
      fareFamily: "FLEXIBLE",
      fareFamilyRaw: "WANDERU_LISTED",
      travelClass: "COACH",
      travelClassRaw: "COACH",
      availability: "AVAILABLE",
      observedPriceCents: price,
      priceSemantics: "PER_TRAVELER",
      pricePerTravelerCents: price,
      totalPartyPriceCents: price,
      priceFailureReason: null,
    },
    journey: {
      id,
      searchedTravelDate: "2026-09-23",
      serviceName: "Northeast Regional",
      trainNumber: train,
      serviceType: "DIRECT_RAIL",
      originCode: "BOS",
      destinationCode: "NYP",
      departureAt: `2026-09-23T0${train.slice(-1)}:00:00`,
      arrivalAt: "2026-09-23T12:00:00",
      durationMinutes: 240,
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

describe("board moves", () => {
  it("diffs listed prices for the same train across scans", () => {
    const prev = [stub("a", "95", 6100), stub("b", "93", 8900)];
    const next = [stub("a2", "95", 3600), stub("c", "179", 4700)];
    expect(journeyIdentity(prev[0]!)).toContain("95");
    const moves = boardMoves(prev, next);
    expect(moves[0]?.kind).toBe("drop");
    expect(moves[0]?.deltaCents).toBe(2500);
    expect(moveLabel(moves[0]!)).toContain("dropped $25");
    expect(moves.some((move) => move.kind === "new" && move.train.includes("179"))).toBe(true);
  });

  it("flags urgency and small last-minute saves", () => {
    expect(travelUrgency(0).level).toBe("now");
    expect(travelUrgency(12).level).toBe("watch");
    expect(hassleNote({ savingsCents: 400, minimumSavingsCents: 1000, daysUntil: 10 })).toContain(
      "alert threshold",
    );
    expect(hassleNote({ savingsCents: 800, minimumSavingsCents: 100, daysUntil: 1 })).toContain(
      "close to departure",
    );
  });
});
