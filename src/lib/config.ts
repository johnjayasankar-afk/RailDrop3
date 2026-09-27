import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  PARSE_API_KEY: z.string().optional(),
  PARSE_SCRAPER_ID: z.string().default("f800c27d-0aaa-4ca0-864e-4dc69e20f764"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  PROVIDER_CREDITS_PER_SEARCH: z.coerce.number().default(2),
  PROVIDER_MONTHLY_CREDIT_BUDGET: z.coerce.number().default(1000),
  // 0 disables the ceiling, which is what local and test runs want.
  PROVIDER_DAILY_SEARCH_BUDGET: z.coerce.number().default(0),
  E2E_TEST: z.string().optional(),
  RAILDROP_LOCAL: z.string().optional(),
  NEXT_PUBLIC_RAILDROP_LOCAL: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  appUrl: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceRoleKey: string | null;
  parseApiKey: string | null;
  parseScraperId: string;
  resendApiKey: string | null;
  resendFrom: string | null;
  cronSecret: string | null;
  providerCreditsPerSearch: number;
  providerMonthlyCreditBudget: number;
  providerDailySearchBudget: number;
  isE2E: boolean;
  isLocal: boolean;
  /**
   * True when local mode was inferred rather than asked for.
   *
   * The banner and the health endpoint say so, because a developer who thinks
   * they are talking to Supabase and is actually writing a JSON file should
   * find that out from the app rather than from a missing row.
   */
  localByDefault: boolean;
  isOffline: boolean;
  isProduction: boolean;
};

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.parse(process.env);
  const isE2E = parsed.E2E_TEST === "1";
  // Never treat Vercel / cloud builds as local, even if a laptop .env.local is present.
  const onVercel = process.env.VERCEL === "1" || Boolean(parsed.VERCEL_ENV);
  const askedForLocal =
    !onVercel && (parsed.RAILDROP_LOCAL === "1" || parsed.NEXT_PUBLIC_RAILDROP_LOCAL === "1");
  const isProduction = parsed.NODE_ENV === "production" || parsed.VERCEL_ENV === "production";

  /* `npm run dev` should start a working app.
   *
   * It did not. With no .env.local the first write threw "Supabase service role
   * is not configured", so the one thing the product does — put a trip on a
   * board — failed on a clean checkout, and the fix was an environment variable
   * documented nowhere the error mentioned. The app already ships a complete
   * file-backed store for exactly this; it was simply never reached unless you
   * knew to ask for it.
   *
   * Narrow on purpose. Only off Vercel, only outside production, and only when
   * there is no Supabase to talk to — so a real deployment with a broken or
   * missing credential still fails loudly instead of quietly writing a trip
   * into a JSON file nobody will look at again. */
  /* Any mention of Supabase, not a complete one.
   *
   * Someone who has put a project URL in .env.local intends to use Supabase.
   * If the service role key is missing they are midway through setup, and
   * quietly diverting their trips into a JSON file would hide the exact thing
   * they need to fix. The fallback is for "nothing is configured", which is a
   * clean checkout, not "something is configured wrong". */
  const supabaseMentioned = Boolean(
    parsed.NEXT_PUBLIC_SUPABASE_URL ||
    parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    parsed.SUPABASE_SERVICE_ROLE_KEY,
  );
  /* Development only, and never NODE_ENV=test.
   *
   * The unit and integration suites construct their own repositories and
   * providers and pass them in, so they have no need of this — and inferring it
   * there is not harmless. `isLocal` also sets the cycle's search concurrency
   * (check-cycle.ts: 3 in local mode, 1 otherwise), so switching it on under
   * vitest made the deadline test fire three searches before the budget could
   * decline the second. A convenience for `npm run dev` must not change what
   * the tests are testing. */
  const localByDefault =
    parsed.NODE_ENV === "development" &&
    !onVercel &&
    !isProduction &&
    !isE2E &&
    !askedForLocal &&
    !supabaseMentioned;
  const isLocal = askedForLocal || localByDefault;

  if (isProduction && isE2E) {
    throw new Error("E2E_TEST cannot be enabled in production");
  }
  /* Deployed, not merely built for production.
   *
   * The guard exists so a real deployment can never quietly write trips into a
   * JSON file, and it should. But it keyed on NODE_ENV, which `next start` sets
   * — so there was no way to run a production build on a laptop at all, and no
   * way to measure one. Keying on Vercel keeps the protection exactly where the
   * risk is and gives the local production build back. */
  /* The raw variable, not askedForLocal — which already excludes Vercel, so a
     guard on it could never fire. Setting this on a deployment is a mistake
     worth a loud failure rather than a silent ignore: somebody believes the
     app is using a file store and it is not. */
  if (onVercel && (parsed.RAILDROP_LOCAL === "1" || parsed.NEXT_PUBLIC_RAILDROP_LOCAL === "1")) {
    throw new Error("RAILDROP_LOCAL cannot be enabled on a deployed environment");
  }

  cached = {
    nodeEnv: parsed.NODE_ENV,
    appUrl: parsed.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""),
    supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL || null,
    supabaseAnonKey: parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY || null,
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY || null,
    parseApiKey: parsed.PARSE_API_KEY || null,
    parseScraperId: parsed.PARSE_SCRAPER_ID,
    resendApiKey: parsed.RESEND_API_KEY || null,
    resendFrom: parsed.RESEND_FROM || null,
    cronSecret: parsed.CRON_SECRET || null,
    providerCreditsPerSearch: parsed.PROVIDER_CREDITS_PER_SEARCH,
    providerMonthlyCreditBudget: parsed.PROVIDER_MONTHLY_CREDIT_BUDGET,
    providerDailySearchBudget: parsed.PROVIDER_DAILY_SEARCH_BUDGET,
    isE2E,
    isLocal,
    localByDefault,
    /* No `&& !isProduction`.
     *
     * That clause was the second half of the same papercut: even with
     * RAILDROP_LOCAL set, a local production build fell through to Supabase, so
     * `next start` on a laptop could not work and could not be measured.
     *
     * Dropping it is safe because the invariant is enforced where the risk
     * actually is. isE2E throws in production, and isLocal is only reachable
     * off Vercel — askedForLocal excludes it and now throws on it, and
     * localByDefault is development-only. So isOffline cannot be true on a
     * deployment, which is the property that matters. */
    isOffline: isE2E || isLocal,
    isProduction,
  };
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}

/**
 * The one origin the deployment actually answers on.
 *
 * metadataBase, sitemap, robots and every email CTA used to hardcode
 * https://raildrop.app, a domain this deployment does not serve — so the
 * canonical URLs, the sitemap and the "open your board" link in an alert all
 * pointed somewhere else. Preview deployments were worse: every one of them
 * claimed to be production.
 *
 * Resolution order is explicit config, then the Vercel-provided production
 * domain, then localhost. Never a literal.
 */
export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  return "http://localhost:3000";
}

export function applyParseApiKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed.startsWith("pmx_")) {
    throw new Error("Parse keys start with pmx_");
  }
  process.env.PARSE_API_KEY = trimmed;
  resetConfigCache();
}

export function hasLiveParseKey(): boolean {
  return Boolean(getConfig().parseApiKey);
}

export function requireServerSecret(name: keyof AppConfig, value: string | null): string {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}
