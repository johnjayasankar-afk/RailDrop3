import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/services";
import { stationQuerySchema } from "@/lib/validation/watch";
import { STATIONS } from "@/lib/stations/catalog";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const parsed = stationQuerySchema.parse({ q: url.searchParams.get("q") ?? "" });
  try {
    const stations = await getRepository().searchStations(parsed.q);
    if (stations.length > 0) return NextResponse.json({ stations });
  } catch {
    // Fall through to local catalog when the database is not linked yet.
  }
  const q = parsed.q.toLowerCase();
  const stations = STATIONS.filter((station) =>
    `${station.code} ${station.name} ${station.city} ${station.state}`.toLowerCase().includes(q),
  ).slice(0, 8);
  return NextResponse.json({ stations });
}
