import { describe, expect, it } from "vitest";
import { normalizeWanderuTrips, type WanderuTrip } from "@/lib/providers/wanderu-normalizer";
import type { FareSearchRequest, ProviderMetadata } from "@/lib/domain/types";

/* A fare is from the station it is from.
 *
 * When a strict search returns nothing, the provider retries with
 * `relaxStationMatch: true`, which accepts a trip on city and state instead of
 * station id. Three Amtrak stations share "Boston, MA" in the id map —
 * BOS (South Station, BOSSST), BBY (Back Bay, BOSBBA) and BON (North Station,
 * BOSNST) — so the relaxed pass admits all three for a BOS request.
 *
 * And relaxation only ever changes the answer for a station we HAVE mapped:
 * `tripMatchesStation` falls through to city and state on the strict path too
 * when the requested code has no id list. So every journey the relaxed retry
 * adds is, by construction, one whose station id did not match the requested
 * one — a different station.
 *
 * The journey was then stamped `originCode: request.originCode`
 * unconditionally. A Back Bay departure was stored, ranked, emailed, exported
 * to the calendar and linked to Amtrak as a South Station departure, and
 * nothing downstream re-checks it — `grep` finds no comparison of a journey's
 * originCode against the watch's anywhere in src/lib/domain or
 * src/lib/orchestration. The handoff link would have sent someone to a search
 * that does not contain the fare they clicked.
 *
 * The Wanderu normalizer had no tests. tests/unit/normalizer.test.ts covers
 * the Parse one, which is a different file.
 */

const REQUEST: FareSearchRequest = {
  originCode: "BOS",
  destinationCode: "NYP",
  travelDate: "2026-10-09",
  passengers: { adultCount: 1 },
};

const META: ProviderMetadata = {
  provider: "wanderu:browser",
  requestId: "req-1",
  retrievedAt: "2026-09-28T12:00:00.000Z",
  latencyMs: 900,
  creditsCharged: 0,
};

/** One Amtrak train, departing `departId` and arriving `arriveId`. */
function trip(
  departId: string,
  arriveId: string,
  overrides: Partial<WanderuTrip> = {},
): WanderuTrip {
  return {
    trip_id: `${departId}-${arriveId}`,
    carrier: "AMT",
    price: 74,
    transfers: 0,
    duration: 4,
    vehicle_types: ["train"],
    depart_id: departId,
    arrive_id: arriveId,
    depart_cityname: "Boston",
    depart_state: "MA",
    arrive_cityname: "New York",
    arrive_state: "NY",
    depart_datetime: "2026-10-09T06:10:00",
    arrive_datetime: "2026-10-09T10:18:00",
    itinerary_info: {
      itinerary: [
        {
          part_type: "travel",
          vehicle_type: "train",
          operator_name: "Northeast Regional",
          train_number: "95",
          depart_id: departId,
          arrive_id: arriveId,
          depart_datetime_iso: "2026-10-09T06:10:00-04:00",
          arrive_datetime_iso: "2026-10-09T10:18:00-04:00",
        },
      ],
    },
    ...overrides,
  };
}

describe("the Wanderu normalizer labels a fare with the station it is from", () => {
  it("keeps the requested code on a strict match", () => {
    const [journey] = normalizeWanderuTrips([trip("BOSSST", "NYCPEN")], REQUEST, META);
    expect(journey).toBeDefined();
    expect(journey!.originCode).toBe("BOS");
    expect(journey!.destinationCode).toBe("NYP");
  });

  it("drops a different Boston station on a strict match", () => {
    // BOSBBA is Back Bay. Strict matching compares station ids, so it is out.
    expect(normalizeWanderuTrips([trip("BOSBBA", "NYCPEN")], REQUEST, META)).toHaveLength(0);
  });

  it("names Back Bay as Back Bay when the relaxed pass admits it", () => {
    const [journey] = normalizeWanderuTrips([trip("BOSBBA", "NYCPEN")], REQUEST, META, {
      relaxStationMatch: true,
    });
    expect(journey).toBeDefined();
    // The regression: this was "BOS", on the board, in the email, in the .ics
    // and in the Amtrak handoff link.
    expect(journey!.originCode).toBe("BBY");
    expect(journey!.destinationCode).toBe("NYP");
  });

  it("names North Station too, rather than folding it into South Station", () => {
    const [journey] = normalizeWanderuTrips([trip("BOSNST", "NYCPEN")], REQUEST, META, {
      relaxStationMatch: true,
    });
    expect(journey!.originCode).toBe("BON");
  });

  it("drops a relaxed trip whose station cannot be identified at all", () => {
    // Right city, unrecognisable id: we would have to guess which station,
    // and the guess would be published as fact.
    const anonymous = normalizeWanderuTrips([trip("XX99ZZ", "NYCPEN")], REQUEST, META, {
      relaxStationMatch: true,
    });
    expect(anonymous).toHaveLength(0);
  });

  it("carries the resolved station onto the legs as well", () => {
    const [journey] = normalizeWanderuTrips([trip("BOSBBA", "NYCPEN")], REQUEST, META, {
      relaxStationMatch: true,
    });
    expect(journey!.legs[0]!.originCode).toBe("BBY");
  });

  it("still refuses a trip that is not Amtrak, relaxed or not", () => {
    const bus = trip("BOSBBA", "NYCPEN", {
      carrier: "GLI",
      vehicle_types: ["bus"],
      itinerary_info: { itinerary: [{ part_type: "travel", vehicle_type: "bus" }] },
    });
    expect(normalizeWanderuTrips([bus], REQUEST, META, { relaxStationMatch: true })).toHaveLength(
      0,
    );
  });
});
