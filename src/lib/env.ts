/**
 * Environment access, split by trust boundary.
 *
 * `publicEnv` is safe in the browser. `serverEnv` throws if it is ever read from
 * a browser context, which turns an accidental client import into a loud failure
 * instead of a leaked secret.
 */

const isBrowser = typeof window !== 'undefined';

export class EnvError extends Error {}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new EnvError(
      `Missing required environment variable ${name}. See .env.example and SETUP_REQUIRED.md.`,
    );
  }
  return value;
}

function num(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new EnvError(`${name} must be a number, got ${value}`);
  return parsed;
}

function int(name: string, value: string | undefined, fallback: number): number {
  const parsed = num(name, value, fallback);
  if (!Number.isInteger(parsed)) throw new EnvError(`${name} must be an integer, got ${value}`);
  return parsed;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

// ─── Public (browser-safe) ───────────────────────────────────────────────────

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  // Safe in the browser by design: it is how the push service identifies this app.
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
} as const;

export function requirePublicEnv(): {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appUrl: string;
} {
  return {
    supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', publicEnv.supabaseUrl),
    supabaseAnonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', publicEnv.supabaseAnonKey),
    appUrl: publicEnv.appUrl,
  };
}

/**
 * True when Supabase is configured. Lets the UI degrade honestly rather than crash.
 *
 * E2E_MODE is not a NEXT_PUBLIC_ variable, so Next replaces this read with
 * `undefined` in client bundles and evaluates it at runtime on the server -
 * which is exactly what the E2E harness needs, without a separate build.
 */
export function isSupabaseConfigured(): boolean {
  if (process.env.E2E_MODE === 'true') return true;
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

// ─── Server-only ─────────────────────────────────────────────────────────────

export type PricingBasisEnv = 'PER_PASSENGER' | 'TOTAL_PARTY' | 'UNKNOWN';

export interface ServerEnv {
  nodeEnv: string;
  isProduction: boolean;
  e2eMode: boolean;

  supabaseServiceRoleKey: string;
  supabaseDbUrl: string;

  fareProvider: string;
  allowTestProvider: string;
  parseApiKey: string;
  parseScraperId: string;
  parseBaseUrl: string;
  providerTimeoutMs: number;
  pricingBasis: PricingBasisEnv;
  amountUnit: 'dollars' | 'cents';

  httpProviderUrl: string;
  httpProviderMethod: 'GET' | 'POST';
  httpProviderBody: string | null;
  httpProviderAuthHeader: string | null;
  httpProviderAuthValue: string | null;
  httpProviderKey: string;
  httpProviderHeaders: Record<string, string>;
  httpProviderLabel: string;

  resendApiKey: string;
  resendFrom: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  emailMaxAttempts: number;

  cronSecret: string;
  runLeaseMinutes: number;
  manualCheckCooldownMinutes: number;
  maxActiveWatchesPerUser: number;

  creditsPerSearch: number;
  monthlyCreditBudget: number;
  budgetSoftStopPct: number;
  budgetHardStopPct: number;
  maxSearchesPerDispatch: number;
  circuitFailures: number;
  circuitCooldownMinutes: number;

  defaultTimezone: string;
  alertMaterialDropCents: number;
  alertUrgentDropCents: number;
  alertCooldownMinutes: number;
  alertConvenienceDelta: number;
  alertPriceToleranceCents: number;
  alertPriceTolerancePct: number;

  amtrakDeeplinkVerified: boolean;
  amtrakDeeplinkTemplate: string | null;
  adminEmails: string[];
}

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (isBrowser) {
    throw new EnvError(
      'getServerEnv() was called in the browser. Server secrets must never reach the client bundle.',
    );
  }
  if (cached) return cached;

  const e = process.env;
  cached = {
    nodeEnv: e.NODE_ENV ?? 'development',
    isProduction: e.NODE_ENV === 'production',
    e2eMode: bool(e.E2E_MODE),

    supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY ?? '',
    supabaseDbUrl: e.SUPABASE_DB_URL ?? '',

    fareProvider: e.FARE_PROVIDER ?? 'parse',
    allowTestProvider: e.RAILDROP_ALLOW_TEST_PROVIDER ?? '',
    parseApiKey: e.PARSE_API_KEY ?? '',
    parseScraperId: e.PARSE_SCRAPER_ID ?? 'f800c27d-0aaa-4ca0-864e-4dc69e20f764',
    parseBaseUrl: (e.PARSE_BASE_URL ?? 'https://api.parse.bot').replace(/\/+$/, ''),
    providerTimeoutMs: int('PROVIDER_TIMEOUT_MS', e.PROVIDER_TIMEOUT_MS, 20_000),
    pricingBasis: normalisePricingBasis(e.PROVIDER_PRICING_BASIS),
    amountUnit: e.PROVIDER_AMOUNT_UNIT === 'cents' ? 'cents' : 'dollars',

    httpProviderUrl: e.HTTP_PROVIDER_URL ?? '',
    httpProviderMethod: e.HTTP_PROVIDER_METHOD === 'POST' ? 'POST' : 'GET',
    httpProviderBody: e.HTTP_PROVIDER_BODY ?? null,
    httpProviderAuthHeader: e.HTTP_PROVIDER_AUTH_HEADER ?? null,
    httpProviderAuthValue: e.HTTP_PROVIDER_AUTH_VALUE ?? null,
    httpProviderKey: e.HTTP_PROVIDER_KEY ?? '',
    httpProviderHeaders: parseJsonHeaders(e.HTTP_PROVIDER_HEADERS),
    httpProviderLabel: e.HTTP_PROVIDER_LABEL ?? 'http',

    resendApiKey: e.RESEND_API_KEY ?? '',
    resendFrom: e.RESEND_FROM ?? '',
    vapidPrivateKey: e.VAPID_PRIVATE_KEY ?? '',
    vapidSubject: e.VAPID_SUBJECT ?? '',
    emailMaxAttempts: int('EMAIL_MAX_ATTEMPTS', e.EMAIL_MAX_ATTEMPTS, 3),

    cronSecret: e.CRON_SECRET ?? '',
    runLeaseMinutes: int('RUN_LEASE_MINUTES', e.RUN_LEASE_MINUTES, 15),
    manualCheckCooldownMinutes: int(
      'MANUAL_CHECK_COOLDOWN_MINUTES',
      e.MANUAL_CHECK_COOLDOWN_MINUTES,
      15,
    ),
    maxActiveWatchesPerUser: int('MAX_ACTIVE_WATCHES_PER_USER', e.MAX_ACTIVE_WATCHES_PER_USER, 25),

    creditsPerSearch: num('PROVIDER_CREDITS_PER_SEARCH', e.PROVIDER_CREDITS_PER_SEARCH, 2),
    monthlyCreditBudget: num(
      'PROVIDER_MONTHLY_CREDIT_BUDGET',
      e.PROVIDER_MONTHLY_CREDIT_BUDGET,
      5000,
    ),
    budgetSoftStopPct: num('PROVIDER_BUDGET_SOFT_STOP_PCT', e.PROVIDER_BUDGET_SOFT_STOP_PCT, 0.8),
    budgetHardStopPct: num('PROVIDER_BUDGET_HARD_STOP_PCT', e.PROVIDER_BUDGET_HARD_STOP_PCT, 1.0),
    maxSearchesPerDispatch: int(
      'PROVIDER_MAX_SEARCHES_PER_DISPATCH',
      e.PROVIDER_MAX_SEARCHES_PER_DISPATCH,
      200,
    ),
    circuitFailures: int('PROVIDER_CIRCUIT_FAILURES', e.PROVIDER_CIRCUIT_FAILURES, 5),
    circuitCooldownMinutes: int(
      'PROVIDER_CIRCUIT_COOLDOWN_MINUTES',
      e.PROVIDER_CIRCUIT_COOLDOWN_MINUTES,
      30,
    ),

    defaultTimezone: e.DEFAULT_TIMEZONE ?? 'America/New_York',
    alertMaterialDropCents: int('ALERT_MATERIAL_DROP_CENTS', e.ALERT_MATERIAL_DROP_CENTS, 500),
    alertUrgentDropCents: int('ALERT_URGENT_DROP_CENTS', e.ALERT_URGENT_DROP_CENTS, 3000),
    alertCooldownMinutes: int('ALERT_COOLDOWN_MINUTES', e.ALERT_COOLDOWN_MINUTES, 60),
    alertConvenienceDelta: num('ALERT_CONVENIENCE_DELTA', e.ALERT_CONVENIENCE_DELTA, 15),
    alertPriceToleranceCents: int(
      'ALERT_PRICE_TOLERANCE_CENTS',
      e.ALERT_PRICE_TOLERANCE_CENTS,
      200,
    ),
    alertPriceTolerancePct: num('ALERT_PRICE_TOLERANCE_PCT', e.ALERT_PRICE_TOLERANCE_PCT, 0.03),

    amtrakDeeplinkVerified: bool(e.AMTRAK_DEEPLINK_VERIFIED),
    amtrakDeeplinkTemplate: e.AMTRAK_DEEPLINK_TEMPLATE ?? null,
    adminEmails: (e.RAILDROP_ADMIN_EMAILS ?? '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  };
  return cached;
}

/** Extra static headers as a JSON object; a malformed value is ignored, not fatal. */
function parseJsonHeaders(value: string | undefined): Record<string, string> {
  if (!value || value.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function normalisePricingBasis(value: string | undefined): PricingBasisEnv {
  const v = (value ?? 'UNKNOWN').toUpperCase();
  if (v === 'PER_PASSENGER' || v === 'TOTAL_PARTY') return v;
  return 'UNKNOWN';
}

/** Test-only. */
export function resetServerEnvCache(): void {
  cached = null;
}

export function requireServerSecret(name: keyof ServerEnv): string {
  const env = getServerEnv();
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EnvError(`Missing required server secret ${String(name)}.`);
  }
  return value;
}

/** Operational pages (credit usage) are admin-only. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getServerEnv().adminEmails.includes(email.toLowerCase());
}
