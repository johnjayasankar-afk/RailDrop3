import { NextResponse } from "next/server";
import { stationQuerySchema } from "@/lib/validation/watch";
import { STATIONS } from "@/lib/stations/catalog";
import { stationCoverage } from "@/lib/stations/coverage";

type StationRow = { code: string; name: string; city: string; state: string };

/**
 * Coverage travels with the station, so the picker can say what the provider
 * can actually reach before a watch is created. Computed here rather than in
 * the client: the Wanderu id table is provider-side knowledge and has no
 * business in a browser bundle.
 */
function withCoverage(stations: StationRow[]) {
  return stations.map((station) => ({
    ...station,
    coverage: stationCoverage(station.code),
  }));
}

/* Open, and the catalog first.
 *
 * This used to answer 401 without a session, which was fine while the only
 * station picker sat behind the login. /fares is public, so a logged-out
 * visitor on the page built for exactly that case could not search for a
 * station and had to know the three-letter code — the autocomplete failed
 * silently, which is the worst way for it to fail. Station names are public
 * facts about a railway; there is nothing here to protect.
 *
 * The order is also reversed. The catalog is 189 stations already in memory,
 * so it answers a keystroke without a round trip to Postgres, and the database
 * is consulted only when the catalog has nothing — which is where a station
 * added after this build would live. That takes the database out of the hot
 * path of an endpoint anyone can now call, which is the other half of opening
 * it up.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = stationQuerySchema.parse({ q: url.searchParams.get("q") ?? "" });
  const q = parsed.q.toLowerCase();

  const local = STATIONS.filter((station) =>
    `${station.code} ${station.name} ${station.city} ${station.state}`.toLowerCase().includes(q),
  ).slice(0, 8);
  /* The catalog is the whole answer now.
   *
   * There used to be a database fallback for queries the catalog could not
   * match, wrapped in a try/catch that swallowed any failure — so on the
   * overwhelming majority of searches it did nothing, and on the rest it
   * was best-effort. 194 stations ship with the build, which means this
   * picker cannot go stale between deploys and cannot be down. */
  return NextResponse.json(
    { stations: withCoverage(local) },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
