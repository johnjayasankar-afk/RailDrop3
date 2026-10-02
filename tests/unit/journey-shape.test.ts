import { describe, expect, it } from "vitest";
import { journeyShape } from "@/lib/domain/journey-shape";
import type { JourneyLeg, RankedCandidate } from "@/lib/domain/types";

/* What the board was not saying about the trains on it.
 *
 * A $154 ten-hour connecting overnight sat directly above a $167 four-hour
 * nonstop, distinguished only by a duration the reader had to convert, while
 * the cost-per-hour column argued FOR the overnight — a figure measured per
 * hour aboard rewards being aboard longer. transferCount, legs[] and the two
 * timestamps were all in the data and on no screen.
 */

const leg = (
  departureAt: string,
  arrivalAt: string,
  originCode = "BOS",
  destinationCode = "NYP",
): JourneyLeg => ({ departureAt, arrivalAt, originCode, destinationCode }) as JourneyLeg;

function candidate(over: {
  departureAt?: string;
  arrivalAt?: string;
  transferCount?: number;
  legs?: JourneyLeg[];
  availability?: string;
}): RankedCandidate {
  return {
    journey: {
      departureAt: over.departureAt ?? "2026-10-09T08:00:00",
      arrivalAt: over.arrivalAt ?? "2026-10-09T12:00:00",
      transferCount: over.transferCount ?? 0,
      legs: over.legs ?? [],
    },
    fare: { availability: over.availability ?? "AVAILABLE" },
  } as unknown as RankedCandidate;
}

describe("the shape of a journey", () => {
  it("says nothing about a direct, same-day train", () => {
    const shape = journeyShape(candidate({}));
    expect(shape.flags).toEqual([]);
    expect(shape.unremarkable).toBe(true);
  });

  it("marks a train that lands on a different date", () => {
    const shape = journeyShape(
      candidate({ departureAt: "2026-10-09T21:30:00", arrivalAt: "2026-10-10T07:15:00" }),
    );
    expect(shape.flags.map((f) => f.label)).toContain("arrives next day");
    expect(shape.flags[0]!.tone).toBe("warn");
  });

  it("says how many changes, where, and how long between", () => {
    const changing = journeyShape(
      candidate({
        transferCount: 1,
        legs: [
          leg("2026-10-09T08:00:00", "2026-10-09T10:00:00", "BOS", "NHV"),
          leg("2026-10-09T10:12:00", "2026-10-09T12:00:00", "NHV", "NYP"),
        ],
      }),
    );
    expect(changing.flags.map((f) => f.label)).toEqual(["1 change at NHV · 12m to connect"]);
    /* Plain, not warn. A change is a fact about the journey; "warn" is for
       the two things that change what the trip IS. */
    expect(changing.flags[0]!.tone).toBe("plain");
  });

  it("still flags a journey whose legs do not account for its changes", () => {
    /* The repository's own connecting fixture: transfers 2, one leg. The old
       helper called it direct and the row showed nothing. */
    const partial = journeyShape(
      candidate({
        transferCount: 2,
        legs: [leg("2026-10-09T12:57:00", "2026-10-09T15:21:00", "BOS", "NWK")],
      }),
    );
    expect(partial.flags.map((f) => f.label)).toEqual(["2 changes, station not stated"]);
  });

  it("surfaces a fare the provider called limited, without inventing a count", () => {
    const shape = journeyShape(candidate({ availability: "LIMITED" }));
    expect(shape.flags.map((f) => f.label)).toEqual(["limited when we looked"]);
    // We were never told how many seats, so no number appears.
    expect(shape.flags[0]!.label).not.toMatch(/\d/);
  });

  it("stacks every true thing about one journey", () => {
    const shape = journeyShape(
      candidate({
        departureAt: "2026-10-09T21:30:00",
        arrivalAt: "2026-10-10T09:40:00",
        transferCount: 1,
        legs: [
          leg("2026-10-09T21:30:00", "2026-10-10T02:00:00", "BOS", "ALB"),
          leg("2026-10-10T02:10:00", "2026-10-10T09:40:00", "ALB", "CHI"),
        ],
        availability: "LIMITED",
      }),
    );
    expect(shape.flags.map((f) => f.label)).toEqual([
      "arrives next day",
      "1 change at ALB · 10m to connect",
      "limited when we looked",
    ]);
  });
});
