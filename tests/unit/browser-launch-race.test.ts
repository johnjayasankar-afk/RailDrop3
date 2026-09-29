import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Two callers, one Chromium.
 *
 * `withSlot` caps concurrent *searches* at one under serverless. It does not
 * cover `healthCheck`, and `healthCheck` is the unauthenticated half of
 * GET /api/health/provider — the probe behind it needs the operator
 * credential, the health check does not.
 *
 * So a health check arriving while a cron search starts cold reached
 * `browser()` with both callers seeing a null handle, both running the whole
 * six-strategy launcher, and the second assignment overwriting the first. One
 * Chromium left running with nothing holding it, on a function with 2 GB to
 * spend, until the instance died. The launcher's first strategy alone allows
 * 45 seconds, so this is not a one-millisecond window.
 *
 * The launcher is mocked because the point under test is the arbitration, not
 * the launch: with a real Chromium the assertion "exactly one launch" would be
 * about process spawning rather than about this code, and it would take a
 * minute to find out.
 */

const launched = { count: 0 };

vi.mock("@/lib/providers/playwright-launch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/providers/playwright-launch")>(
    "@/lib/providers/playwright-launch",
  );
  return {
    ...actual,
    launchChromium: vi.fn(async () => {
      launched.count += 1;
      // Long enough that a second caller genuinely arrives mid-launch.
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        isConnected: () => true,
        newContext: async () => ({ close: async () => undefined }),
        close: async () => undefined,
      };
    }),
  };
});

type BrowserGlobals = {
  __raildropWanderuBrowser?: unknown;
  __raildropWanderuContext?: unknown;
  __raildropWanderuLaunch?: unknown;
};

function clearSharedBrowser() {
  const shared = globalThis as unknown as BrowserGlobals;
  shared.__raildropWanderuBrowser = null;
  shared.__raildropWanderuContext = null;
  shared.__raildropWanderuLaunch = null;
}

beforeEach(() => {
  launched.count = 0;
  clearSharedBrowser();
});

afterEach(clearSharedBrowser);

describe("the shared browser is launched once, however many callers arrive", () => {
  it("does not launch twice when a health check races a search", async () => {
    const { WanderuBrowserProvider } = await import("@/lib/providers/wanderu-browser-provider");
    const provider = new WanderuBrowserProvider();

    // Two independent callers, both cold, both in flight at the same moment.
    const [a, b] = await Promise.all([provider.healthCheck(), provider.healthCheck()]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(launched.count).toBe(1);
  });

  it("does not launch twice for eight simultaneous callers", async () => {
    const { WanderuBrowserProvider } = await import("@/lib/providers/wanderu-browser-provider");
    const provider = new WanderuBrowserProvider();

    const results = await Promise.all(Array.from({ length: 8 }, () => provider.healthCheck()));

    expect(results.every((result) => result.ok)).toBe(true);
    expect(launched.count).toBe(1);
  });

  it("reuses the browser on a later call rather than launching again", async () => {
    const { WanderuBrowserProvider } = await import("@/lib/providers/wanderu-browser-provider");
    const provider = new WanderuBrowserProvider();

    await provider.healthCheck();
    await provider.healthCheck();

    expect(launched.count).toBe(1);
  });

  it("clears the marker after a failed launch, so the next caller may try", async () => {
    const launcher = await import("@/lib/providers/playwright-launch");
    const mocked = vi.mocked(launcher.launchChromium);
    mocked.mockRejectedValueOnce(new Error("no browser here"));

    const { WanderuBrowserProvider } = await import("@/lib/providers/wanderu-browser-provider");
    const provider = new WanderuBrowserProvider();

    const failed = await provider.healthCheck();
    expect(failed.ok).toBe(false);

    // A stuck marker would leave the provider permanently unable to launch,
    // which is a worse failure than the race it was added to prevent.
    const recovered = await provider.healthCheck();
    expect(recovered.ok).toBe(true);
  });
});
