import { describe, expect, it } from "vitest";
import {
  IN_FLIGHT_TTL_MS,
  MAX_WAIT_FOR_PEER_MS,
  SEARCH_FRESHNESS_MS,
  planSearch,
  type SearchRowLike,
} from "@/lib/domain/search-dedup";

const now = new Date("2026-09-26T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const row = (patch: Partial<SearchRowLike> = {}): SearchRowLike => ({
  id: "req-1",
  status: "SUCCESS",
  createdAt: ago(1000),
  ...patch,
});

describe("planSearch", () => {
  it("searches when nothing has been tried", () => {
    expect(planSearch({ newest: null, now, waitedMs: 0 })).toEqual({ action: "search" });
  });

  it("reuses a fresh completed search", () => {
    expect(planSearch({ newest: row(), now, waitedMs: 0 })).toEqual({
      action: "reuse",
      requestId: "req-1",
    });
  });

  it("reuses right up to the freshness edge, and not past it", () => {
    expect(
      planSearch({ newest: row({ createdAt: ago(SEARCH_FRESHNESS_MS) }), now, waitedMs: 0 }),
    ).toEqual({ action: "reuse", requestId: "req-1" });
    expect(
      planSearch({ newest: row({ createdAt: ago(SEARCH_FRESHNESS_MS + 1) }), now, waitedMs: 0 }),
    ).toEqual({ action: "search" });
  });

  it("never reuses a failure — re-running it is the whole point", () => {
    // A PROVIDER_ERROR row must not be served as a result. Doing so would
    // render an outage as "no cheaper fare", which this product does not do.
    expect(planSearch({ newest: row({ status: "PROVIDER_ERROR" }), now, waitedMs: 0 })).toEqual({
      action: "search",
    });
  });

  it("waits for a peer that is mid-search rather than duplicating the browser run", () => {
    const plan = planSearch({ newest: row({ status: "IN_FLIGHT" }), now, waitedMs: 0 });
    expect(plan.action).toBe("wait");
    if (plan.action === "wait") expect(plan.msRemaining).toBe(MAX_WAIT_FOR_PEER_MS);
  });

  it("counts down the wait budget", () => {
    const plan = planSearch({ newest: row({ status: "IN_FLIGHT" }), now, waitedMs: 10_000 });
    expect(plan).toEqual({ action: "wait", msRemaining: MAX_WAIT_FOR_PEER_MS - 10_000 });
  });

  it("stops waiting and does the work itself once the budget is spent", () => {
    // Waiting forever would trade a duplicate browser run for a missed check,
    // which is the worse of the two.
    expect(
      planSearch({ newest: row({ status: "IN_FLIGHT" }), now, waitedMs: MAX_WAIT_FOR_PEER_MS }),
    ).toEqual({ action: "search" });
  });

  it("treats a stale in-flight marker as abandoned", () => {
    // The worker holding it died. A duplicate run costs money; never searching
    // costs the traveler their alert.
    expect(
      planSearch({
        newest: row({ status: "IN_FLIGHT", createdAt: ago(IN_FLIGHT_TTL_MS) }),
        now,
        waitedMs: 0,
      }),
    ).toEqual({ action: "search" });
  });

  it("still waits on an in-flight marker that is merely slow", () => {
    expect(
      planSearch({
        newest: row({ status: "IN_FLIGHT", createdAt: ago(IN_FLIGHT_TTL_MS - 5_000) }),
        now,
        waitedMs: 0,
      }).action,
    ).toBe("wait");
  });

  it("searches rather than throwing on an unreadable timestamp", () => {
    expect(planSearch({ newest: row({ createdAt: "not a date" }), now, waitedMs: 0 })).toEqual({
      action: "search",
    });
  });

  it("honours caller-supplied windows", () => {
    expect(
      planSearch({ newest: row({ createdAt: ago(5_000) }), now, waitedMs: 0, freshnessMs: 1_000 }),
    ).toEqual({ action: "search" });
  });
});
