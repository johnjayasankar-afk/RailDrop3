import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testIgnore: process.env.VISUAL_QA ? [] : ['**/visual/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      E2E_MODE: 'true',
      FARE_PROVIDER: 'deterministic',
      RAILDROP_ALLOW_TEST_PROVIDER: 'i-understand-this-is-not-production',
      // Placeholders only: every Supabase call is intercepted by the E2E harness
      // before a client is constructed. They exist so the app does not render its
      // "not configured" state.
      NEXT_PUBLIC_SUPABASE_URL: 'http://e2e.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key-placeholder',
      NEXT_PUBLIC_APP_URL: BASE_URL,
      LOG_LEVEL: 'error',
      RD_DEBUG_RENDER: process.env.RD_DEBUG_RENDER ?? '',
    },
  },
});
