import { getConfig } from "@/lib/config";
import type { FareProvider } from "./fare-provider";
import { ParseFareProvider } from "./parse-fare-provider";
import { WanderuBrowserProvider } from "./wanderu-browser-provider";
import { FallbackFareProvider } from "./fallback-fare-provider";

export function createFareProvider(): FareProvider {
  const config = getConfig();
  if (config.isE2E && !config.isProduction) {
    throw new Error("E2E provider must be injected by the test harness, not created implicitly");
  }
  const prefer = (process.env.FARE_PROVIDER ?? "").trim().toLowerCase();
  if (prefer === "parse") {
    return new ParseFareProvider();
  }
  const wanderu = new WanderuBrowserProvider();
  const parse = config.parseApiKey ? new ParseFareProvider() : null;
  return new FallbackFareProvider(wanderu, parse);
}

export function fareProviderStatus(): {
  configured: boolean;
  provider: string;
  message: string;
} {
  const config = getConfig();
  if (config.isE2E) {
    return {
      configured: true,
      provider: "fixture",
      message: "E2E fixture fares",
    };
  }
  const prefer = (process.env.FARE_PROVIDER ?? "").trim().toLowerCase();
  if (prefer === "parse") {
    return {
      configured: Boolean(config.parseApiKey),
      provider: "parse:amtrak-com-api",
      message: config.parseApiKey
        ? "Parse amtrak-com-api configured"
        : "FARE_PROVIDER=parse but PARSE_API_KEY is missing",
    };
  }
  if (config.isLocal) {
    return {
      configured: true,
      provider: config.parseApiKey ? "wanderu+parse" : "wanderu:amtrak",
      message: "Live Amtrak fares via Wanderu on this machine.",
    };
  }
  return {
    configured: true,
    provider: config.parseApiKey ? "wanderu+parse" : "wanderu:amtrak",
    message: "Live Amtrak fares via Wanderu (Parse fallback if key set).",
  };
}
