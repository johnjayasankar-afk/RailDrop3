import { describe, expect, it } from "vitest";
import {
  calendarIcs,
  decisionBrief,
  findBookedCandidate,
  formatDurationDelta,
  friendText,
  normalizeTrainNumber,
  windowInsight,
} from "@/lib/domain/board-decision";
import type { RankedCandidate } from "@/lib/domain/types";

function stub(input: {
  id: string;
  train: string;
  date?: string;
  depart: string;
  duration: number;
  price: number;
  savings: number;
  offset?: number;
}): RankedCandidate {
  return {
    totalPartyPriceCents: input.price,
    savingsCents: input.savings,
    dateOffsetDays: input.offset ?? 0,
    preferredTimeDeltaMinutes: null,
    rankScore: 1,
    fare: {
      id: `f-${input.id}`,
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
      searchedTravelDate: input.date ?? "2026-09-23",
      serviceName: "Northeast Regional",
      trainNumber: input.train,
      serviceType: "DIRECT_RAIL",
      originCode: "BOS",
      destinationCode: "NYP",
      departureAt: input.depart,
      arrivalAt: "2026-09-23T12:00:00",
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

describe("board decision", () => {
  it("matches a booked train number across labels", () => {
    expect(normalizeTrainNumber("Acela 2155")).toBe("2155");
    const yours = stub({
      id: "yours",
      train: "2155",
      depart: "2026-09-23T07:00:00",
      duration: 230,
      price: 13300,
      savings: 0,
    });
    const cheap = stub({
      id: "cheap",
      train: "95",
      depart: "2026-09-23T06:10:00",
      duration: 248,
      price: 3600,
      savings: 21400,
    });
    expect(findBookedCandidate([cheap, yours], "Acela 2155")?.journey.id).toBe("yours");
  });

  it("writes a stay-vs-switch brief and calendar file", () => {
    const yours = stub({
      id: "yours",
      train: "2155",
      depart: "2026-09-23T07:00:00",
      duration: 230,
      price: 13300,
      savings: 0,
    });
    const cheap = stub({
      id: "cheap",
      train: "95",
      depart: "2026-09-23T06:10:00",
      duration: 248,
      price: 3600,
      savings: 21400,
    });
    const brief = decisionBrief({
      originCode: "BOS",
      destinationCode: "NYP",
      desiredTravelDate: "2026-09-23",
      bookedCents: 25000,
      bookedTrainNumber: "2155",
      best: cheap,
      yours,
      sameDay: cheap,
    });
    expect(brief).toContain("you paid $250");
    expect(brief).toContain("save $214");
    expect(brief).toContain("Your train 2155");
    expect(brief).toContain("confirm on Amtrak");
    expect(formatDurationDelta(18)).toBe("18m longer");
    expect(calendarIcs(cheap)).toContain("BEGIN:VEVENT");
    expect(calendarIcs(cheap)).toContain("DTSTART:20260923T061000");
    expect(
      friendText({
        originCode: "BOS",
        destinationCode: "NYP",
        desiredTravelDate: "2026-09-23",
        bookedCents: 25000,
        best: cheap,
      }),
    ).toContain("cheapest listed $36");
  });

  it("explains a cheaper neighboring day", () => {
    const desired = stub({
      id: "d",
      train: "93",
      date: "2026-09-23",
      depart: "2026-09-23T09:20:00",
      duration: 240,
      price: 6100,
      savings: 10,
      offset: 0,
    });
    const earlier = stub({
      id: "e",
      train: "95",
      date: "2026-09-22",
      depart: "2026-09-22T06:10:00",
      duration: 240,
      price: 3600,
      savings: 20,
      offset: -1,
    });
    expect(
      windowInsight(
        [
          ["2026-09-22", earlier],
          ["2026-09-23", desired],
        ],
        "2026-09-23",
      ),
    ).toContain("$25 cheaper");
  });
});
