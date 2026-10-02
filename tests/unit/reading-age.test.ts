import { describe, expect, it } from "vitest";
import { readingAge, readingIsStale } from "@/lib/domain/reading-age";

/* The colophon said WHEN the board was read, in clock time, at the very
 * bottom of the page. A reader looking at the headline figure could not tell
 * a nine-second-old reading from a ninety-minute-old one — the difference
 * between a price and a memory. */

const at = (iso: string) => new Date(iso);

describe("how old the reading is", () => {
  it("is coarse on purpose", () => {
    // A counter ticking through "47 seconds ago" implies a precision about a
    // scraped board that nobody has.
    expect(readingAge("2026-10-09T12:00:00Z", at("2026-10-09T12:00:09Z"))).toBe("read moments ago");
    expect(readingAge("2026-10-09T12:00:00Z", at("2026-10-09T12:00:44Z"))).toBe("read moments ago");
  });

  it("counts minutes, then hours", () => {
    expect(readingAge("2026-10-09T12:00:00Z", at("2026-10-09T12:01:00Z"))).toBe(
      "read 1 minute ago",
    );
    expect(readingAge("2026-10-09T12:00:00Z", at("2026-10-09T12:14:00Z"))).toBe(
      "read 14 minutes ago",
    );
    expect(readingAge("2026-10-09T12:00:00Z", at("2026-10-09T14:00:00Z"))).toBe("read 2 hours ago");
  });

  it("never reports the future, however the clocks disagree", () => {
    expect(readingAge("2026-10-09T12:00:00Z", at("2026-10-09T11:58:00Z"))).toBe("read moments ago");
  });

  it("survives a timestamp it cannot parse", () => {
    expect(readingAge("not a date", at("2026-10-09T12:00:00Z"))).toBe("read just now");
    expect(readingIsStale("not a date", at("2026-10-09T12:00:00Z"))).toBe(false);
  });

  it("calls a reading stale once a fare could plausibly have moved", () => {
    expect(readingIsStale("2026-10-09T12:00:00Z", at("2026-10-09T12:04:00Z"))).toBe(false);
    expect(readingIsStale("2026-10-09T12:00:00Z", at("2026-10-09T12:06:00Z"))).toBe(true);
  });
});
