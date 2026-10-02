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

const leg = (departureAt: string, arrivalAt: string): JourneyLeg =>
  ({ departureAt, arrivalAt }) as JourneyLeg;

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

  it("tells a tight connection from a long layover", () => {
    const tight = journeyShape(
      candidate({
        transferCount: 1,
        legs: [
          leg("2026-10-09T08:00:00", "2026-10-09T10:00:00"),
          leg("2026-10-09T10:12:00", "2026-10-09T12:00:00"),
        ],
      }),
    );
    expect(tight.flags.map((f) => f.label)).toEqual(["12m tight connection"]);
    expect(tight.flags[0]!.tone).toBe("warn");

    const long = journeyShape(
      candidate({
        transferCount: 1,
        legs: [
          leg("2026-10-09T08:00:00", "2026-10-09T10:00:00"),
          leg("2026-10-09T12:00:00", "2026-10-09T14:00:00"),
        ],
      }),
    );
    expect(long.flags.map((f) => f.label)).toEqual(["120m layover"]);
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
          leg("2026-10-09T21:30:00", "2026-10-10T02:00:00"),
          leg("2026-10-10T02:10:00", "2026-10-10T09:40:00"),
        ],
        availability: "LIMITED",
      }),
    );
    expect(shape.flags.map((f) => f.label)).toEqual([
      "arrives next day",
      "10m tight connection",
      "limited when we looked",
    ]);
  });
});
