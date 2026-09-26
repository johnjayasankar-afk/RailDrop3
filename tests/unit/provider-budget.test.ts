import { describe, expect, it } from "vitest";
import { budgetDecision, budgetPressure, monthStart } from "@/lib/domain/provider-budget";

const base = { searchesToday: 0, searchesThisMonth: 0, dailyCap: 100, monthlyCap: 1000 };

describe("budgetDecision", () => {
  it("allows a search with room under both ceilings", () => {
    expect(budgetDecision(base)).toEqual({ allow: true, scope: "ok", reason: null });
  });

  it("stops at the daily ceiling", () => {
    const d = budgetDecision({ ...base, searchesToday: 100 });
    expect(d.allow).toBe(false);
    expect(d.scope).toBe("daily");
    // The reason is shown to a person, so it has to say when it resumes.
    expect(d.reason).toMatch(/tomorrow/);
  });

  it("stops at the monthly ceiling", () => {
    const d = budgetDecision({ ...base, searchesThisMonth: 1000 });
    expect(d.allow).toBe(false);
    expect(d.scope).toBe("monthly");
    expect(d.reason).toMatch(/next month/);
  });

  it("reports the monthly ceiling first when both are spent", () => {
    // Monthly is the worse news: "tomorrow" would be wrong.
    const d = budgetDecision({ ...base, searchesToday: 999, searchesThisMonth: 1000 });
    expect(d.scope).toBe("monthly");
  });

  it("treats a zero or negative cap as no ceiling", () => {
    // Local and test runs have no budget, and must not be silently paused.
    expect(budgetDecision({ ...base, dailyCap: 0, searchesToday: 10_000 }).allow).toBe(true);
    expect(budgetDecision({ ...base, monthlyCap: -1, searchesThisMonth: 10_000 }).allow).toBe(true);
  });

  it("stops exactly at the cap, not one past it", () => {
    expect(budgetDecision({ ...base, searchesToday: 99 }).allow).toBe(true);
    expect(budgetDecision({ ...base, searchesToday: 100 }).allow).toBe(false);
  });
});

describe("budgetPressure", () => {
  it("reports no fraction when no ceiling applies", () => {
    const p = budgetPressure({ ...base, dailyCap: 0, monthlyCap: 0 });
    expect(p.dailyUsedFraction).toBeNull();
    expect(p.monthlyUsedFraction).toBeNull();
    expect(p.nearingLimit).toBe(false);
  });

  it("flags the approach before the cliff", () => {
    expect(budgetPressure({ ...base, searchesToday: 79 }).nearingLimit).toBe(false);
    expect(budgetPressure({ ...base, searchesToday: 80 }).nearingLimit).toBe(true);
  });

  it("never reports more than fully used", () => {
    expect(budgetPressure({ ...base, searchesToday: 500 }).dailyUsedFraction).toBe(1);
  });

  it("takes the worse of the two dimensions", () => {
    expect(budgetPressure({ ...base, searchesThisMonth: 900 }).nearingLimit).toBe(true);
  });
});

describe("monthStart", () => {
  it("gives the first of the month", () => {
    expect(monthStart("2026-09-26")).toBe("2026-09-01");
    expect(monthStart("2026-01-01")).toBe("2026-01-01");
  });
});
