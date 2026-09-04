import { describe, expect, it } from "vitest";
import {
  aroundMinutes,
  cheaperOptionsText,
  decisionPacket,
  feeNote,
  itineraryText,
  ladderPercent,
  matchesTrainQuery,
  missedBestNote,
  neighborDepartures,
  netAfterFee,
  passesSchedule,
  priceLadder,
  sameTrainAcrossDates,
  scanTone,
  applyArriveBuffer,
  amtrakFieldsText,
  arrivalDateNote,
  earliestDeparture,
  lastDeparture,
  nextMatchingKey,
  hasDeparted,
  minutesUntilDepart,
  watchAttention,
} from "@/lib/domain/board-act";
import type { RankedCandidate } from "@/lib/domain/types";

function stub(input: {
  id: string;
  train?: string;
  date?: string;
  depart: string;
  price: number;
  savings?: number;
}): RankedCandidate {
  return {
    totalPartyPriceCents: input.price,
    savingsCents: input.savings ?? 0,
    dateOffsetDays: 0,
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
      trainNumber: input.train ?? "95",
      serviceType: "DIRECT_RAIL",
      originCode: "BOS",
      destinationCode: "NYP",
      departureAt: input.depart,
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

describe("board act", () => {
  it("lines up the same train across neighboring dates", () => {
    const earlier = stub({
      id: "a",
      date: "2026-09-22",
      depart: "2026-09-22T06:10:00",
      price: 3600,
    });
    const day = stub({
      id: "b",
      date: "2026-09-23",
      depart: "2026-09-23T06:10:00",
      price: 4700,
    });
    const later = stub({
      id: "c",
      train: "93",
      date: "2026-09-24",
      depart: "2026-09-24T09:20:00",
      price: 6100,
    });
    const rows = sameTrainAcrossDates([earlier, day, later], "95", [
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
    expect(rows.map((row) => row.candidate?.totalPartyPriceCents ?? null)).toEqual([
      3600,
      4700,
      null,
    ]);
  });

  it("finds cheaper neighbors around a departure", () => {
    const yours = stub({ id: "y", depart: "2026-09-23T09:20:00", price: 12800 });
    const earlier = stub({
      id: "e",
      train: "93",
      depart: "2026-09-23T08:50:00",
      price: 6100,
      savings: 6700,
    });
    const later = stub({
      id: "l",
      train: "171",
      depart: "2026-09-23T09:55:00",
      price: 8900,
      savings: 3900,
    });
    const far = stub({
      id: "f",
      train: "2155",
      depart: "2026-09-23T13:00:00",
      price: 3600,
      savings: 9200,
    });
    const neighbors = neighborDepartures([yours, earlier, later, far], {
      travelDate: "2026-09-23",
      aroundIso: yours.journey.departureAt,
      excludeId: yours.journey.id,
    });
    expect(neighbors.map((item) => item.journey.id)).toEqual(["e", "l"]);
    expect(aroundMinutes(null, "09:20")).toBe(9 * 60 + 20);
  });

  it("nets listed savings against a user-entered fee", () => {
    expect(netAfterFee(8100, 3000)).toBe(5100);
    expect(feeNote(8100, 3000)).toContain("after a $30 change fee");
    expect(feeNote(2000, 3000)).toContain("less than a $30 fee");
    expect(feeNote(8100, 0)).toBeNull();
  });

  it("places booked price on a ladder and matches train search", () => {
    const cheap = stub({ id: "c", train: "95", depart: "2026-09-23T06:10:00", price: 3600 });
    const dear = stub({ id: "d", train: "2155", depart: "2026-09-23T07:00:00", price: 13300 });
    const ladder = priceLadder([cheap, dear], 12800);
    expect(ladder.min).toBe(3600);
    expect(ladder.max).toBe(13300);
    expect(ladderPercent(3600, 3600, 13300)).toBe(0);
    expect(ladderPercent(13300, 3600, 13300)).toBe(100);
    expect(matchesTrainQuery(cheap, "95")).toBe(true);
    expect(matchesTrainQuery(cheap, "Acela")).toBe(false);
    expect(
      cheaperOptionsText({
        originCode: "BOS",
        destinationCode: "NYP",
        desiredTravelDate: "2026-09-23",
        bookedCents: 12800,
        cheaper: [{ ...cheap, savingsCents: 9200 }],
      }),
    ).toContain("Northeast Regional 95");
    expect(scanTone("PARTIAL_SUCCESS")).toBe("warn");
    expect(scanTone("SUCCESS")).toBe("ok");
  });

  it("gates trains by leave-after and arrive-by", () => {
    const early = stub({ id: "e", depart: "2026-09-23T06:10:00", price: 3600 });
    early.journey.arrivalAt = "2026-09-23T10:18:00";
    early.journey.durationMinutes = 248;
    const late = stub({ id: "l", train: "93", depart: "2026-09-23T13:00:00", price: 6100 });
    late.journey.arrivalAt = "2026-09-23T17:05:00";
    expect(passesSchedule(early, { departAfter: "08:00" })).toBe(false);
    expect(passesSchedule(late, { departAfter: "08:00" })).toBe(true);
    expect(passesSchedule(early, { arriveBefore: "11:00" })).toBe(true);
    expect(passesSchedule(late, { arriveBefore: "11:00" })).toBe(false);
    expect(passesSchedule(early, { maxDuration: 180 })).toBe(false);
    expect(itineraryText(early)).toContain("BOS → NYP");
    expect(missedBestNote(3600, 6100)).toContain("was $36");
    expect(missedBestNote(6100, 3600)).toBeNull();
    expect(
      watchAttention(
        {
          status: "ACTIVE",
          desiredTravelDate: "2026-09-03",
          bestSavingsCents: 0,
          lastCheckedAt: "2026-09-01T00:00:00Z",
        } as import("@/lib/db/models").WatchRecord,
        "2026-09-02",
      ).level,
    ).toBe("soon");
    expect(applyArriveBuffer("11:00", 30)).toBe("10:30");
    expect(applyArriveBuffer("00:10", 30)).toBe("00:00");
    expect(
      decisionPacket({
        brief: "Stay on 95 unless 93 still lists cheaper.",
        feeCopy: "About $20 after a $15 change fee — confirm the real fee on Amtrak.",
        beats: [early],
      }),
    ).toContain("Confirm on Amtrak before changing anything.");
    expect(lastDeparture([early, late])?.journey.id).toBe("l");
    expect(earliestDeparture([early, late])?.journey.id).toBe("e");
    expect(nextMatchingKey(["a", "b", "c"], "a", new Set(["c"]))).toBe("c");
    expect(nextMatchingKey(["a", "b", "c"], "c", new Set(["a"]))).toBe("a");
    expect(amtrakFieldsText(early)).toContain("BOS → NYP");
    expect(amtrakFieldsText(early)).toContain("2026-09-23");
    late.journey.arrivalAt = "2026-09-24T01:05:00";
    expect(arrivalDateNote(late.journey.departureAt, late.journey.arrivalAt)).toContain("arrives");
    expect(arrivalDateNote(early.journey.departureAt, early.journey.arrivalAt)).toBeNull();
    expect(hasDeparted("2026-09-22", "2026-09-22T06:10:00", "2026-09-23", 800)).toBe(true);
    expect(hasDeparted("2026-09-23", "2026-09-23T06:10:00", "2026-09-23", 400)).toBe(true);
    expect(hasDeparted("2026-09-23", "2026-09-23T13:00:00", "2026-09-23", 400)).toBe(false);
    expect(minutesUntilDepart("2026-09-23", "2026-09-23T07:00:00", "2026-09-23", 6 * 60 + 10)).toBe(
      50,
    );
  });
});
