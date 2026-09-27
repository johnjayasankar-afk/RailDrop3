import { describe, expect, it } from "vitest";
import { errorScreen, errorSubject } from "@/lib/domain/error-subject";

/* The boundary used to say "The board could not load." everywhere.
 *
 * One error boundary serves the whole app, so a failure on /login told the
 * reader that a board they were not looking at had gone. And it promised the
 * failure was "usually a brief hitch", which it cannot know — in production it
 * is handed a redacted digest. That sentence kept a fortnight-long outage
 * looking momentary.
 */

describe("naming the screen that failed", () => {
  it("knows a board from its path", () => {
    expect(errorScreen("/watches/8b1f9c2e-0000-4000-8000-000000000000")).toBe("board");
  });

  it("does not call the new-trip form a board", () => {
    /* The bug a prefix match would reintroduce: /watches/new is a form, and
       telling someone their board failed while they were filling it in is the
       same wrong claim in a smaller place. */
    expect(errorScreen("/watches/new")).toBe("watches-new");
  });

  it("names the other screens", () => {
    expect(errorScreen("/")).toBe("home");
    expect(errorScreen("/dashboard")).toBe("dashboard");
    expect(errorScreen("/settings")).toBe("settings");
    expect(errorScreen("/login")).toBe("login");
  });

  it("says unknown rather than guessing", () => {
    // The whole point: an unrecognised route must not fall back to the board.
    expect(errorScreen("/how-it-works")).toBe("unknown");
    expect(errorScreen("/unsubscribe")).toBe("unknown");
    expect(errorScreen(null)).toBe("unknown");
    expect(errorScreen(undefined)).toBe("unknown");
    expect(errorScreen("")).toBe("unknown");
  });

  it("is not fooled by a trailing slash or a query", () => {
    expect(errorScreen("/dashboard/")).toBe("dashboard");
    expect(errorScreen("/watches/abc/")).toBe("board");
    expect(errorScreen("/dashboard?b=d:2026-10-04")).toBe("dashboard");
  });

  it("does not treat a deeper path as a board", () => {
    expect(errorScreen("/watches/abc/settings")).toBe("unknown");
  });
});

describe("what the boundary tells the reader", () => {
  it("names the board only on a board", () => {
    expect(errorSubject("/watches/abc").heading).toBe("The board could not load.");
    expect(errorSubject("/login").heading).not.toMatch(/board/i);
    expect(errorSubject("/how-it-works").heading).not.toMatch(/board/i);
  });

  it("never promises the failure is brief", () => {
    /* The sentence this module exists to delete. The boundary sees a redacted
       digest; it cannot tell a slow minute from a dead host, and guessing wrong
       is what kept the reader retrying. */
    for (const path of ["/", "/dashboard", "/login", "/watches/abc", "/settings", "/nope"]) {
      const { heading, body } = errorSubject(path);
      expect(`${heading} ${body}`).not.toMatch(/brief|hitch|moment|temporar|shortly|soon/i);
    }
  });

  it("says when waiting will not help", () => {
    expect(errorSubject("/dashboard").body).toMatch(/waiting will not clear it/i);
  });

  it("reassures only where something is actually saved", () => {
    expect(errorSubject("/watches/abc").body).toMatch(/nothing you saved was changed/i);
    expect(errorSubject("/dashboard").body).toMatch(/nothing you saved was changed/i);
    expect(errorSubject("/settings").body).toMatch(/nothing you saved was changed/i);
    // Nothing of the reader's is on these, so the sentence would be noise.
    expect(errorSubject("/login").body).not.toMatch(/nothing you saved/i);
    expect(errorSubject("/").body).not.toMatch(/nothing you saved/i);
  });

  it("always offers the reader something to do", () => {
    for (const path of ["/", "/dashboard", "/login", "/watches/abc", null]) {
      expect(errorSubject(path).body).toMatch(/try again/i);
      expect(errorSubject(path).heading.endsWith(".")).toBe(true);
    }
  });
});
