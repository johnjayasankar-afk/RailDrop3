import { describe, expect, it } from "vitest";
import {
  CYCLE_SEARCH_BUDGET_MS,
  FUNCTION_CEILING_MS,
  hasTimeForAnotherSearch,
  searchDeadline,
} from "@/lib/domain/cycle-budget";

describe("searchDeadline", () => {
  it("leaves room to write the cycle down before the function is killed", () => {
    const started = new Date("2026-09-20T12:00:00.000Z");
    expect(searchDeadline(started)).toBe(started.getTime() + CYCLE_SEARCH_BUDGET_MS);
    expect(CYCLE_SEARCH_BUDGET_MS).toBeLessThan(FUNCTION_CEILING_MS);
  });
});

describe("hasTimeForAnotherSearch", () => {
  const deadline = 240_000;

  it("always attempts the first search", () => {
    // A cycle that refuses to try anything has learned nothing, and looks
    // identical to a provider outage.
    expect(hasTimeForAnotherSearch({ now: 239_000, deadline, observedMs: [] })).toBe(true);
  });

  it("continues while the slowest search so far still fits", () => {
    expect(hasTimeForAnotherSearch({ now: 100_000, deadline, observedMs: [30_000, 55_000] })).toBe(
      true,
    );
  });

  it("stops when the slowest search so far would overrun", () => {
    // Starting it would spend a credit, hold the only page, and still be killed.
    expect(hasTimeForAnotherSearch({ now: 200_000, deadline, observedMs: [30_000, 55_000] })).toBe(
      false,
    );
  });

  it("judges by the slowest observed search, not the average", () => {
    // 60s remaining, searches of 5s and 55s: the average would say yes twice
    // over, and the second one would be the 55s kind.
    const now = deadline - 60_000;
    expect(hasTimeForAnotherSearch({ now, deadline, observedMs: [5_000, 55_000] })).toBe(true);
    expect(
      hasTimeForAnotherSearch({ now: deadline - 50_000, deadline, observedMs: [5_000, 55_000] }),
    ).toBe(false);
  });

  it("stops once the deadline has passed", () => {
    expect(hasTimeForAnotherSearch({ now: deadline, deadline, observedMs: [1_000] })).toBe(false);
    expect(hasTimeForAnotherSearch({ now: deadline + 1, deadline, observedMs: [1_000] })).toBe(
      false,
    );
  });
});
