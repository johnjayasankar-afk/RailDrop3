import { describe, expect, it, vi } from "vitest";
import { notFound, redirect } from "next/navigation";
import { loadPageData } from "@/lib/pages/load-guard";

/* The guard that decides whether a page degrades or dies.
 *
 * The bug it fixes: /dashboard and /watches/[id] made their repository calls
 * with no try/catch, so a database we could not reach threw into app/error.tsx
 * — "The board could not load ... Try again: this is usually a brief hitch."
 * The board was fine, the hitch was a host that no longer resolves, and the
 * retry it offered could never work.
 *
 * The two ways this could be got wrong are both tested here. Swallow too
 * little and the misleading screen comes back. Swallow too much and you break
 * notFound() and redirect(), which work by throwing — a watch that is not
 * yours would render as an outage instead of a 404.
 */

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const at = { page: "/dashboard" };

/** The real shape: undici puts the errno on the cause, not the message. */
function deadHost(): Error {
  const error = new TypeError("fetch failed");
  Object.defineProperty(error, "cause", {
    value: new Error("getaddrinfo ENOTFOUND hsztdjmrifsgpspvrnbz.supabase.co"),
  });
  return error;
}

describe("when the read succeeds", () => {
  it("hands back the data", async () => {
    const loaded = await loadPageData(at, async () => ["a", "b"]);
    expect(loaded).toEqual({ reachable: true, data: ["a", "b"] });
  });

  it("does not confuse an empty result with an unreachable one", async () => {
    // A user with no watches is a normal page, not an outage.
    const loaded = await loadPageData(at, async () => []);
    expect(loaded.reachable).toBe(true);
  });
});

describe("when the database is unreachable", () => {
  it("reports it as unreachable rather than throwing", async () => {
    const loaded = await loadPageData(at, async () => {
      throw deadHost();
    });
    expect(loaded.reachable).toBe(false);
  });

  it("recognises the failure by its cause, not only its message", async () => {
    /* "fetch failed" on its own carries no sign of a transport problem. The
       hostname and the errno are on the cause, which is where the real one
       from production put them. */
    const bare = new TypeError("fetch failed");
    expect((await loadPageData(at, async () => Promise.reject(bare))).reachable).toBe(false);
  });

  it("logs the hostname for us without putting it on the page", async () => {
    const { logger } = await import("@/lib/logger");
    await loadPageData({ page: "/dashboard", userId: "u1" }, async () => {
      throw deadHost();
    });
    expect(logger.error).toHaveBeenCalledWith(
      "page.records_unreachable",
      expect.objectContaining({
        page: "/dashboard",
        userId: "u1",
        detail: expect.stringContaining("hsztdjmrifsgpspvrnbz.supabase.co"),
      }),
    );
  });
});

describe("what it refuses to swallow", () => {
  it("lets notFound() through, so a stranger's watch is still a 404", async () => {
    /* The expensive mistake. Caught here, "this watch is not yours" would
       render as "our records are unreachable" — a 200 with the wrong page and
       a false explanation. */
    await expect(
      loadPageData(at, async () => {
        notFound();
      }),
    ).rejects.toThrow();
  });

  it("lets redirect() through, so the guest hand-off still happens", async () => {
    await expect(
      loadPageData(at, async () => {
        redirect("/login");
      }),
    ).rejects.toThrow();
  });

  it("rethrows a bug in our own code instead of blaming the database", async () => {
    /* Relabelling a defect as an outage is the same class of lie as inventing
       a price: a confident sentence about something we did not observe. */
    const bug = new TypeError("watch.destinationCode is not a function");
    await expect(loadPageData(at, async () => Promise.reject(bug))).rejects.toThrow(
      "is not a function",
    );
  });
});
