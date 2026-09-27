import { describe, expect, it } from "vitest";
import { assessEmptyDates, suspectEmptyDates, type DateOutcome } from "@/lib/domain/empty-result";

/* Found by the provider eval, not by reading the code.
 *
 * PHL→NYP on 2026-10-22 returns zero trains, reproducibly, while 2026-10-23 on
 * the same corridor returns thirty-three. Philadelphia to New York runs dozens
 * of weekday trains. Zero is not inventory, it is a failed read — and the board
 * was telling the traveler "No trains are listed... that is what the corridor
 * is showing, not a problem at our end."
 */

const ok = (travelDate: string, journeyCount: number): DateOutcome => ({
  travelDate,
  journeyCount,
  ok: true,
});

describe("an empty date beside busy ones", () => {
  const window = [ok("2026-10-21", 33), ok("2026-10-22", 0), ok("2026-10-23", 31)];

  it("is not believed", () => {
    const [assessment] = assessEmptyDates(window);
    expect(assessment?.travelDate).toBe("2026-10-22");
    expect(assessment?.verdict).toBe("suspect");
  });

  it("says why, in terms a person can check", () => {
    const [assessment] = assessEmptyDates(window);
    expect(assessment?.reason).toContain("up to 33");
    expect(assessment?.reason).toMatch(/failed read rather than an empty timetable/i);
  });

  it("does not assess the dates that found trains", () => {
    expect(assessEmptyDates(window)).toHaveLength(1);
  });
});

describe("when there is no evidence either way", () => {
  it("believes a lone empty date", () => {
    // Flexibility zero: one date, no neighbours, nothing to compare against.
    expect(assessEmptyDates([ok("2026-10-22", 0)])[0]?.verdict).toBe("no-evidence");
  });

  it("believes a window that is empty throughout", () => {
    /* Could genuinely be two stations with no service between them. Calling it
       a failed read would be just as unfounded as calling it empty. */
    const verdicts = assessEmptyDates([
      ok("2026-10-21", 0),
      ok("2026-10-22", 0),
      ok("2026-10-23", 0),
    ]);
    expect(verdicts.every((assessment) => assessment.verdict === "no-evidence")).toBe(true);
  });

  it("does not distrust a zero next to a corridor with one train a day", () => {
    /* A route with a single daily service, where the neighbour caught it and
       this date genuinely has none, must not be failed. */
    const verdicts = assessEmptyDates([ok("2026-10-21", 1), ok("2026-10-22", 0)]);
    expect(verdicts[0]?.verdict).toBe("no-evidence");
  });

  it("distrusts it once a real timetable is in evidence", () => {
    const verdicts = assessEmptyDates([ok("2026-10-21", 3), ok("2026-10-22", 0)]);
    expect(verdicts[0]?.verdict).toBe("suspect");
  });
});

describe("failed searches are not evidence", () => {
  it("ignores a date the provider could not answer", () => {
    // A timeout tells us nothing about whether trains run that day.
    const verdicts = assessEmptyDates([
      { travelDate: "2026-10-21", journeyCount: 0, ok: false },
      ok("2026-10-22", 0),
    ]);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.verdict).toBe("no-evidence");
  });

  it("does not let a failure count as a busy neighbour", () => {
    const verdicts = assessEmptyDates([
      { travelDate: "2026-10-21", journeyCount: 40, ok: false },
      ok("2026-10-22", 0),
    ]);
    expect(verdicts[0]?.verdict).toBe("no-evidence");
  });
});

describe("suspectEmptyDates", () => {
  it("returns only the dates the cycle should refuse to call empty", () => {
    const suspect = suspectEmptyDates([
      ok("2026-10-21", 33),
      ok("2026-10-22", 0),
      ok("2026-10-23", 12),
    ]);
    expect([...suspect.keys()]).toEqual(["2026-10-22"]);
    expect(suspect.get("2026-10-22")).toContain("failed read");
  });

  it("is empty when everything is believable", () => {
    expect(suspectEmptyDates([ok("2026-10-21", 33), ok("2026-10-22", 12)]).size).toBe(0);
    expect(suspectEmptyDates([]).size).toBe(0);
  });

  it("reproduces the case that prompted it", () => {
    // The real eval output: two zero reads and a neighbour with 33.
    const suspect = suspectEmptyDates([ok("2026-10-22", 0), ok("2026-10-23", 33)]);
    expect(suspect.has("2026-10-22")).toBe(true);
  });
});
