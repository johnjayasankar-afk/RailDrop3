/* What RailDrop can honestly claim about a station.
 *
 * The catalog lists 189 stations. The live provider has verified ids for 20 of
 * them. For the rest the provider falls back to matching Wanderu's city and
 * state strings against ours, which fails silently in two directions:
 *
 *   - the catalog city differs from Wanderu's ("Depew" for BUF, "Rensselaer"
 *     for ALB), so every trip is dropped and the date reads as sold out;
 *   - two stations share a city ("RVR"/"RVM" in Richmond), so the filter cannot
 *     tell them apart and a fare from the wrong platform is relabeled with the
 *     code the traveler asked for.
 *
 * The second one is the dangerous half: a real price, for a station the
 * traveler did not choose, presented as theirs. RailDrop's whole promise is
 * that it never shows a price it cannot stand behind, so the product has to be
 * able to say which stations those are — out loud, in the picker, before a
 * watch is created.
 */

import { STATIONS, DUPLICATE_CODES } from "./catalog";
import { WANDERU_STATION_IDS } from "@/lib/providers/wanderu-station-map";

export type StationCoverage =
  /** A verified provider station id exists: results are trustworthy. */
  | "verified"
  /** In the catalog, but the provider has to guess by city name. */
  | "unverified"
  /** Two different stations in the catalog share this code. Never resolvable. */
  | "ambiguous"
  /** Not a station RailDrop knows at all. */
  | "unknown";

const CATALOG_CODES = new Set(STATIONS.map((station) => station.code));

export function stationCoverage(code: string): StationCoverage {
  const upper = code.toUpperCase();
  if (DUPLICATE_CODES.has(upper)) return "ambiguous";
  if (WANDERU_STATION_IDS[upper]) return "verified";
  if (CATALOG_CODES.has(upper)) return "unverified";
  return "unknown";
}

/** Short, honest wording for the picker. Never promises what it cannot verify. */
export function coverageNote(coverage: StationCoverage): string | null {
  switch (coverage) {
    case "verified":
      return null;
    case "unverified":
      return "Coverage unverified — live results for this station are not guaranteed";
    case "ambiguous":
      return "Two stations in our catalog share this code — results may be for the wrong one";
    case "unknown":
      return "Not a station RailDrop recognises";
  }
}

/** Every catalog code with no verified provider id. Used by the coverage test. */
export function unmappedStationCodes(): string[] {
  return [...CATALOG_CODES].filter((code) => !WANDERU_STATION_IDS[code]).sort();
}
