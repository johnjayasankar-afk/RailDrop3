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
  isE2E: boolean;
  isLocal: boolean;
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
  const isLocal =
    !onVercel && (parsed.RAILDROP_LOCAL === "1" || parsed.NEXT_PUBLIC_RAILDROP_LOCAL === "1");
  const isProduction = parsed.NODE_ENV === "production" || parsed.VERCEL_ENV === "production";

  if (isProduction && isE2E) {
    throw new Error("E2E_TEST cannot be enabled in production");
  }
  if (isProduction && isLocal) {
    throw new Error("RAILDROP_LOCAL cannot be enabled in production");
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
    isE2E,
    isLocal,
    isOffline: (isE2E || isLocal) && !isProduction,
    isProduction,
  };
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
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
