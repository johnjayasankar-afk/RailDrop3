import type { FareFamily, TravelClass } from "./types";

const FLEXIBLE_CODES = new Set(["FLX", "FLEXIBLE", "FLEX", "FLEXIBLE FARE"]);
const VALUE_CODES = new Set(["VLU", "VALUE", "VAL"]);
const SAVER_CODES = new Set(["SVR", "SAVER", "SAVE"]);
const PREMIUM_CODES = new Set(["PREMIUM", "PRM", "PREM"]);

export function normalizeFareFamily(raw: string | null | undefined): FareFamily {
  if (!raw) return "UNKNOWN";
  const key = raw.trim().toUpperCase();
  if (FLEXIBLE_CODES.has(key) || key.includes("FLEX")) return "FLEXIBLE";
  if (VALUE_CODES.has(key) || key.includes("VALUE")) return "VALUE";
  if (SAVER_CODES.has(key) || key.includes("SAVER")) return "SAVER";
  if (PREMIUM_CODES.has(key) || key.includes("PREMIUM")) return "PREMIUM";
  return "OTHER";
}

export function normalizeTravelClass(raw: string | null | undefined): TravelClass {
  if (!raw) return "UNKNOWN";
  const key = raw.trim().toUpperCase();
  if (key.includes("COACH") || key === "COA") return "COACH";
  if (key.includes("BUSINESS") || key === "BUS") return "BUSINESS";
  if (key.includes("FIRST") || key === "FST") return "FIRST";
  if (key.includes("ROOMETTE") || key.includes("BEDROOM") || key.includes("SLEEPER")) {
    return "SLEEPER";
  }
  return "OTHER";
}

export function fareFamilyLabel(family: FareFamily): string {
  switch (family) {
    case "FLEXIBLE":
      return "Flexible";
    case "VALUE":
      return "Value";
    case "SAVER":
      return "Saver";
    case "PREMIUM":
      return "Premium";
    case "OTHER":
      return "Other";
    case "UNKNOWN":
      return "Unknown fare";
  }
}

export function travelClassLabel(travelClass: TravelClass): string {
  switch (travelClass) {
    case "COACH":
      return "Coach";
    case "BUSINESS":
      return "Business";
    case "FIRST":
      return "First";
    case "SLEEPER":
      return "Sleeper";
    case "OTHER":
      return "Other";
    case "UNKNOWN":
      return "Unknown class";
  }
}

export function isRestrictedFare(family: FareFamily): boolean {
  return family === "VALUE" || family === "SAVER";
}
