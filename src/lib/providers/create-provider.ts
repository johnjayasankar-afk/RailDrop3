import { getConfig } from "@/lib/config";
import { FareProvider, ProviderNotConfiguredError } from "./fare-provider";
import { ParseFareProvider } from "./parse-fare-provider";

export function createFareProvider(): FareProvider {
  const config = getConfig();
  if (config.isE2E && !config.isProduction) {
    throw new Error("E2E provider must be injected by the test harness, not created implicitly");
  }
  if (!config.parseApiKey) {
    throw new ProviderNotConfiguredError(
      "PARSE_API_KEY is required in this environment. RailDrop will not invent Amtrak fares.",
    );
  }
  return new ParseFareProvider();
}

export function fareProviderStatus(): {
  configured: boolean;
  provider: string;
  message: string;
} {
  const config = getConfig();
  if (config.isLocal && !config.isE2E) {
    return {
      configured: true,
      provider: "wanderu:amtrak",
      message: "Live Amtrak fares via Wanderu on this machine.",
    };
  }
  if (config.parseApiKey) {
    return {
      configured: true,
      provider: "parse:amtrak-com-api",
      message: "Parse amtrak-com-api configured",
    };
  }
  if (config.isOffline) {
    return {
      configured: false,
      provider: "local-sample",
      message: "Local mode is using sample fares. Add PARSE_API_KEY for live Amtrak data.",
    };
  }
  return {
    configured: false,
    provider: "parse:amtrak-com-api",
    message: "PARSE_API_KEY is not configured. Fare search is disabled.",
  };
}
