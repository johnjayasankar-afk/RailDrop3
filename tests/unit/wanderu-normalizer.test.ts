import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeWanderuTrips } from "@/lib/providers/wanderu-normalizer";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/wanderu-trips.json", import.meta.url), "utf8"),
);

const metadata = {
  provider: "parse:amtrak-com-api",
  requestId: "req_w",
  retrievedAt: "2026-09-02T00:00:00Z",
  latencyMs: 12,
  creditsCharged: 0,
};

describe("Wanderu normalizer", () => {
  it("keeps Amtrak rail to the requested stations and drops buses and nearby stations", () => {
    const result = normalizeWanderuTrips(
      fixture,
      {
        originCode: "BOS",
        destinationCode: "NYP",
        travelDate: "2026-09-23",
        passengers: { adultCount: 1 },
      },
      metadata,
    );

    expect(result.map((journey) => journey.trainNumber).sort()).toEqual(["171", "2155"]);
    const regional = result.find((journey) => journey.trainNumber === "171");
    expect(regional?.serviceName).toBe("Northeast Regional");
    expect(regional?.fares[0]?.totalPartyPriceCents).toBe(3600);
    expect(regional?.fares[0]?.fareFamily).toBe("FLEXIBLE");
    expect(regional?.serviceType).toBe("DIRECT_RAIL");
    const acela = result.find((journey) => journey.trainNumber === "2155");
    expect(acela?.fares[0]?.travelClass).toBe("BUSINESS");
    expect(acela?.fares[0]?.totalPartyPriceCents).toBe(13300);
  });

  it("maps connection leg stations from Wanderu ids", () => {
    const connected = [
      {
        trip_id: "AMT,connect,93",
        carrier: "AMT",
        price: 55,
        transfers: 1,
        duration: 5.2,
        vehicle_types: ["train"],
        depart_id: "BOSSST",
        arrive_id: "WASUNI",
        depart_cityname: "Boston",
        arrive_cityname: "Washington",
        depart_state: "MA",
        arrive_state: "DC",
        itinerary_info: {
          itinerary: [
            {
              part_type: "travel",
              vehicle_type: "train",
              operator_name: "Northeast Regional",
              train_number: "93",
              depart_id: "BOSSST",
              arrive_id: "NYCPEN",
              depart_datetime_iso: "2026-09-23T09:20:00-04:00",
              arrive_datetime_iso: "2026-09-23T13:05:00-04:00",
            },
            {
              part_type: "travel",
              vehicle_type: "train",
              operator_name: "Northeast Regional",
              train_number: "125",
              depart_id: "NYCPEN",
              arrive_id: "WASUNI",
              depart_datetime_iso: "2026-09-23T13:40:00-04:00",
              arrive_datetime_iso: "2026-09-23T16:55:00-04:00",
            },
          ],
        },
      },
    ];
    const result = normalizeWanderuTrips(
      connected,
      {
        originCode: "BOS",
        destinationCode: "WAS",
        travelDate: "2026-09-23",
        passengers: { adultCount: 1 },
      },
      metadata,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.legs.map((leg) => `${leg.originCode}-${leg.destinationCode}`)).toEqual([
      "BOS-NYP",
      "NYP-WAS",
    ]);
  });

  it("can relax station matching when the exact Wanderu id is unknown", () => {
    const result = normalizeWanderuTrips(
      fixture,
      {
        originCode: "BOS",
        destinationCode: "NYP",
        travelDate: "2026-09-23",
        passengers: { adultCount: 1 },
      },
      metadata,
      { relaxStationMatch: true },
    );
    expect(result.some((journey) => journey.trainNumber === "99")).toBe(true);
  });
});
