import { describe, expect, it } from "vitest";
import { collectEligibleFares, isFareEligible } from "@/lib/domain/eligibility";
import { changeRuleNote } from "@/lib/domain/board-moves";
import type { FareFamily, FareOption, JourneyOption } from "@/lib/domain/types";

/* Which fares reach the board, and what we are entitled to say about them.
 *
 * The rule that matters most here is about a fare family we were never told.
 * Wanderu — the default provider — reports no family at all, and the
 * normalizer used to fill the gap with FLEXIBLE. That single guess made the
 * board print "Flexible", made changeRuleNote say "usually easiest to change",
 * and made the "include cheaper restricted fares" checkbox do nothing, because
 * FLEXIBLE is not restricted.
 *
 * Amtrak's cheapest corridor fare is usually Saver: non-refundable and often
 * non-changeable. So the guess was not neutral — it was the least cautious
 * answer available, on the one attribute that decides whether switching is
 * possible at all.
 */

const rules = {
  includeRestrictedFares: false,
  includeThruway: false,
  travelClass: "COACH" as const,
  requireAvailable: true,
};

function fare(patch: Partial<FareOption> = {}): FareOption {
  return {
    id: "f1",
    fareFamily: "FLEXIBLE",
    fareFamilyRaw: null,
    travelClass: "COACH",
    travelClassRaw: null,
    availability: "AVAILABLE",
    observedPriceCents: 4_700,
    priceSemantics: "PER_TRAVELER",
    pricePerTravelerCents: 4_700,
    totalPartyPriceCents: 4_700,
    priceFailureReason: null,
    ...patch,
  } as FareOption;
}

function journey(patch: Partial<JourneyOption> = {}): JourneyOption {
  return {
    id: "j1",
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
    fares: [fare()],
    provider: { requestId: "r", source: "t", latencyMs: 1 },
    ...patch,
  } as unknown as JourneyOption;
}

describe("a fare family we were never told", () => {
  it("reaches the board rather than emptying it", () => {
    /* Dropping UNKNOWN here would hide every fare from the default provider —
       the board would be permanently empty and the product would be dead. */
    expect(isFareEligible(journey(), fare({ fareFamily: "UNKNOWN" }), rules)).toBe(true);
  });

  it("is not quietly promoted to flexible", () => {
    // The guess this file exists to prevent.
    const eligible = collectEligibleFares(
      [journey({ fares: [fare({ fareFamily: "UNKNOWN" })] })],
      rules,
    );
    expect(eligible[0]!.fare.fareFamily).toBe("UNKNOWN");
  });

  it("is never described as easy to change", () => {
    const note = changeRuleNote("UNKNOWN");
    expect(note).not.toMatch(/easiest to change|flexible/i);
    // And it warns in the direction the evidence actually points.
    expect(note).toMatch(/saver/i);
    expect(note).toMatch(/non-refundable|hard to change/i);
  });

  it("says plainly that the source did not tell us", () => {
    expect(changeRuleNote("UNKNOWN")).toMatch(/does not say which fare type/i);
  });
});

describe("families the provider does report", () => {
  it("still hides restricted fares when asked to", () => {
    // The filter has to keep working for sources that do report a family.
    for (const family of ["SAVER", "VALUE"] as FareFamily[]) {
      expect(isFareEligible(journey(), fare({ fareFamily: family }), rules), family).toBe(false);
    }
  });

  it("shows them when the traveler opts in", () => {
    const opted = { ...rules, includeRestrictedFares: true };
    for (const family of ["SAVER", "VALUE"] as FareFamily[]) {
      expect(isFareEligible(journey(), fare({ fareFamily: family }), opted), family).toBe(true);
    }
  });

  it("keeps flexible", () => {
    expect(isFareEligible(journey(), fare({ fareFamily: "FLEXIBLE" }), rules)).toBe(true);
  });

  it("describes each one without overstating it", () => {
    expect(changeRuleNote("FLEXIBLE")).toMatch(/easiest to change/i);
    expect(changeRuleNote("SAVER")).toMatch(/restrictive/i);
    expect(changeRuleNote("VALUE")).toMatch(/change fees/i);
    // None of them claim to know the fee itself.
    for (const family of ["FLEXIBLE", "VALUE", "SAVER", "UNKNOWN"] as FareFamily[]) {
      expect(changeRuleNote(family), family).not.toMatch(/\$\d/);
    }
  });
});

describe("the other rules still hold", () => {
  it("drops a fare with no price, rather than treating it as free", () => {
    expect(isFareEligible(journey(), fare({ totalPartyPriceCents: null }), rules)).toBe(false);
  });

  it("drops a price whose meaning is unknown", () => {
    expect(isFareEligible(journey(), fare({ priceSemantics: "UNKNOWN" }), rules)).toBe(false);
  });

  it("drops an unavailable fare when availability is required", () => {
    expect(isFareEligible(journey(), fare({ availability: "UNAVAILABLE" }), rules)).toBe(false);
    expect(
      isFareEligible(journey(), fare({ availability: "UNAVAILABLE" }), {
        ...rules,
        requireAvailable: false,
      }),
    ).toBe(true);
  });

  it("drops a bus unless thruway was asked for", () => {
    const bus = journey({ serviceType: "THRUWAY_OR_BUS" });
    expect(isFareEligible(bus, fare(), rules)).toBe(false);
    expect(isFareEligible(bus, fare(), { ...rules, includeThruway: true })).toBe(true);
  });

  it("treats an unknown travel class as coach, which is what it usually is", () => {
    expect(isFareEligible(journey(), fare({ travelClass: "UNKNOWN" }), rules)).toBe(true);
    expect(isFareEligible(journey(), fare({ travelClass: "SLEEPER" }), rules)).toBe(false);
  });
});
