import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/domain/relative-time";

describe("formatRelativeTime", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");

  it("handles missing and recent timestamps", () => {
    expect(formatRelativeTime(null, now)).toBe("not yet");
    expect(formatRelativeTime("2026-09-03T11:59:50.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-09-03T11:47:00.000Z", now)).toBe("13 min ago");
    expect(formatRelativeTime("2026-09-03T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-09-02T12:00:00.000Z", now)).toBe("yesterday");
  });
});
