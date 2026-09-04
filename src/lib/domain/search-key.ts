import type { FareSearchRequest } from "./types";

export const DEFAULT_PROVIDER_ID = "parse:amtrak-com-api";

export function canonicalSearchKey(provider: string, request: FareSearchRequest): string {
  return [
    provider,
    request.originCode.toUpperCase(),
    request.destinationCode.toUpperCase(),
    request.travelDate,
    `A${request.passengers.adultCount}`,
  ].join(":");
}

export function parseSearchKey(key: string): {
  provider: string;
  originCode: string;
  destinationCode: string;
  travelDate: string;
  adultCount: number;
} | null {
  const match = /^(.+):([A-Z0-9]{3}):([A-Z0-9]{3}):(\d{4}-\d{2}-\d{2}):A(\d+)$/.exec(key);
  if (!match) return null;
  return {
    provider: match[1],
    originCode: match[2],
    destinationCode: match[3],
    travelDate: match[4],
    adultCount: Number(match[5]),
  };
}
