import { describe, expect, it } from "vitest";
import { STATIONS, STATION_BY_CODE, DUPLICATE_CODES } from "@/lib/stations/catalog";
import { WANDERU_STATION_IDS, stationByCode } from "@/lib/providers/wanderu-station-map";
import { stationCoverage, unmappedStationCodes } from "@/lib/stations/coverage";

/**
 * Codes the catalog still holds twice, for two different places. Resolving
 * them needs an authoritative Amtrak source. Until one exists the product
 * labels them ambiguous rather than picking a winner, and this list is the
 * record of what is outstanding — shrinking it is the fix, growing it is a
 * regression.
 */
const KNOWN_AMBIGUOUS = ["OSC", "SFA"];

describe("station catalog integrity", () => {
  it("resolves a code the same way everywhere", () => {
    // The picker used to read this map (last-wins) while the provider used
    // STATIONS.find (first-wins), so SFA displayed St. Albans VT and searched
    // San Francisco CA.
    for (const station of STATIONS) {
      expect(stationByCode(station.code)).toBe(STATION_BY_CODE.get(station.code));
    }
  });

  it("holds no duplicate codes beyond the ones already known to be ambiguous", () => {
    expect([...DUPLICATE_CODES].sort()).toEqual(KNOWN_AMBIGUOUS);
  });

  it("gives every catalog entry a unique code once the ambiguous ones are set aside", () => {
    const codes = STATIONS.map((station) => station.code).filter(
      (code) => !DUPLICATE_CODES.has(code),
    );
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("provider coverage", () => {
  it("reports verified only for stations with a real provider id", () => {
    for (const code of Object.keys(WANDERU_STATION_IDS)) {
      expect(stationCoverage(code)).toBe("verified");
    }
  });

  it("reports ambiguous ahead of anything else, because it is the worse fault", () => {
    for (const code of KNOWN_AMBIGUOUS) {
      expect(stationCoverage(code)).toBe("ambiguous");
    }
  });

  it("reports unverified for a catalog station the provider cannot address", () => {
    // BUF is listed under the city "Depew", which is not what Wanderu calls it,
    // so the city-name fallback drops every trip and the date reads as sold out.
    expect(stationCoverage("BUF")).toBe("unverified");
  });

  it("reports unknown for something that is not a station", () => {
    expect(stationCoverage("ZZZ")).toBe("unknown");
  });

  it("enumerates the unmapped stations so the gap cannot be forgotten", () => {
    const unmapped = unmappedStationCodes();
    const total = STATION_BY_CODE.size;

    // Not an assertion that the gap is acceptable — it is not. This pins the
    // number so that adding a station without a provider id is a visible,
    // deliberate act, and so that mapping more of them shows up as progress.
    expect(unmapped.length).toBe(169);
    expect(total).toBe(189);
    expect(unmapped).not.toContain("NYP");
    expect(unmapped).toContain("BUF");
  });
});
