import { describe, expect, it } from "vitest";
import { watchFormInitialFromQuery, returnTravelDate } from "@/lib/domain/watch-query";

describe("watch query initials", () => {
  it("accepts valid return-trip params", () => {
    expect(
      watchFormInitialFromQuery(
        { origin: "nyp", destination: "bos", date: "2026-09-24", price: "128" },
        "2026-09-02",
      ),
    ).toEqual({
      origin: "NYP",
      destination: "BOS",
      date: "2026-09-24",
      price: "128",
    });
  });

  it("drops invalid or same-station values", () => {
    expect(
      watchFormInitialFromQuery(
        { origin: "BOS", destination: "BOS", date: "2020-01-01", price: "-4" },
        "2026-09-02",
      ),
    ).toEqual({
      origin: "BOS",
      destination: undefined,
      date: undefined,
      price: undefined,
    });
  });

  it("offsets a return date and never lands in the past", () => {
    expect(returnTravelDate("2026-09-23", 2, "2026-09-02")).toBe("2026-09-25");
    expect(returnTravelDate("2026-09-02", 2, "2026-09-10")).toBe("2026-09-10");
    expect(returnTravelDate("2026-09-23", 0, "2026-09-02")).toBe("2026-09-24");
  });
});
