import { afterEach, describe, expect, it } from "vitest";
import { getConfig, resetConfigCache } from "@/lib/config";

/* When the app is allowed to fall back to the local file store, and when it
 * must fail loudly instead.
 *
 * `npm run dev` on a clean checkout used to die on the first write with
 * "Supabase service role is not configured" — the one thing the product does
 * failed, and the fix was an environment variable the error never mentioned.
 * The app already ships a complete file-backed store; it was simply never
 * reached unless you knew to ask.
 *
 * Falling back is only safe because it is narrow. Everything below is one of
 * the edges of that narrowness, and each one matters for a different reason:
 * a real deployment must never silently write trips into a JSON file, and the
 * test suite must never have its behaviour changed by a convenience meant for
 * a developer's laptop.
 */

const KEYS = [
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
  "E2E_TEST",
  "RAILDROP_LOCAL",
  "NEXT_PUBLIC_RAILDROP_LOCAL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const saved = new Map<string, string | undefined>();
for (const key of KEYS) saved.set(key, process.env[key]);

function env(values: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
  resetConfigCache();
  return getConfig();
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigCache();
});

const SUPABASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

describe("falling back to the local store", () => {
  it("does it for npm run dev with nothing configured", () => {
    const config = env({ NODE_ENV: "development" });
    expect(config.localByDefault).toBe(true);
    expect(config.isLocal).toBe(true);
    expect(config.isOffline).toBe(true);
  });

  it("does not do it when Supabase is configured", () => {
    const config = env({ NODE_ENV: "development", ...SUPABASE });
    expect(config.localByDefault).toBe(false);
    expect(config.isOffline).toBe(false);
  });

  it("does not do it on a half-configured Supabase, which is a mistake to surface", () => {
    // A URL with no service key is someone midway through setup. Quietly
    // writing their trips to a JSON file would hide the thing they need to fix.
    const config = env({
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
    expect(config.localByDefault).toBe(false);
    expect(config.isOffline).toBe(false);
  });

  it("never does it in production", () => {
    const config = env({ NODE_ENV: "production" });
    expect(config.localByDefault).toBe(false);
    expect(config.isLocal).toBe(false);
    expect(config.isOffline).toBe(false);
  });

  it("never does it on Vercel, even a preview with no database", () => {
    const config = env({ NODE_ENV: "development", VERCEL: "1", VERCEL_ENV: "preview" });
    expect(config.localByDefault).toBe(false);
    expect(config.isOffline).toBe(false);
  });

  it("never does it under the test runner", () => {
    /* This is not hygiene, it is a real bug that happened. `isLocal` also sets
     * the cycle's search concurrency — 3 in local mode, 1 otherwise — so
     * inferring it under vitest made the deadline test fire three searches
     * before the budget could decline the second. A convenience for a laptop
     * must not change what the suite is testing. */
    const config = env({ NODE_ENV: "test" });
    expect(config.localByDefault).toBe(false);
    expect(config.isLocal).toBe(false);
  });

  it("leaves E2E alone, which has its own fixtures", () => {
    const config = env({ NODE_ENV: "development", E2E_TEST: "1" });
    expect(config.localByDefault).toBe(false);
    expect(config.isE2E).toBe(true);
    // Still offline — but through the E2E path, with the in-memory store rather
    // than a file on disk.
    expect(config.isOffline).toBe(true);
  });

  it("is not marked as inferred when it was asked for", () => {
    // RAILDROP_LOCAL=1 is a decision. The banner and the log distinguish the
    // two so nobody is surprised by where their data went.
    const config = env({ NODE_ENV: "development", RAILDROP_LOCAL: "1" });
    expect(config.isLocal).toBe(true);
    expect(config.localByDefault).toBe(false);
  });

  it("allows a production build to run locally, which is how it gets measured", () => {
    /* The guard used to key on NODE_ENV, which `next start` sets, so there was
       no way to run a production build on a laptop at all. */
    const config = env({ NODE_ENV: "production", RAILDROP_LOCAL: "1" });
    expect(config.isLocal).toBe(true);
    // And it actually reaches the file store, rather than falling through to a
    // Supabase that is not configured.
    expect(config.isOffline).toBe(true);
    expect(config.isProduction).toBe(true);
  });

  it("cannot be offline on a deployment, however the flags are set", () => {
    // The invariant the production guard exists for, stated directly.
    expect(env({ NODE_ENV: "production", VERCEL: "1", ...SUPABASE }).isOffline).toBe(false);
    expect(env({ NODE_ENV: "development", VERCEL: "1" }).isOffline).toBe(false);
    expect(env({ NODE_ENV: "development", VERCEL: "1", VERCEL_ENV: "preview" }).isOffline).toBe(
      false,
    );
  });

  it("still refuses it on a deployed environment, which is where the risk is", () => {
    expect(() => env({ NODE_ENV: "production", VERCEL: "1", RAILDROP_LOCAL: "1" })).toThrow(
      /deployed/i,
    );
  });

  it("is asked-for even when Supabase is configured", () => {
    const config = env({ NODE_ENV: "development", RAILDROP_LOCAL: "1", ...SUPABASE });
    expect(config.isLocal).toBe(true);
    expect(config.localByDefault).toBe(false);
  });
});
