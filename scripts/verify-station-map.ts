/* Does the Wanderu station map still describe reality?
 *
 * The map is twenty hand-verified ids. Wanderu can rename or retire one at any
 * time, and when that happens RailDrop does not break loudly — it quietly
 * stops matching trips for that station and reports "no cheaper fare", which
 * is the one failure this product must never invent.
 *
 * This script probes each mapped station with a real search and reports drift.
 * It never writes to the map: a machine guessing station ids is exactly how
 * the wrong-station bug got here. Run it, read it, edit the map by hand.
 *
 *   npx tsx scripts/verify-station-map.ts            # probe every mapped id
 *   npx tsx scripts/verify-station-map.ts BOS NYP    # probe a subset
 *   npx tsx scripts/verify-station-map.ts --offline  # audit only, no network
 */

import { WANDERU_STATION_IDS, stationByCode } from "../src/lib/providers/wanderu-station-map";
import { STATION_BY_CODE, DUPLICATE_CODES } from "../src/lib/stations/catalog";
import { unmappedStationCodes } from "../src/lib/stations/coverage";

type Row = {
  code: string;
  ids: string[];
  station: string;
  verdict: "OK" | "NO TRIPS" | "ERROR" | "NOT IN CATALOG" | "SKIPPED";
  detail: string;
};

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

/** A date far enough out that inventory exists, close enough to be real. */
function probeDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 21);
  return date.toISOString().slice(0, 10);
}

async function probe(code: string, offline: boolean): Promise<Row> {
  const ids = WANDERU_STATION_IDS[code] ?? [];
  const station = stationByCode(code);
  if (!station) {
    return {
      code,
      ids,
      station: "—",
      verdict: "NOT IN CATALOG",
      detail: "mapped id with no catalog entry; the search URL cannot be built",
    };
  }
  const label = `${station.name} (${station.city}, ${station.state})`;
  if (offline) {
    return { code, ids, station: label, verdict: "SKIPPED", detail: "--offline" };
  }

  // Imported lazily so --offline needs no browser and no provider env.
  const { WanderuBrowserProvider } = await import("../src/lib/providers/wanderu-browser-provider");
  const provider = new WanderuBrowserProvider();
  try {
    const result = await provider.searchTrips({
      originCode: code,
      destinationCode: code === "WAS" ? "NYP" : "WAS",
      travelDate: probeDate(),
      passengers: { adultCount: 1 },
    });
    if (result.status === "SUCCESS" && result.journeys.length > 0) {
      return {
        code,
        ids,
        station: label,
        verdict: "OK",
        detail: `${result.journeys.length} journeys`,
      };
    }
    return {
      code,
      ids,
      station: label,
      verdict: result.status === "PROVIDER_ERROR" ? "ERROR" : "NO TRIPS",
      detail: result.providerError?.message ?? result.status,
    };
  } catch (error) {
    return {
      code,
      ids,
      station: label,
      verdict: "ERROR",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const requested = args.filter((arg) => !arg.startsWith("--")).map((arg) => arg.toUpperCase());
  const codes = requested.length > 0 ? requested : Object.keys(WANDERU_STATION_IDS);

  console.log(
    `\nWanderu station map — ${codes.length} mapped code(s)${offline ? ", offline" : ""}`,
  );
  console.log("=".repeat(96));

  const rows: Row[] = [];
  for (const code of codes) {
    const row = await probe(code, offline);
    rows.push(row);
    console.log(
      `${pad(row.code, 5)} ${pad(row.ids.join(","), 18)} ${pad(row.station, 38)} ${pad(row.verdict, 15)} ${row.detail}`,
    );
  }

  // The part that matters even with no network: what the map does not cover.
  const unmapped = unmappedStationCodes();
  console.log("\n" + "=".repeat(96));
  console.log(`Catalog stations          ${STATION_BY_CODE.size}`);
  console.log(`Verified provider ids     ${Object.keys(WANDERU_STATION_IDS).length}`);
  console.log(
    `No verified id            ${unmapped.length} (${Math.round((unmapped.length / STATION_BY_CODE.size) * 100)}% of the catalog)`,
  );
  console.log(`Ambiguous codes           ${[...DUPLICATE_CODES].sort().join(", ") || "none"}`);
  console.log(
    "\nUnmapped stations fall back to matching Wanderu's city name, which fails silently.",
  );
  console.log("They are labelled 'coverage unverified' in the picker. Do not guess ids to fix it.");

  const broken = rows.filter((row) => row.verdict === "ERROR" || row.verdict === "NOT IN CATALOG");
  if (broken.length > 0) {
    console.log(`\n${broken.length} mapped station(s) need attention.`);
    process.exitCode = 1;
  }
}

void main();
