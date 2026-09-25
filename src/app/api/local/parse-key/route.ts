import { NextResponse } from "next/server";
import { applyParseApiKey, getConfig } from "@/lib/config";
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

  // Prove the key works before writing it anywhere. The previous order wrote
  // it to .env.local first, so a key Parse rejected was left on disk with no
  // compensating delete, and the next start-up picked the bad key back up.
  const travelDate = futureDate(21);
  const provider = new ParseFareProvider(key, getConfig().parseScraperId);
  const result = await provider.searchTrips({
    originCode: "BOS",
    destinationCode: "NYP",
    travelDate,
    passengers: { adultCount: 1 },
  });

  if (result.status === "PROVIDER_ERROR") {
    return NextResponse.json(
      {
        ok: false,
        error: result.providerError?.message ?? "Parse rejected the live search",
      },
      { status: 400 },
    );
  }

  applyParseApiKey(key);
  try {
    await persistParseKey(key);
  } catch (error) {
    // The key is live in this process either way; only the write to disk
    // failed, so say so rather than returning a 500 that implies the key was
    // bad. A read-only filesystem is the usual cause.
    return NextResponse.json({
      ok: true,
      live: true,
      persisted: false,
      travelDate,
      warning: `The key works but could not be saved to .env.local: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    });
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
