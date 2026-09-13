import { afterEach, describe, expect, it } from "vitest";
import { pinBrowsersPath, sanitizeProviderError } from "@/lib/providers/playwright-launch";

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

  it("hides vercel read-only mkdir failures", () => {
    expect(
      sanitizeProviderError("ENOENT: no such file or directory, mkdir '/var/task/.playwright'"),
    ).toBe("Browser for live fares is still setting up. Recheck in a minute.");
  });
});

describe("pinBrowsersPath", () => {
  const previousVercel = process.env.VERCEL;
  const previousPath = process.env.PLAYWRIGHT_BROWSERS_PATH;

  afterEach(() => {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previousPath;
  });

  it("uses /tmp on Vercel instead of /var/task", () => {
    process.env.VERCEL = "1";
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    const pinned = pinBrowsersPath();
    expect(pinned.startsWith("/tmp/")).toBe(true);
    expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBe(pinned);
  });
});
