import { describe, expect, it } from "vitest";
import {
  decisionPicks,
  perPersonCents,
  roundTripPairs,
  withPinnedVisible,
  cheapestDirect,
  acelaContrast,
  beatsBooked,
  trainsThatBeat,
  beatNote,
  compareFocus,
  compareLine,
  pairNote,
  sortWatches,
  duplicateWatchIds,
  feeCeilingNote,
  windowStrip,
  switchVerdict,
  soonestWatch,
} from "@/lib/domain/board-picks";
import type { WatchRecord } from "@/lib/db/models";
import type { RankedCandidate } from "@/lib/domain/types";

function watch(id: string, origin: string, dest: string, savings: number): WatchRecord {
  return {
    id,
    userId: "u",
    originCode: origin,
    destinationCode: dest,
    desiredTravelDate: "2026-09-23",
    dateFlexibilityDays: 1,
    preferredDepartureTime: null,
    passengerCount: 2,
    bookedTrainNumber: null,
    bookedDepartureAt: null,
    bookedFareFamily: "FLEXIBLE",
    travelClass: "COACH",
    currentBookedPriceCents: 12800,
    includeRestrictedFares: false,
    includeThruway: false,
    minimumSavingsCents: 100,
    bookedAt: "2026-09-02T00:00:00Z",
    monitorStartAt: "2026-09-02T00:00:00Z",
    monitorEndAt: null,
    monitorPreset: "48h",
    timezone: "America/New_York",
    alertEmail: "a@x.com",
    status: "ACTIVE",
    lastCheckCycleId: null,
    lastCheckedAt: null,
    nextCheckSlot: null,
    nextCheckAtLabel: null,
    bestPriceCents: 3600,
    bestSavingsCents: savings,
    lastOpportunity: null,
    createdAt: "2026-09-02T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
  };
}

describe("board picks", () => {
  it("splits a party total and pairs reverse trips", () => {
    expect(perPersonCents(7200, 2)).toBe(3600);
    expect(perPersonCents(7200, 1)).toBeNull();
    const pairs = roundTripPairs([
      watch("1", "BOS", "NYP", 4000),
      watch("2", "NYP", "BOS", 2500),
      watch("3", "PHL", "WAS", 1000),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.savingsCents).toBe(6500);
  });

  it("keeps pinned trains on a truncated board", () => {
    expect(withPinnedVisible(["a", "b", "c", "d"], 2, ["d"], (item) => item)).toEqual([
      "a",
      "b",
      "d",
    ]);
    expect(withPinnedVisible(["a", "b"], 2, ["a"], (item) => item)).toEqual(["a", "b"]);
  });

  it("names decision picks without dropping yours", () => {
    const cheap = {
      journey: { id: "j1" },
      fare: { id: "f1" },
    } as RankedCandidate;
    const yours = {
      journey: { id: "j2" },
      fare: { id: "f2" },
    } as RankedCandidate;
    const picks = decisionPicks({
      best: cheap,
      fastest: cheap,
      preferred: null,
      yours,
      direct: cheap,
    });
    expect(picks.map((pick) => pick.kind)).toEqual(["cheapest", "fastest", "yours"]);
  });

  it("picks cheapest direct and contrasts Acela vs Regional", () => {
    const connecting = {
      totalPartyPriceCents: 3600,
      journey: {
        id: "c",
        transferCount: 1,
        durationMinutes: 300,
        serviceName: "Regional",
        trainNumber: "93",
      },
      fare: { id: "fc" },
    } as RankedCandidate;
    const regional = {
      totalPartyPriceCents: 4700,
      journey: {
        id: "r",
        transferCount: 0,
        durationMinutes: 248,
        serviceName: "Northeast Regional",
        trainNumber: "95",
      },
      fare: { id: "fr" },
    } as RankedCandidate;
    const acela = {
      totalPartyPriceCents: 13300,
      journey: {
        id: "a",
        transferCount: 0,
        durationMinutes: 227,
        serviceName: "Acela",
        trainNumber: "2155",
      },
      fare: { id: "fa" },
    } as RankedCandidate;
    expect(cheapestDirect([connecting, regional, acela])?.journey.id).toBe("r");
    const contrast = acelaContrast([connecting, regional, acela]);
    expect(contrast?.extraCents).toBe(8600);
    expect(contrast?.fasterMinutes).toBe(21);
  });

  it("flags trains that beat the one you booked", () => {
    const yours = {
      totalPartyPriceCents: 12800,
      journey: { id: "yours", durationMinutes: 248 },
      fare: { id: "fy" },
    } as RankedCandidate;
    const cheaperSame = {
      totalPartyPriceCents: 4700,
      journey: { id: "cheap", durationMinutes: 248 },
      fare: { id: "fc" },
    } as RankedCandidate;
    const cheaperSlower = {
      totalPartyPriceCents: 3600,
      journey: { id: "slow", durationMinutes: 320 },
      fare: { id: "fs" },
    } as RankedCandidate;
    const fasterSame = {
      totalPartyPriceCents: 12800,
      journey: { id: "fast", durationMinutes: 227 },
      fare: { id: "ff" },
    } as RankedCandidate;
    expect(beatsBooked(cheaperSame, yours)).toBe(true);
    expect(beatsBooked(cheaperSlower, yours)).toBe(false);
    expect(beatsBooked(fasterSame, yours)).toBe(true);
    expect(beatsBooked(yours, yours)).toBe(false);
    expect(
      trainsThatBeat([cheaperSame, cheaperSlower, fasterSame, yours], yours).map(
        (c) => c.journey.id,
      ),
    ).toEqual(["cheap", "fast"]);
    expect(beatNote(cheaperSame, yours)).toBe("$81 cheaper · same ride");
    expect(compareFocus(cheaperSame, 12800, yours)).toEqual({
      saveCents: 8100,
      beats: true,
      vsYours: "$81 cheaper · same ride",
    });
  });

  it("marks duplicate watches on the same trip", () => {
    const a = watch("a", "BOS", "NYP", 0);
    const b = watch("b", "BOS", "NYP", 400);
    const c = watch("c", "NYP", "BOS", 0);
    expect([...duplicateWatchIds([a, b, c])].sort()).toEqual(["a", "b"]);
    expect(duplicateWatchIds([a, c]).size).toBe(0);
  });

  it("writes a you-vs-this line and sorts watches", () => {
    const focused = {
      totalPartyPriceCents: 4700,
      journey: {
        originCode: "BOS",
        destinationCode: "NYP",
        searchedTravelDate: "2026-09-23",
        departureAt: "2026-09-23T09:20:00",
        serviceName: "Northeast Regional",
        trainNumber: "93",
        durationMinutes: 248,
      },
    } as RankedCandidate;
    const dearer = {
      totalPartyPriceCents: 12800,
      journey: {
        departureAt: "2026-09-23T06:10:00",
        serviceName: "Northeast Regional",
        trainNumber: "95",
        durationMinutes: 248,
      },
    } as RankedCandidate;
    const line = compareLine({
      originCode: "BOS",
      destinationCode: "NYP",
      desiredTravelDate: "2026-09-23",
      bookedCents: 12800,
      focused,
    });
    expect(line).toContain("You paid $128");
    expect(line).toContain("save $81");
    expect(line).toContain("Confirm on Amtrak");
    expect(pairNote(dearer, focused)).toContain("$81 cheaper");
    const soon = watch("soon", "BOS", "NYP", 100);
    const later = watch("later", "PHL", "WAS", 9000);
    later.desiredTravelDate = "2026-10-01";
    expect(sortWatches([later, soon], "soonest").map((item) => item.id)).toEqual(["soon", "later"]);
    expect(sortWatches([soon, later], "drops").map((item) => item.id)).toEqual(["later", "soon"]);
  });

  it("writes a window strip, fee ceiling, and a stay-or-switch verdict", () => {
    const cheap = {
      savingsCents: 8100,
      totalPartyPriceCents: 4700,
      journey: {
        id: "cheap",
        departureAt: "2026-09-23T06:10:00",
        serviceName: "Northeast Regional",
        trainNumber: "95",
        durationMinutes: 248,
      },
    } as RankedCandidate;
    const yours = {
      savingsCents: 0,
      totalPartyPriceCents: 12800,
      journey: {
        id: "yours",
        departureAt: "2026-09-23T09:20:00",
        serviceName: "Northeast Regional",
        trainNumber: "93",
        durationMinutes: 248,
      },
    } as RankedCandidate;
    expect(feeCeilingNote(8100)).toContain("under $81");
    expect(feeCeilingNote(0)).toBeNull();
    const strip = windowStrip({
      originCode: "BOS",
      destinationCode: "NYP",
      bookedCents: 12800,
      days: [
        { date: "2026-09-22", candidate: cheap },
        { date: "2026-09-23", candidate: null },
      ],
    });
    expect(strip).toContain("You paid $128");
    expect(strip).toContain("Northeast Regional 95");
    expect(strip).toContain("Confirm on Amtrak");
    expect(switchVerdict({ best: cheap, yours, feeCents: 0 }).kind).toBe("switch");
    expect(switchVerdict({ best: cheap, yours, feeCents: 9000 }).kind).toBe("keep");
    const slower = {
      ...cheap,
      journey: { ...cheap.journey, id: "slow", durationMinutes: 320 },
    } as RankedCandidate;
    expect(switchVerdict({ best: slower, yours, feeCents: 0 }).kind).toBe("look");
    const later = watch("later", "PHL", "WAS", 0);
    later.desiredTravelDate = "2026-10-01";
    expect(soonestWatch([later, watch("soon", "BOS", "NYP", 0)], "2026-09-23")?.id).toBe("soon");
  });
});
