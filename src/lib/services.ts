import { getConfig } from "@/lib/config";
import type { FareProvider } from "@/lib/providers/fare-provider";
import { WanderuBrowserProvider } from "@/lib/providers/wanderu-browser-provider";
import { ParseFareProvider } from "@/lib/providers/parse-fare-provider";
import { FallbackFareProvider } from "@/lib/providers/fallback-fare-provider";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";

/* One service, because the product has one dependency.
 *
 * This file used to hand out three: a repository, a mailer and a fare
 * provider. Two of them are gone with the watch feature — there is nothing
 * to persist and nobody to email — and their absence is the point rather
 * than a loss. A tool that reads live fares needs a thing that reads live
 * fares.
 */

const globalStore = globalThis as typeof globalThis & {
  __raildropFareProvider?: FareProvider;
};

/**
 * Live fares only — never invent Amtrak prices.
 *
 * Default: Wanderu, which works locally and on Vercel with no key.
 * Optional Parse: set FARE_PROVIDER=parse, or leave a PARSE_API_KEY and
 * Wanderu falls back to Parse only when Wanderu returns PROVIDER_ERROR.
 */
export function getFareProvider(): FareProvider {
  if (globalStore.__raildropFareProvider) return globalStore.__raildropFareProvider;
  const config = getConfig();
  if (config.isE2E) {
    globalStore.__raildropFareProvider = new FixtureFareProvider();
    return globalStore.__raildropFareProvider;
  }
  const prefer = (process.env.FARE_PROVIDER ?? "").trim().toLowerCase();
  if (prefer === "parse") {
    globalStore.__raildropFareProvider = new ParseFareProvider();
    return globalStore.__raildropFareProvider;
  }
  const wanderu = new WanderuBrowserProvider();
  const parse = config.parseApiKey ? new ParseFareProvider() : null;
  globalStore.__raildropFareProvider = new FallbackFareProvider(wanderu, parse);
  return globalStore.__raildropFareProvider;
}
