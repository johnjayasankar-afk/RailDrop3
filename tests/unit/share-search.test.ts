import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLEXIBILITY_DAYS,
  isPastDate,
  readSharedSearch,
  sharedSearchHref,
} from "@/lib/domain/share-search";

/* A search that can be sent to somebody, and the thing it deliberately cannot
 * carry.
 *
 * Route and date travel in the link; fares never do. A price in a query
 * parameter would let anyone mint a link reading "BOS to NYP, $5" and have it
 * render in RailDrop's own typeface on RailDrop's own background — the one
 * promise broken by a URL, with the forgery indistinguishable from the real
 * thing. These values arrive from a stranger, so every one of them is treated
 * as hostile.
 */

const today = "2026-09-28";

describe("reading a shared link", () => {
  it("reads a well-formed one", () => {
    const search = readSharedSearch(
      { from: "bos", to: "nyp", on: "2026-10-09", flex: "2", pax: "3" },
      today,
    );
    expect(search).toEqual({
      originCode: "BOS",
      destinationCode: "NYP",
      travelDate: "2026-10-09",
      flexibilityDays: 2,
      passengers: 3,
      routeWasNamed: true,
    });
  });

  it("falls back rather than repairing a station code", () => {
    /* Guessing what somebody meant by "BOSTON" is how you search a route they
       did not ask for and show them fares for it. */
    expect(readSharedSearch({ from: "BOSTON" }, today).originCode).toBe("BOS");
    expect(readSharedSearch({ from: "B0S" }, today).originCode).toBe("BOS");
    expect(readSharedSearch({ from: "" }, today).originCode).toBe("BOS");
  });

  it("rejects a date that is calendar-shaped but not a date", () => {
    // 2026-02-31 passes the pattern and is not a day.
    expect(readSharedSearch({ on: "2026-02-31" }, today).travelDate).toBe(today);
    expect(readSharedSearch({ on: "2026-13-01" }, today).travelDate).toBe(today);
    expect(readSharedSearch({ on: "tomorrow" }, today).travelDate).toBe(today);
  });

  it("clamps the numbers instead of trusting them", () => {
    expect(readSharedSearch({ pax: "900" }, today).passengers).toBe(8);
    expect(readSharedSearch({ pax: "-4" }, today).passengers).toBe(1);
    expect(readSharedSearch({ pax: "nope" }, today).passengers).toBe(1);
    expect(readSharedSearch({ flex: "7" }, today).flexibilityDays).toBe(1);
  });

  it("searches the default window when the link does not say", () => {
    /* The bug this guards is the one that mattered most: an absent `flex` read
       as 0, so the bare /fares searched a single date and the cheapest-day
       register, the spread and the daypart strip never rendered for anybody
       who had not found the radio buttons. */
    expect(readSharedSearch({ from: "BOS", to: "NYP" }, today).flexibilityDays).toBe(1);
    expect(readSharedSearch({}, today).flexibilityDays).toBe(DEFAULT_FLEXIBILITY_DAYS);
    // And an explicit one date is still one date.
    expect(readSharedSearch({ flex: "0" }, today).flexibilityDays).toBe(0);
  });

  it("takes the first value when a parameter is repeated", () => {
    // ?from=BOS&from=PHL is a crafted link, not a typo.
    expect(readSharedSearch({ from: ["BOS", "PHL"] }, today).originCode).toBe("BOS");
  });
});

describe("writing one", () => {
  it("round-trips", () => {
    const search = readSharedSearch({ from: "PHL", to: "WAS", on: "2026-11-02", flex: "1" }, today);
    const href = sharedSearchHref(search);
    const params = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(readSharedSearch(params, today)).toEqual(search);
  });

  it("leaves defaults out, so the common link stays short", () => {
    const href = sharedSearchHref({
      originCode: "BOS",
      destinationCode: "NYP",
      travelDate: "2026-10-09",
      flexibilityDays: DEFAULT_FLEXIBILITY_DAYS,
      passengers: 1,
    });
    expect(href).toBe("/fares?from=BOS&to=NYP&on=2026-10-09");
  });

  it("writes an explicit single date, because 0 is not the default", () => {
    /* The regression this guards: `flex` was written only when > 0 and read as
       0 when absent, so one date was both the default AND unexpressible in a
       link. A reader who deliberately asked for one date and sent it got the
       same URL as somebody who asked for three. */
    const href = sharedSearchHref({
      originCode: "BOS",
      destinationCode: "NYP",
      travelDate: "2026-10-09",
      flexibilityDays: 0,
      passengers: 1,
    });
    expect(href).toBe("/fares?from=BOS&to=NYP&on=2026-10-09&flex=0");
    const params = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(readSharedSearch(params, today).flexibilityDays).toBe(0);
  });

  it("never carries a price", () => {
    /* The constraint the whole design rests on. If a fare could ride in the
       link, a forged one would be indistinguishable from an observed one. */
    const href = sharedSearchHref({
      originCode: "BOS",
      destinationCode: "NYP",
      travelDate: "2026-10-09",
      flexibilityDays: 1,
      passengers: 2,
    });
    // The query string only: the path is /fares, which is not a fare.
    const query = href.split("?")[1] ?? "";
    expect(query).not.toMatch(/price|cents|fare|\$|usd|amount|total/i);
    // And nothing that is merely a number pretending to be money.
    for (const [key] of new URLSearchParams(query)) {
      expect(["from", "to", "on", "flex", "pax"]).toContain(key);
    }
  });
});

describe("a link that has gone stale", () => {
  it("knows a date in the past", () => {
    expect(isPastDate("2026-09-01", today)).toBe(true);
    expect(isPastDate(today, today)).toBe(false);
    expect(isPastDate("2026-12-01", today)).toBe(false);
    expect(isPastDate(null, today)).toBe(false);
  });
});
