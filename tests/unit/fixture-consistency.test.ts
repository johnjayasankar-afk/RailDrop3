import { describe, expect, it } from "vitest";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import { checkFare } from "@/lib/domain/fare-sanity";

/* The fixtures must be data a real provider could have returned.
 * fare-sanity found three inconsistencies in them; this stops a fourth. */
describe("the fixtures are internally consistent", () => {
  it("passes every plausibility check, on every day the fixture varies by", async () => {
    const provider = new FixtureFareProvider();
    const problems: string[] = [];
    for (const travelDate of ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]) {
      const result = await provider.searchTrips({
        originCode: "BOS",
        destinationCode: "NYP",
        travelDate,
        passengers: { adultCount: 1 } as never,
      });
      for (const journey of result.journeys) {
        for (const fare of journey.fares) {
          for (const rejection of checkFare(journey, fare, {
            originCode: "BOS",
            destinationCode: "NYP",
            travelDate,
            passengerCount: 1,
          })) {
            problems.push(`${travelDate} ${journey.id}: ${rejection.code} — ${rejection.detail}`);
          }
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
