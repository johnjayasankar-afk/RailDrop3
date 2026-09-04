import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeParseSearch } from "@/lib/providers/parse-normalizer";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/parse-search-trains.json", import.meta.url), "utf8"),
);

describe("Parse normalizer", () => {
  it("normalizes documented search_trains accommodations into domain objects", () => {
    const result = normalizeParseSearch(
      fixture,
      {
        originCode: "BOS",
        destinationCode: "NYP",
        travelDate: "2026-09-19",
        passengers: { adultCount: 1 },
      },
      {
        provider: "parse:amtrak-com-api",
        requestId: "req_1",
        retrievedAt: "2026-09-02T00:00:00Z",
        latencyMs: 12,
        creditsCharged: 2,
      },
    );

    expect(result.journeys).toHaveLength(3);
    const regional = result.journeys[0];
    expect(regional.trainNumber).toBe("179");
    expect(regional.serviceName).toBe("Northeast Regional");
    expect(regional.serviceType).toBe("DIRECT_RAIL");
    expect(regional.fares[0]?.fareFamily).toBe("FLEXIBLE");
    expect(regional.fares[0]?.totalPartyPriceCents).toBe(7400);
    expect(regional.fares[0]?.priceSemantics).toBe("PER_TRAVELER");
    expect(result.journeys[2]?.serviceType).toBe("THRUWAY_OR_BUS");
  });

  it("fails visibly when a fare amount cannot be extracted", () => {
    const result = normalizeParseSearch(
      {
        journeySolutionOption: {
          journeyLegs: [
            {
              journeyLegOptions: [
                {
                  origin: { code: "BOS", schedule: { departureDateTime: "2026-09-19T07:05:00" } },
                  destination: {
                    code: "NYP",
                    schedule: { arrivalDateTime: "2026-09-19T11:14:00" },
                  },
                  travelLegs: [{ travelService: { name: "Northeast Regional", number: "179" } }],
                  reservableAccommodations: [{ fareFamily: "FLX", travelClass: "Coach" }],
                },
              ],
            },
          ],
        },
      },
      {
        originCode: "BOS",
        destinationCode: "NYP",
        travelDate: "2026-09-19",
        passengers: { adultCount: 1 },
      },
      {
        provider: "parse:amtrak-com-api",
        requestId: "req_2",
        retrievedAt: "2026-09-02T00:00:00Z",
        latencyMs: 1,
        creditsCharged: 2,
      },
    );
    expect(result.journeys[0]?.fares[0]?.priceSemantics).toBe("UNKNOWN");
    expect(result.journeys[0]?.fares[0]?.priceFailureReason).toContain("Could not extract");
  });
});
