import { describe, expect, it } from "vitest";
import {
  LEASE_MS,
  MAX_ATTEMPTS,
  fairBatch,
  isExpired,
  leaseExpiry,
  reap,
  type LeaseRow,
} from "@/lib/domain/run-lease";

const now = new Date("2026-09-25T12:00:00.000Z");
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();
const row = (patch: Partial<LeaseRow> = {}): LeaseRow => ({
  status: "RUNNING",
  attempts: 1,
  leaseExpiresAt: at(60_000),
  ...patch,
});

describe("isExpired", () => {
  it("is false while the lease still has time", () => {
    expect(isExpired(row(), now)).toBe(false);
  });

  it("is true once the lease has run out", () => {
    expect(isExpired(row({ leaseExpiresAt: at(-1) }), now)).toBe(true);
    expect(isExpired(row({ leaseExpiresAt: at(0) }), now)).toBe(true);
  });

  it("only ever applies to RUNNING rows", () => {
    // A finished slot is finished. Reclaiming it would re-check it forever.
    for (const status of ["PENDING", "DONE", "FAILED", "ABANDONED"] as const) {
      expect(isExpired(row({ status, leaseExpiresAt: at(-999_999) }), now)).toBe(false);
    }
  });

  it("reclaims a RUNNING row whose expiry is missing or unreadable", () => {
    // RUNNING with no expiry cannot be explained by a live worker, so it is a
    // crashed one. Leaving it would burn the slot permanently.
    expect(isExpired(row({ leaseExpiresAt: null }), now)).toBe(true);
    expect(isExpired(row({ leaseExpiresAt: "not a date" }), now)).toBe(true);
  });

  it("outlives the function ceiling, so a slow worker is never reclaimed mid-run", () => {
    expect(LEASE_MS).toBeGreaterThan(300_000);
  });
});

describe("reap", () => {
  it("leaves a live lease alone", () => {
    expect(reap(row(), now)).toEqual({ action: "leave" });
  });

  it("retries an expired lease, counting the attempt", () => {
    expect(reap(row({ attempts: 0, leaseExpiresAt: at(-1) }), now)).toEqual({
      action: "retry",
      attempts: 1,
    });
  });

  it("gives up once the slot has had its chances", () => {
    const decision = reap(row({ attempts: MAX_ATTEMPTS, leaseExpiresAt: at(-1) }), now);
    expect(decision.action).toBe("abandon");
    if (decision.action === "abandon") {
      // The reason is written down: an abandoned slot must be explainable.
      expect(decision.reason).toContain(String(MAX_ATTEMPTS));
    }
  });

  it("abandons rather than retrying past the limit", () => {
    expect(reap(row({ attempts: 99, leaseExpiresAt: at(-1) }), now).action).toBe("abandon");
  });

  it("retries right up to the limit and not beyond", () => {
    for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts += 1) {
      expect(reap(row({ attempts, leaseExpiresAt: at(-1) }), now).action).toBe("retry");
    }
  });
});

describe("leaseExpiry", () => {
  it("is the lease length from now", () => {
    expect(leaseExpiry(now)).toBe(new Date(now.getTime() + LEASE_MS).toISOString());
  });
});

describe("fairBatch", () => {
  const item = (user: string, n: number) => ({ user, n });

  it("gives every user a turn before anyone gets a second", () => {
    // Without this, one user with twenty watches takes the whole wake and
    // everybody else waits an hour.
    const items = [
      item("a", 1),
      item("a", 2),
      item("a", 3),
      item("a", 4),
      item("b", 1),
      item("c", 1),
    ];
    const batch = fairBatch(items, (i) => i.user, 4);
    expect(batch.map((i) => i.user)).toEqual(["a", "b", "c", "a"]);
  });

  it("returns everything when the limit exceeds the queue", () => {
    const items = [item("a", 1), item("b", 1)];
    expect(fairBatch(items, (i) => i.user, 10)).toHaveLength(2);
  });

  it("keeps each user's own watches in their original order", () => {
    const items = [item("a", 1), item("a", 2), item("b", 1)];
    const batch = fairBatch(items, (i) => i.user, 3);
    const aOrder = batch.filter((i) => i.user === "a").map((i) => i.n);
    expect(aOrder).toEqual([1, 2]);
  });

  it("takes nothing for a limit of zero or less", () => {
    const items = [item("a", 1)];
    expect(fairBatch(items, (i) => i.user, 0)).toEqual([]);
    expect(fairBatch(items, (i) => i.user, -5)).toEqual([]);
  });

  it("handles an empty queue", () => {
    expect(fairBatch([], () => "a", 5)).toEqual([]);
  });

  it("does not starve a quiet user behind a busy one", () => {
    const heavy = Array.from({ length: 20 }, (_, i) => item("heavy", i));
    const light = [item("light", 0)];
    const batch = fairBatch([...heavy, ...light], (i) => i.user, 5);
    expect(batch.some((i) => i.user === "light")).toBe(true);
  });
});
