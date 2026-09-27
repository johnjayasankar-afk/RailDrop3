import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { routeGuard } from "@/lib/api/respond";
import { loadPageData } from "@/lib/pages/load-guard";
import { errorDetail, errorMessage, isTransportFailure, toAppError } from "@/lib/errors";
import { createWatchAndScan } from "@/lib/watches/create-watch";
import { MemoryRepository } from "@/lib/db/memory-store";
import { RecordingMailer } from "@/lib/notifications/resend-mailer";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import type { RailDropRepository } from "@/lib/db/repository";

/* What the app does when its database has gone.
 *
 * This is not hypothetical. The Supabase project a deployment pointed at stopped
 * resolving; DNS returned NXDOMAIN for it. Every route that touched the
 * database failed, and between them they produced: a red "TypeError: fetch
 * failed" under the Start watching button, bare 500s with empty bodies on five
 * unguarded routes, and a /api/health that answered 200 ok:true throughout.
 *
 * These tests fix the behaviour in place. They do not need a real outage — the
 * failure a dead hostname produces is one specific error object, and that is
 * what they throw.
 */

/** Exactly what undici throws, with the cause supabase-js loses. */
function deadHostname(): TypeError {
  const error = new TypeError("fetch failed");
  (error as TypeError & { cause?: unknown }).cause = new Error(
    "getaddrinfo ENOTFOUND hsztdjmrifsgpspvrnbz.supabase.co",
  );
  return error;
}

/** And what supabase-js turns that into by the time a caller sees it. */
const asSupabaseSees = { message: "TypeError: fetch failed", details: "", hint: "", code: "" };

describe("a route whose database is unreachable", () => {
  it("answers 503, not 500 and not 400", async () => {
    // 400 blames the caller for a request that could not have succeeded either
    // way; a bare 500 tells a retrying client nothing.
    const response = await routeGuard({ route: "/test" }, async () => {
      throw deadHostname();
    });
    expect(response.status).toBe(503);
  });

  it("answers with a body, rather than a blank 500", async () => {
    const response = await routeGuard({ route: "/test" }, async () => {
      throw asSupabaseSees;
    });
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBeTruthy();
    expect(body.error).toMatch(/nothing was saved/i);
  });

  it("does not put a Node internal on the screen", async () => {
    const response = await routeGuard({ route: "/test" }, async () => {
      throw deadHostname();
    });
    const body = (await response.json()) as { error: string };
    expect(body.error).not.toMatch(/fetch failed/i);
    expect(body.error).not.toMatch(/TypeError/);
    expect(body.error).not.toMatch(/ENOTFOUND/);
  });

  it("puts the hostname in the log, where it is useful", async () => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line) => {
      logged.push(line);
    });
    try {
      await routeGuard({ route: "/api/watches" }, async () => {
        throw deadHostname();
      });
    } finally {
      spy.mockRestore();
    }
    const all = logged.map(String).join("\n");
    expect(all).toContain("ENOTFOUND");
    expect(all).toContain("supabase.co");
    expect(all).toContain("/api/watches");
  });

  it("still lets a normal response through untouched", async () => {
    const response = await routeGuard({ route: "/test" }, async () =>
      NextResponse.json({ watches: [] }, { status: 200 }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ watches: [] });
  });

  it("still answers 503 after the message has been rewritten for a reader", async () => {
    /* The classification has to survive translation. createWatchAndScan wraps
     * the failure into a readable sentence before a route ever sees it, and
     * that sentence contains none of the words that identify a network error —
     * so the route answered 400 Bad Request during an outage. */
    const readable = toAppError(deadHostname());
    expect(readable.message).toMatch(/nothing was saved/i);
    expect(isTransportFailure(readable)).toBe(true);

    const response = await routeGuard({ route: "/test" }, async () => {
      throw readable;
    });
    expect(response.status).toBe(503);
  });

  it("keeps the original reachable for the log after rewriting", async () => {
    const readable = toAppError(deadHostname()) as Error & { cause?: unknown };
    expect(errorDetail(readable)).toContain("fetch failed");
  });

  it("keeps 500 for a failure that is not the network", async () => {
    const response = await routeGuard({ route: "/test" }, async () => {
      throw new Error("permission denied for table watches");
    });
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("permission denied");
  });
});

describe("creating a watch when the database is unreachable", () => {
  /** A repository whose every call fails the way a dead host fails. */
  function brokenRepo(): RailDropRepository {
    return new Proxy({} as RailDropRepository, {
      get() {
        return async () => {
          throw asSupabaseSees;
        };
      },
    });
  }

  it("tells the traveler their trip was not saved", async () => {
    let caught: unknown;
    try {
      await createWatchAndScan({
        userId: "u1",
        email: "traveler@example.com",
        body: {
          originCode: "BOS",
          destinationCode: "NYP",
          desiredTravelDate: "2026-10-09",
          dateFlexibilityDays: 0 as const,
          currentBookedPriceCents: 12_800,
        },
        repo: brokenRepo(),
        provider: new FixtureFareProvider(),
        mailer: new RecordingMailer(),
        now: new Date("2026-09-26T12:00:00.000Z"),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const shown = errorMessage(caught);
    expect(shown).toMatch(/nothing was saved/i);
    expect(shown).not.toMatch(/fetch failed/i);
  });

  it("still works when the database is there", async () => {
    // The guard rails must not have broken the ordinary path.
    const watch = await createWatchAndScan({
      userId: "u1",
      email: "traveler@example.com",
      body: {
        originCode: "BOS",
        destinationCode: "NYP",
        desiredTravelDate: "2026-10-09",
        dateFlexibilityDays: 0 as const,
        currentBookedPriceCents: 12_800,
      },
      repo: new MemoryRepository(),
      provider: new FixtureFareProvider(),
      mailer: new RecordingMailer(),
      now: new Date("2026-09-26T12:00:00.000Z"),
    });
    expect(watch.id).toBeTruthy();
    expect(watch.lastCheckCycleId).toBeTruthy();
  });
});

/* The pages, which for two weeks had no guard at all.
 *
 * Every API route was wrapped in routeGuard. The pages were not, so /dashboard,
 * /watches/[id], /settings and /unsubscribe all threw into app/error.tsx and
 * told the reader "The board could not load ... Try again: this is usually a
 * brief hitch" — while the live fare search, which needs no database, was
 * working the whole time.
 */
describe("a page whose database is unreachable", () => {
  /** Every call fails the way a dead host fails. */
  function brokenRepo(): RailDropRepository {
    return new Proxy({} as RailDropRepository, {
      get() {
        return async () => {
          throw asSupabaseSees;
        };
      },
    });
  }

  /** The shape /unsubscribe runs: read the watch, suppress, clear the address. */
  async function runUnsubscribe(repo: RailDropRepository) {
    const stopped = await loadPageData(
      { page: "/unsubscribe", watchId: "w1" },
      async (): Promise<"done" | "already"> => {
        const watch = await repo.getWatch("w1");
        const email = watch?.alertEmail?.trim();
        if (!watch || !email) return "already";
        await repo.suppressEmail({
          email,
          reason: "UNSUBSCRIBED",
          watchId: "w1",
          detail: "Unsubscribe link in an alert email.",
        });
        await repo.updateWatch("w1", { alertEmail: "" });
        return "done";
      },
    );
    return stopped.reachable ? stopped.data : "unreachable";
  }

  it("never claims to have stopped mail it could not stop", async () => {
    /* The worst available answer on this page. Someone has just asked us to
       stop emailing them; "Stopped." would be a promise we did not keep, and
       they would find out by receiving the next alert. */
    expect(await runUnsubscribe(brokenRepo())).toBe("unreachable");
  });

  it("does not tell them there was nothing to stop, either", async () => {
    /* The tempting wrong fix: a bare try/catch that falls through to "already".
       That reads as "that trip has no alert email on it", which blames their
       link for our outage and is just as false as claiming success. */
    expect(await runUnsubscribe(brokenRepo())).not.toBe("already");
  });

  it("still stops the mail when the database is there", async () => {
    // The guard must not have broken the path that matters.
    const repo = new MemoryRepository();
    const watch = await repo.createWatch({
      userId: "u1",
      originCode: "BOS",
      destinationCode: "NYP",
      desiredTravelDate: "2026-10-09",
      dateFlexibilityDays: 0,
      currentBookedPriceCents: 12_800,
      alertEmail: "traveler@example.com",
    } as Parameters<MemoryRepository["createWatch"]>[0]);
    const stopped = await loadPageData(
      { page: "/unsubscribe", watchId: watch.id },
      async (): Promise<"done" | "already"> => {
        const found = await repo.getWatch(watch.id);
        if (!found?.alertEmail?.trim()) return "already";
        await repo.updateWatch(watch.id, { alertEmail: "" });
        return "done";
      },
    );
    expect(stopped).toEqual({ reachable: true, data: "done" });
    expect((await repo.getWatch(watch.id))?.alertEmail ?? "").toBe("");
  });

  it("lets a board read degrade instead of throwing", async () => {
    const loaded = await loadPageData({ page: "/dashboard", userId: "u1" }, () =>
      brokenRepo().listWatchesForUser("u1"),
    );
    expect(loaded.reachable).toBe(false);
  });
});
