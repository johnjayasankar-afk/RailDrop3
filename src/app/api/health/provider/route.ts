import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { operatorAuthorized } from "@/lib/auth/operator";
import { getFareProvider } from "@/lib/services";
import { fareProviderStatus } from "@/lib/providers/create-provider";
import { isServerlessRuntime } from "@/lib/providers/playwright-launch";

export const maxDuration = 120;
export const runtime = "nodejs";

/**
 * Live fare plumbing probe for Vercel debugging.
 * GET /api/health/provider
 * GET /api/health/provider?probe=1  — runs one real BOS→NYP search (slow)
 *
 * The probe spends real money. It launches Chromium and runs a live search,
 * and on the Parse path each call bills PROVIDER_CREDITS_PER_SEARCH. Until now
 * it was open to anyone who knew the URL: an anonymous loop against it would
 * drain the month's credit budget and, with maxDuration 120 and 3 GB of
 * memory, cost compute on every hit. The unauthenticated response is now
 * limited to booleans that say whether the plumbing is configured; actually
 * firing a search requires the operator credential.
 */
export async function GET(request: Request) {
  const config = getConfig();
  const status = fareProviderStatus();
  const url = new URL(request.url);
  const wantProbe = url.searchParams.get("probe") === "1";
  if (wantProbe && !operatorAuthorized(request, config)) {
    return NextResponse.json(
      { error: "The live probe spends provider credits and requires CRON_SECRET." },
      { status: 401 },
    );
  }
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
