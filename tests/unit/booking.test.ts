import { describe, expect, it } from "vitest";
import { AMTRAK_HOME, BookingLinkResolver, buildCopyText } from "@/lib/booking/booking-link-resolver";
import type { FareOption, JourneyOption } from "@/lib/domain/types";

const journey = {
  id: "j",
  searchedTravelDate: "2026-09-19",
  serviceName: "Northeast Regional",
  trainNumber: "179",
  serviceType: "DIRECT_RAIL",
  originCode: "BOS",
  destinationCode: "NYP",
  departureAt: "2026-09-19T07:05:00",
  arrivalAt: "2026-09-19T11:14:00",
  durationMinutes: 249,
  transferCount: 0,
  legs: [],
  fares: [],
  provider: {
    provider: "parse:amtrak-com-api",
    requestId: "1",
    retrievedAt: "2026-09-02T00:00:00Z",
    latencyMs: 1,
    creditsCharged: 2,
  },
} as JourneyOption;

const fare = {
  id: "f",
  fareFamily: "FLEXIBLE",
  fareFamilyRaw: "FLX",
  travelClass: "COACH",
  travelClassRaw: "Coach",
  availability: "AVAILABLE",
  observedPriceCents: 7400,
  priceSemantics: "PER_TRAVELER",
  pricePerTravelerCents: 7400,
  totalPartyPriceCents: 7400,
  priceFailureReason: null,
} as FareOption;

describe("BookingLinkResolver", () => {
  it("uses a provider URL when it is a real http(s) link", () => {
    const handoff = new BookingLinkResolver().resolve({
      journey,
      fare,
      providerBookingUrl: "https://www.amtrak.com/tickets/example",
    });
    expect(handoff.kind).toBe("exact_itinerary");
    expect(handoff.url).toBe("https://www.amtrak.com/tickets/example");
  });

  it("falls back to official Amtrak home without inventing query params", () => {
    const handoff = new BookingLinkResolver().resolve({ journey, fare });
    expect(handoff.kind).toBe("generic_fallback");
    expect(handoff.url).toBe(AMTRAK_HOME);
    expect(handoff.url).not.toContain("origin=");
    expect(buildCopyText(journey, fare)).toContain("BOS → NYP");
    expect(buildCopyText(journey, fare)).toContain("179");
  });
});
