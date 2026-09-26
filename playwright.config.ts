import { defineConfig, devices } from "@playwright/test";

/** Override with E2E_PORT when 3210 is taken too. */
const E2E_PORT = process.env.E2E_PORT ?? "3210";
const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  /* A port of its own, not 3000.
   *
   * The suite used to take whatever was on 3000 and assume it was RailDrop. On
   * a machine with a second project running, it silently drove that app instead
   * and failed on a 404 belonging to somebody else — and `reuseExistingServer:
   * false` meant the only other outcome was refusing to start at all. */
  use: {
    baseURL: E2E_ORIGIN,
    trace: "on-first-retry",
  },
  webServer: {
    command: `E2E_TEST=1 NEXT_PUBLIC_APP_URL=${E2E_ORIGIN} npm run dev -- --hostname 127.0.0.1 --port ${E2E_PORT}`,
    url: `${E2E_ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
