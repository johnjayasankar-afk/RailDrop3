import { STATIONS, type StationSeed } from "@/lib/stations/catalog";

/** Wanderu station IDs we have verified against Amtrak codes. */
export const WANDERU_STATION_IDS: Record<string, string[]> = {
  BOS: ["BOSSST"],
  BBY: ["BOSBBA"],
  BON: ["BOSNST"],
  RTE: ["RTE"],
  PVD: ["PVD", "PVDUNI"],
  KIN: ["KIN"],
  NLC: ["NLC"],
  NHV: ["NHVUST", "NHV"],
  STM: ["STM"],
  NYP: ["NYCPEN"],
  NWK: ["NWKPNS"],
  EWR: ["EWRAIR"],
  MET: ["MET"],
  TRE: ["TRE"],
  PHL: ["PHL30S", "PHL30"],
  WIL: ["WIL"],
  BAL: ["BALPEN", "BALPNS"],
  BWI: ["BWIAIR", "BWI"],
  WAS: ["WASUNI", "WASUST", "WAS"],
  ALX: ["ALX"],
};

const AMTRAK_CARRIERS = new Set(["AMT", "USACL", "USNER", "USLSL", "USAHL", "USACE", "USAMK"]);

export function isAmtrakCarrier(
  carrier: string | null | undefined,
  operatorName?: string | null,
): boolean {
  if (carrier && AMTRAK_CARRIERS.has(carrier.toUpperCase())) return true;
  const name = operatorName?.toLowerCase() ?? "";
  return (
    name.includes("amtrak") ||
    name.includes("acela") ||
    name.includes("northeast regional") ||
    name.includes("lake shore") ||
    name.includes("hartford line")
  );
}

export function stationByCode(code: string): StationSeed | undefined {
  return STATIONS.find((station) => station.code === code.toUpperCase());
}

export function wanderuSearchLabel(code: string): { city: string; state: string } {
  const station = stationByCode(code);
  if (!station) {
    return { city: code, state: "US" };
  }
  return { city: station.city, state: station.state };
}

export function codeFromWanderuId(stationId: string | null | undefined): string | null {
  if (!stationId) return null;
  const upper = stationId.toUpperCase();
  for (const [code, ids] of Object.entries(WANDERU_STATION_IDS)) {
    if (ids.some((id) => id.toUpperCase() === upper)) return code;
  }
  // Many Wanderu IDs start with the Amtrak code (BOSSST, NYCPEN, PHL30S).
  if (/^[A-Z]{3}/.test(upper) && stationByCode(upper.slice(0, 3))) {
    return upper.slice(0, 3);
  }
  return null;
}

export function tripMatchesStation(
  requestedCode: string,
  tripStationId: string | null | undefined,
  tripCity: string | null | undefined,
  tripState: string | null | undefined,
  tripWcityId: string | null | undefined,
  relax = false,
): boolean {
  const requested = requestedCode.toUpperCase();
  const mapped = WANDERU_STATION_IDS[requested];
  if (!relax && mapped && tripStationId) {
    return mapped.includes(tripStationId.toUpperCase());
  }
  const station = stationByCode(requested);
  if (!station) return false;
  if (
    tripWcityId &&
    [requested, station.city.slice(0, 3).toUpperCase()].includes(tripWcityId.toUpperCase())
  ) {
    return true;
  }
  if (tripWcityId === "NYC" && requested === "NYP") return true;
  const city = (tripCity ?? "").toLowerCase();
  const state = (tripState ?? "").toUpperCase();
  return city === station.city.toLowerCase() && state === station.state.toUpperCase();
}
