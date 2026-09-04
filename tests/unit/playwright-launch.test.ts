import { describe, expect, it } from "vitest";
import { sanitizeProviderError } from "@/lib/providers/playwright-launch";

describe("sanitizeProviderError", () => {
  it("hides playwright installer essays", () => {
    const raw =
      "browserType.launch: Executable doesn't exist at /tmp/playwright/chromium\n" +
      "╔════════════════════════════════════════════════════════════╗\n" +
      "║ Please run npx playwright install ║";
    expect(sanitizeProviderError(raw)).toBe(
      "Browser for live fares is still setting up. Recheck in a minute.",
    );
  });

  it("keeps short operational messages", () => {
    expect(sanitizeProviderError("Wanderu returned no trip data")).toBe(
      "No live trips came back for this window. Recheck in a minute.",
    );
  });
});
