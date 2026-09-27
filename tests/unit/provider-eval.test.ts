import { describe, expect, it } from "vitest";
import {
  compareRuns,
  gradeSummary,
  scoreRun,
  summarize,
  type ProviderRun,
  type RunScore,
} from "@/lib/domain/provider-eval";
import type { FareOption, JourneyOption } from "@/lib/domain/types";
import type { SanityContext } from "@/lib/domain/fare-sanity";

/* Judging a provider.
 *
 * Every accuracy check in this codebase before now was a check on our own
 * arithmetic. This is the first one that asks whether the provider told us the
 * truth — and it is careful about what it can actually claim. We cannot know
 * Amtrak's real price without buying a ticket, so nothing here asserts ground
 * truth. It measures agreement, and agreement's useful direction is negative:
 * two sources agreeing proves little, two sources forty per cent apart proves
 * one of them is wrong.
 */

const context: SanityContext = {
  originCode: "BOS",
  destinationCode: "NYP",
  travelDate: "2026-10-09",
  passengerCount: 1,
};

function fare(cents: number | null, patch: Partial<FareOption> = {}): FareOption {
  return {
    id: `f${cents}`,
    fareFamily: "UNKNOWN",
    fareFamilyRaw: null,
    travelClass: "COACH",
    travelClassRaw: null,
    availability: "AVAILABLE",
    observedPriceCents: cents,
    priceSemantics: "PER_TRAVELER",
    pricePerTravelerCents: cents,
    totalPartyPriceCents: cents,
    priceFailureReason: null,
    ...patch,
  } as FareOption;
}

function journey(trainNumber: string, fares: FareOption[]): JourneyOption {
  return {
    id: `j${trainNumber}`,
    searchedTravelDate: "2026-10-09",
    serviceName: "Northeast Regional",
    trainNumber,
    serviceType: "DIRECT_RAIL",
    originCode: "BOS",
    destinationCode: "NYP",
    departureAt: "2026-10-09T11:05:00.000Z",
    arrivalAt: "2026-10-09T15:14:00.000Z",
    durationMinutes: 249,
    transferCount: 0,
    legs: [],
    fares,
    provider: { requestId: "r", source: "t", latencyMs: 1 },
  } as unknown as JourneyOption;
}

function run(patch: Partial<ProviderRun> = {}): ProviderRun {
  return {
    provider: "wanderu",
    travelDate: "2026-10-09",
    ok: true,
    latencyMs: 5_000,
    journeys: [journey("179", [fare(4_700)]), journey("93", [fare(9_900)])],
    ...patch,
  };
}

describe("scoring one search", () => {
  it("counts what came back and what was believable", () => {
    const score = scoreRun(run(), context);
    expect(score.offered).toBe(2);
    expect(score.believable).toBe(2);
    expect(score.cheapestCents).toBe(4_700);
    expect(score.trains).toBe(2);
  });

  it("does not let an implausible fare set the floor", () => {
    /* The reason scoring runs fares through fare-sanity at all: a $0.42
       misparse would otherwise become this provider's headline accuracy win. */
    const score = scoreRun(run({ journeys: [journey("179", [fare(42), fare(4_700)])] }), context);
    expect(score.cheapestCents).toBe(4_700);
    expect(score.believable).toBe(1);
    expect(score.rejected[0]?.code).toBe("price_too_low");
  });

  it("names what the provider gets wrong, worst first", () => {
    const score = scoreRun(
      run({
        journeys: [
          journey("179", [fare(1), fare(2)]),
          journey("93", [fare(4_700, { pricePerTravelerCents: 9_400 })]),
        ],
      }),
      context,
    );
    expect(score.rejected[0]).toEqual({ code: "price_too_low", count: 2 });
    expect(score.rejected.map((r) => r.code)).toContain("party_total_mismatch");
  });

  it("reports a failed search as failed rather than as empty", () => {
    // "Found nothing" and "could not look" are different provider problems.
    const score = scoreRun(run({ ok: false, journeys: [], error: "timeout" }), context);
    expect(score.ok).toBe(false);
    expect(score.cheapestCents).toBeNull();
  });

  it("divides by the party, so a family does not look like an expensive route", () => {
    const score = scoreRun(
      run({ journeys: [journey("179", [fare(18_800, { pricePerTravelerCents: 4_700 })])] }),
      { ...context, passengerCount: 4 },
    );
    expect(score.cheapestCents).toBe(4_700);
  });
});

describe("whether two providers agree", () => {
  const base: RunScore = {
    provider: "a",
    travelDate: "2026-10-09",
    ok: true,
    latencyMs: 1_000,
    offered: 5,
    believable: 5,
    rejected: [],
    cheapestCents: 5_000,
    trains: 5,
  };

  it("calls a match a match", () => {
    expect(compareRuns(base, { ...base, provider: "b", cheapestCents: 5_050 }).verdict).toBe(
      "agree",
    );
  });

  it("calls a small gap close, and guesses why", () => {
    const agreement = compareRuns(base, { ...base, provider: "b", cheapestCents: 5_400 });
    expect(agreement.verdict).toBe("close");
    expect(agreement.note).toMatch(/fee|fare bucket/i);
  });

  it("calls a large gap what it is, and refuses to split the difference", () => {
    /* The useful direction. Two sources agreeing proves little; two sources
       forty per cent apart proves one is wrong, and averaging them would
       manufacture a third number that neither observed. */
    const agreement = compareRuns(base, { ...base, provider: "b", cheapestCents: 9_000 });
    expect(agreement.verdict).toBe("diverge");
    expect(agreement.note).toMatch(/at least one of these is wrong/i);
    expect(agreement.note).toMatch(/do not average/i);
  });

  it("measures the gap against the cheaper price, not the mean", () => {
    // A $40 gap on a $50 fare is a different fact from $40 on a $400 one.
    const small = compareRuns(base, { ...base, cheapestCents: 9_000 }).gap!;
    const large = compareRuns(
      { ...base, cheapestCents: 40_000 },
      { ...base, cheapestCents: 44_000 },
    ).gap!;
    expect(small).toBeGreaterThan(large);
  });

  it("says incomparable rather than inventing a verdict", () => {
    expect(compareRuns(base, { ...base, ok: false }).verdict).toBe("incomparable");
    expect(compareRuns(base, { ...base, cheapestCents: null }).verdict).toBe("incomparable");
    expect(compareRuns(base, { ...base, ok: false }).gap).toBeNull();
  });

  it("is symmetric", () => {
    const other = { ...base, provider: "b", cheapestCents: 9_000 };
    expect(compareRuns(base, other).gap).toBeCloseTo(compareRuns(other, base).gap!, 9);
  });
});

describe("summarising a run of searches", () => {
  const good: RunScore[] = Array.from({ length: 10 }, (_, index) => ({
    provider: "wanderu",
    travelDate: `2026-10-${9 + index}`,
    ok: true,
    latencyMs: 4_000 + index * 200,
    offered: 6,
    believable: 6,
    rejected: [],
    cheapestCents: 5_000,
    trains: 6,
  }));

  it("reports the shape of the latency, not just the mean", () => {
    // A mean hides the one search in twenty that takes a minute, and that is
    // the one that blows the function timeout.
    const summary = summarize(good);
    expect(summary.p50LatencyMs).toBeLessThan(summary.p95LatencyMs);
  });

  it("passes a healthy provider", () => {
    expect(gradeSummary(summarize(good))).toEqual([]);
  });

  it("fails one that often returns nothing", () => {
    const flaky = good.map((score, index) => (index < 4 ? { ...score, ok: false } : score));
    expect(gradeSummary(summarize(flaky)).join(" ")).toMatch(/usable fare/i);
  });

  it("fails one whose parser has drifted", () => {
    /* The signal that the page changed under us. A provider can be fast and
       reliable and still be reading the wrong number off the screen. */
    const drifting = good.map((score) => ({
      ...score,
      believable: 1,
      rejected: [{ code: "price_too_low" as const, count: 5 }],
    }));
    expect(gradeSummary(summarize(drifting)).join(" ")).toMatch(/plausibility check/i);
  });

  it("fails one too slow to finish a cycle", () => {
    const slow = good.map((score) => ({ ...score, latencyMs: 60_000 }));
    expect(gradeSummary(summarize(slow)).join(" ")).toMatch(/p95 latency/i);
  });

  it("fails one that finds the corridor but not its trains", () => {
    const thin = good.map((score) => ({ ...score, trains: 1, believable: 1 }));
    expect(gradeSummary(summarize(thin)).join(" ")).toMatch(/trains per search/i);
  });

  it("says so when nothing was measured, rather than passing", () => {
    expect(gradeSummary(summarize([]))).toEqual(["No runs — nothing was measured."]);
  });

  it("returns problems as sentences, not a score", () => {
    // A number invites arguing about the number; a list invites fixing it.
    for (const problem of gradeSummary(summarize(good.map((s) => ({ ...s, ok: false }))))) {
      expect(problem.length).toBeGreaterThan(20);
      expect(problem).toMatch(/\(want|—/);
    }
  });
});
