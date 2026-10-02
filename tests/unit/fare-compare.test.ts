import { describe, expect, it } from "vitest";
import { compareFares } from "@/lib/domain/fare-compare";
import type { RankedCandidate } from "@/lib/domain/types";

/* Two trains, and only what differs. The sign convention lives in one place
 * because a flipped sign does not degrade gracefully — it prints a sentence
 * that is false. */

const train = (over: {
  name?: string;
  number?: string;
  date?: string;
  price: number;
  minutes?: number | null;
  transfers?: number;
}): RankedCandidate =>
  ({
    journey: {
      searchedTravelDate: over.date ?? "2026-10-09",
      serviceName: over.name ?? "Northeast Regional",
      trainNumber: over.number ?? "95",
      durationMinutes: over.minutes === undefined ? 240 : over.minutes,
      transferCount: over.transfers ?? 0,
      departureAt: "2026-10-09T08:00:00",
      arrivalAt: "2026-10-09T12:00:00",
    },
    fare: {},
    totalPartyPriceCents: over.price,
  }) as unknown as RankedCandidate;

describe("two trains, and only what differs", () => {
  it("orients every difference from the first to the second", () => {
    const cheapSlow = train({ number: "95", price: 9100, minutes: 260 });
    const dearFast = train({ number: "2155", price: 14_100, minutes: 180 });

    expect(compareFares(cheapSlow, dearFast).clauses).toEqual(["$50 more", "1h 20m faster"]);
    // And the other way round, the sentence has to invert exactly.
    expect(compareFares(dearFast, cheapSlow).clauses).toEqual(["$50 less", "1h 20m longer"]);
  });

  it("says 'same price' rather than '$0 more'", () => {
    const a = train({ number: "95", price: 9100, minutes: 240 });
    const b = train({ number: "93", price: 9100, minutes: 240 });
    expect(compareFares(a, b).clauses).toEqual(["same price"]);
  });

  it("leads with the days when they are not the same trip", () => {
    /* Position in a dot-separated run is not disclosure that the reader is
       comparing two trips rather than two trains. */
    const tue = train({ date: "2026-10-13", price: 9100 });
    const fri = train({ date: "2026-10-16", price: 14_100 });
    const out = compareFares(tue, fri);
    expect(out.differentDays).toBe("Different days — Oct 13 against Oct 16");
    expect(
      compareFares(tue, train({ date: "2026-10-13", price: 14_100 })).differentDays,
    ).toBeNull();
  });

  it("drops the time clause when either duration is unknown", () => {
    // Matching the row's own "duration unknown" rather than inventing a zero.
    const known = train({ price: 9100, minutes: 240 });
    const unknown = train({ price: 14_100, minutes: null });
    expect(compareFares(known, unknown).clauses).toEqual(["$50 more"]);
    expect(compareFares(unknown, known).clauses).toEqual(["$50 less"]);
  });

  it("counts changes in both directions", () => {
    const direct = train({ price: 9100, transfers: 0 });
    const twice = train({ price: 9100, transfers: 2 });
    expect(compareFares(direct, twice).clauses).toContain("2 changes more");
    expect(compareFares(twice, direct).clauses).toContain("2 changes fewer");
    expect(compareFares(direct, train({ price: 9100, transfers: 1 })).clauses).toContain(
      "1 change more",
    );
  });

  it("never names a winner", () => {
    /* No "better value", no recommendation — which train is better depends
       on things we were never told. */
    const out = compareFares(
      train({ price: 9100, minutes: 260 }),
      train({ price: 14_100, minutes: 180 }),
    );
    const text = [out.differentDays, ...out.clauses].join(" ");
    expect(text).not.toMatch(/better|best|worse|worth|recommend|value|should/i);
    // And no per-hour rate: price and time already contain it.
    expect(text).not.toMatch(/\/hr|per hour/i);
  });
});
