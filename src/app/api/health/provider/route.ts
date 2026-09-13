import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getFareProvider } from "@/lib/services";
import { fareProviderStatus } from "@/lib/providers/create-provider";
import { isServerlessRuntime } from "@/lib/providers/playwright-launch";

export const maxDuration = 120;
export const runtime = "nodejs";

/**
 * Live fare plumbing probe for Vercel debugging.
 * GET /api/health/provider
 * GET /api/health/provider?probe=1  — runs one real BOS→NYP search (slow)
 */
export async function GET(request: Request) {
  const config = getConfig();
  const status = fareProviderStatus();
  const url = new URL(request.url);
  const wantProbe = url.searchParams.get("probe") === "1";
  const provider = getFareProvider();

  const health = await provider.healthCheck();
  const payload: Record<string, unknown> = {
    ok: health.ok,
    app: "raildrop",
    serverless: isServerlessRuntime(),
    localMode: config.isLocal,
    provider: status.provider,
    health,
    tip: "Add ?probe=1 to run one live BOS→NYP search (can take up to ~60s).",
  };

  if (wantProbe) {
    const travelDate = url.searchParams.get("date") ?? nextWeekdayIso();
    const started = Date.now();
    const result = await provider.searchTrips({
      originCode: "BOS",
      destinationCode: "NYP",
      travelDate,
      passengers: { adultCount: 1 },
    });
    payload.probe = {
      travelDate,
      status: result.status,
      journeys: result.journeys.length,
      latencyMs: Date.now() - started,
      error: result.providerError?.message ?? null,
      sample:
        result.journeys[0] != null
          ? {
              departureAt: result.journeys[0].departureAt,
              priceCents: result.journeys[0].fares[0]?.observedPriceCents ?? null,
              trainNumber: result.journeys[0].trainNumber ?? null,
            }
          : null,
    };
    payload.ok = result.status !== "PROVIDER_ERROR";
  }

  return NextResponse.json(payload, { status: payload.ok ? 200 : 503 });
}

function nextWeekdayIso(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}
