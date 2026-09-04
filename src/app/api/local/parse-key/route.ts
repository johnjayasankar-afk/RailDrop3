import { NextResponse } from "next/server";
import { applyParseApiKey, getConfig, resetConfigCache } from "@/lib/config";
import { persistParseKey } from "@/lib/local/persist-parse-key";
import { ParseFareProvider } from "@/lib/providers/parse-fare-provider";
import { getSessionUser } from "@/lib/auth/session";

export async function POST(request: Request) {
  const config = getConfig();
  if (!config.isLocal || config.isProduction) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { key?: string };
  const key = body.key?.trim() ?? "";
  if (!key.startsWith("pmx_")) {
    return NextResponse.json(
      { error: "That does not look like a Parse key. It should start with pmx_." },
      { status: 400 },
    );
  }

  applyParseApiKey(key);
  await persistParseKey(key);

  const travelDate = futureDate(21);
  const provider = new ParseFareProvider(key, getConfig().parseScraperId);
  const result = await provider.searchTrips({
    originCode: "BOS",
    destinationCode: "NYP",
    travelDate,
    passengers: { adultCount: 1 },
  });

  if (result.status === "PROVIDER_ERROR") {
    process.env.PARSE_API_KEY = "";
    resetConfigCache();
    return NextResponse.json(
      {
        ok: false,
        error: result.providerError?.message ?? "Parse rejected the live search",
      },
      { status: 400 },
    );
  }

  const first = result.journeys[0];
  const firstFare = first?.fares.find((fare) => fare.totalPartyPriceCents !== null);
  return NextResponse.json({
    ok: true,
    live: true,
    travelDate,
    journeyCount: result.journeys.length,
    sample: first
      ? {
          serviceName: first.serviceName,
          trainNumber: first.trainNumber,
          departureAt: first.departureAt,
          priceCents: firstFare?.totalPartyPriceCents ?? null,
          fareFamily: firstFare?.fareFamily ?? null,
        }
      : null,
  });
}

function futureDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
