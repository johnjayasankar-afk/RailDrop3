import { getConfig } from "@/lib/config";
import type { FareProvider } from "./fare-provider";
import { ParseFareProvider } from "./parse-fare-provider";
import { WanderuBrowserProvider } from "./wanderu-browser-provider";

export function createFareProvider(): FareProvider {
  const config = getConfig();
  if (config.isE2E && !config.isProduction) {
    throw new Error("E2E provider must be injected by the test harness, not created implicitly");
  }
  if (config.parseApiKey && !config.isLocal) {
    return new ParseFareProvider();
  }
  return new WanderuBrowserProvider();
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
  if (config.isLocal) {
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
  return {
    configured: true,
    provider: "wanderu:amtrak",
    message: "Live Amtrak fares via Wanderu (no Parse key required).",
  };
}
