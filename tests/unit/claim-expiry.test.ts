import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/db/memory-store";
import { IN_FLIGHT_TTL_MS, planSearch } from "@/lib/domain/search-dedup";
import type { ProviderRequestRecord } from "@/lib/db/models";

/* A claim and the planner must agree on when a claim is dead.
 *
 * They did not, and the disagreement was a permanent, per-corridor deadlock.
 *
 * planSearch treats an IN_FLIGHT marker older than IN_FLIGHT_TTL_MS as
 * abandoned — "the worker that claimed it is not coming back" — and returns
 * `search`. markSearchInFlight then refused the claim, because it asked only
 * whether an in-flight row EXISTED, with no notion of age. So the planner
 * said go, the store said no, and check-cycle's loop re-planned until
 * MAX_TURNS tripped and logged `search.plan_did_not_settle`, which is then
 * recorded as PROVIDER_ERROR and reads to everyone downstream as a provider
 * outage.
 *
 * Any worker killed between claiming and finishing strands a marker, and
 * that search key never searches again. Found on 2026-09-29 with three rows
 * stranded at 17:09:28 in the local store by a dev server killed mid-scan:
 * every BOS→NYP scan afterwards failed, for hours, while the provider was
 * fine. On Vercel a killed invocation — a timeout, a redeploy, an OOM — is
 * ordinary, so the same fault strands corridors in production and survives
 * every subsequent deploy, because the row is in the database.
 */

function row(searchKey: string, ageMs: number): ProviderRequestRecord {
  return {
    id: `req-${searchKey}-${ageMs}-${Math.random().toString(36).slice(2)}`,
    searchKey,
    cycleId: "c1",
    originCode: "BOS",
    destinationCode: "NYP",
    travelDate: "2026-10-09",
    passengerCount: 1,
    status: "IN_FLIGHT",
    creditsConsumed: 0,
    latencyMs: 0,
    errorMessage: null,
    reusedFromId: null,
    cheapestPriceCents: null,
    createdAt: new Date(Date.now() - ageMs).toISOString(),
  } as ProviderRequestRecord;
}

const KEY = "parse:amtrak-com-api:BOS:NYP:2026-10-09:A1";

describe("an in-flight claim expires", () => {
  it("refuses a second claim while the first is still live", async () => {
    const repo = new MemoryRepository();
    expect(await repo.markSearchInFlight(row(KEY, 1_000))).toBe(true);
    // A real peer is working on it. Waiting is correct.
    expect(await repo.markSearchInFlight(row(KEY, 0))).toBe(false);
  });

  it("grants the claim once the marker is older than the TTL", async () => {
    const repo = new MemoryRepository();
    const stranded = row(KEY, IN_FLIGHT_TTL_MS + 5_000);
    repo.providerRequests.set(stranded.id, stranded);

    // This is the assertion the bug failed: the planner says go...
    expect(planSearch({ newest: stranded, now: new Date(), waitedMs: 0 }).action).toBe("search");
    // ...so the store must let it.
    expect(await repo.markSearchInFlight(row(KEY, 0))).toBe(true);
  });

  it("records the abandoned claim as a failure rather than deleting it", async () => {
    const repo = new MemoryRepository();
    const stranded = row(KEY, IN_FLIGHT_TTL_MS + 5_000);
    repo.providerRequests.set(stranded.id, stranded);
    await repo.markSearchInFlight(row(KEY, 0));

    const after = repo.providerRequests.get(stranded.id);
    // A search really was started and really did not come back. Deleting the
    // row would make the record claim nobody ever looked.
    expect(after?.status).toBe("PROVIDER_ERROR");
    expect(after?.errorMessage).toMatch(/claim expired/i);
  });

  it("does not strand a different corridor", async () => {
    const repo = new MemoryRepository();
    const other = "parse:amtrak-com-api:NYP:WAS:2026-10-09:A1";
    expect(await repo.markSearchInFlight(row(other, 1_000))).toBe(true);
    // A live claim on NYP→WAS must not block BOS→NYP, and expiring one must
    // not touch the other.
    expect(await repo.markSearchInFlight(row(KEY, 0))).toBe(true);
    expect(await repo.markSearchInFlight(row(other, 0))).toBe(false);
  });

  it("treats an undateable marker as abandoned", async () => {
    const repo = new MemoryRepository();
    const broken = { ...row(KEY, 0), createdAt: "not a date" };
    repo.providerRequests.set(broken.id, broken);
    // A marker nobody can date is one nobody can wait out, so it must not be
    // able to hold a corridor shut forever.
    expect(await repo.markSearchInFlight(row(KEY, 0))).toBe(true);
  });

  it("compares claims in one clock domain, not against wall time", async () => {
    /* My first fix dated held claims against Date.now(). Every row in this
       table is stamped from the CYCLE's injected clock, so a suite that runs
       a cycle at a fixed past date saw all of its live claims as days stale
       and handed out a second one — breaking the exact race guarantee this
       function exists to provide. Caught by search-dedup.test.ts.

       Both claimants here carry the same past clock. The second must still
       be refused, because relative to the first it is one second old. */
    const repo = new MemoryRepository();
    const past = new Date("2026-09-26T12:00:00.000Z").getTime();
    const stamp = (offsetMs: number) => ({
      ...row(KEY, 0),
      id: `req-${offsetMs}`,
      createdAt: new Date(past + offsetMs).toISOString(),
    });

    expect(await repo.markSearchInFlight(stamp(0))).toBe(true);
    expect(await repo.markSearchInFlight(stamp(1_000))).toBe(false);
    // And still expires on that same clock once the TTL has passed on it.
    expect(await repo.markSearchInFlight(stamp(IN_FLIGHT_TTL_MS + 1_000))).toBe(true);
  });

  it("reproduces the deadlock the old code had", async () => {
    /* The loop in check-cycle, reduced to its two moving parts. With the old
       store this ran to the turn limit every time. */
    const repo = new MemoryRepository();
    const stranded = row(KEY, IN_FLIGHT_TTL_MS + 60_000);
    repo.providerRequests.set(stranded.id, stranded);

    let turns = 0;
    let claimed = false;
    while (turns < 64 && !claimed) {
      turns += 1;
      const newest = [...repo.providerRequests.values()]
        .filter((r) => r.searchKey === KEY)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
      const plan = planSearch({ newest, now: new Date(), waitedMs: 30_000 });
      if (plan.action !== "search") continue;
      claimed = await repo.markSearchInFlight(row(KEY, 0));
    }
    expect(claimed).toBe(true);
    expect(turns, "the planner and the store should agree on the first turn").toBe(1);
  });
});
