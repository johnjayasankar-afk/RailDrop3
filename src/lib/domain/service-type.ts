import type { ServiceType } from "./types";

const THRUWAY_PATTERN = /\b(thruway|bus|motorcoach|coach usa|peter pan)\b/i;

export function classifyServiceType(input: {
  legCount: number;
  serviceNames: Array<string | null | undefined>;
  rawTypes?: Array<string | null | undefined>;
}): ServiceType {
  const names = input.serviceNames.filter(Boolean).join(" ");
  const raw = (input.rawTypes ?? []).filter(Boolean).join(" ");
  const combined = `${names} ${raw}`.trim();

  if (THRUWAY_PATTERN.test(combined)) {
    return "THRUWAY_OR_BUS";
  }
  if (input.legCount > 1) return "CONNECTING_RAIL";
  if (input.legCount === 1) return "DIRECT_RAIL";
  return "UNKNOWN";
}

export function isRailEligible(serviceType: ServiceType, includeThruway: boolean): boolean {
  if (serviceType === "THRUWAY_OR_BUS") return includeThruway;
  return serviceType === "DIRECT_RAIL" || serviceType === "CONNECTING_RAIL";
}

export function serviceTypeLabel(serviceType: ServiceType): string {
  switch (serviceType) {
    case "DIRECT_RAIL":
      return "Direct rail";
    case "CONNECTING_RAIL":
      return "Connecting rail";
    case "THRUWAY_OR_BUS":
      return "Thruway / bus";
    case "UNKNOWN":
      return "Unknown service";
  }
}
