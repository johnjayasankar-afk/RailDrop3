import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { FareSearchRequest, FareSearchResult, Station } from "@/lib/domain/types";
import { DEFAULT_PROVIDER_ID } from "@/lib/domain/search-key";
import { FareProvider, ProviderNotConfiguredError, ProviderRequestError } from "./fare-provider";
import { normalizeParseSearch } from "./parse-normalizer";
import { isTransientProviderFailure, withRetry } from "./retry";

const PARSE_BASE = "https://api.parse.bot";

export class ParseFareProvider implements FareProvider {
  readonly id = DEFAULT_PROVIDER_ID;

  constructor(
    private readonly apiKey = getConfig().parseApiKey,
    private readonly scraperId = getConfig().parseScraperId,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    if (!this.apiKey) {
      throw new ProviderNotConfiguredError("PARSE_API_KEY is not configured");
    }

    try {
      const { json, creditsCharged } = await withRetry(
        () =>
          this.execute("POST", "search_trains", {
            origin: request.originCode,
            destination: request.destinationCode,
            departure_date: request.travelDate,
            num_adults: request.passengers.adultCount,
          }),
        {
          maxAttempts: 3,
          baseDelayMs: 400,
          maxDelayMs: 4000,
          retryable: isTransientProviderFailure,
        },
      );

      const metadata = {
        provider: this.id,
        requestId,
        retrievedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        creditsCharged,
      };
      const normalized = normalizeParseSearch(json, request, metadata);
      const noInventory = normalized.journeys.length === 0;
      logger.info("provider.search", {
        requestId,
        origin: request.originCode,
        destination: request.destinationCode,
        travelDate: request.travelDate,
        journeys: normalized.journeys.length,
        failures: normalized.failures.length,
        latencyMs: metadata.latencyMs,
        creditsCharged,
      });

      return {
        request,
        status: noInventory ? "NO_INVENTORY" : "SUCCESS",
        journeys: normalized.journeys,
        metadata,
      };
    } catch (error) {
      const retryable = isTransientProviderFailure(error);
      const message = error instanceof Error ? error.message : "Unknown provider error";
      logger.error("provider.search_failed", {
        requestId,
        origin: request.originCode,
        destination: request.destinationCode,
        travelDate: request.travelDate,
        retryable,
        message,
      });
      return {
        request,
        status: "PROVIDER_ERROR",
        journeys: [],
        providerError: {
          code: error instanceof ProviderRequestError ? error.code : "provider_error",
          message,
          retryable,
        },
        metadata: {
          provider: this.id,
          requestId,
          retrievedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          creditsCharged: 0,
        },
      };
    }
  }

  async getStations(): Promise<Station[]> {
    const { json } = await this.execute("GET", "get_stations");
    const payload = unwrapData(json);
    const stations = Array.isArray(payload.stations) ? payload.stations : [];
    return stations.map((item) => {
      const record = item as Record<string, unknown>;
      const code = String(record.stationCode ?? record.station_code ?? "").toUpperCase();
      return {
        code,
        name: code,
        city: "",
        state: "",
        country: "US",
      };
    });
  }

  async autocompleteStations(term: string): Promise<Station[]> {
    const { json } = await this.execute("GET", "get_station_autocomplete", { term });
    const payload = unwrapData(json);
    const results = Array.isArray(payload.results) ? payload.results : [];
    return results.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        code: String(record.stationCode ?? "").toUpperCase(),
        name: String(record.displayName ?? record.stationCode ?? ""),
        city: String(record.city ?? ""),
        state: String(record.state ?? ""),
        country: "US",
        latitude: typeof record.latitude === "number" ? record.latitude : null,
        longitude: typeof record.longitude === "number" ? record.longitude : null,
      };
    });
  }

  async healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const started = Date.now();
    if (!this.apiKey) {
      return { ok: false, message: "PARSE_API_KEY missing", latencyMs: 0 };
    }
    try {
      await this.execute("GET", "get_support_info");
      return {
        ok: true,
        message: "Parse amtrak-com-api reachable",
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Parse health check failed",
        latencyMs: Date.now() - started,
      };
    }
  }

  private async execute(
    method: "GET" | "POST",
    endpoint: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<{ json: unknown; creditsCharged: number | null }> {
    if (!this.apiKey) {
      throw new ProviderNotConfiguredError("PARSE_API_KEY is not configured");
    }

    const url = new URL(`${PARSE_BASE}/scraper/${this.scraperId}/${endpoint}`);
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
    };
    let body: string | undefined;
    if (method === "GET" && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    } else if (method === "POST") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(params ?? {});
    }

    const response = await this.fetchImpl(url, { method, headers, body });
    const creditsCharged = parseCredits(response.headers.get("X-Credits-Charged"));
    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const status = response.status;
      const blocked = isParseBlocked(json);
      const retryAfter = extractRetryAfter(json);
      // Akamai blocks are retryable later, but not in a tight loop — Parse already
      // burned its proxy attempts. Wait for retry_after on the next scheduled check.
      const retryable = !blocked && (status === 429 || status >= 500 || status === 503);
      throw new ProviderRequestError(
        extractErrorMessage(json) ?? `Parse ${endpoint} failed with ${status}`,
        status === 429 ? "rate_limited" : status === 401 ? "unauthorized" : blocked ? "blocked" : "http_error",
        retryable,
        status,
        retryAfter,
      );
    }

    return { json, creditsCharged };
  }
}

function parseCredits(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unwrapData(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== "object") return {};
  const record = json as Record<string, unknown>;
  if (record.data && typeof record.data === "object") {
    return record.data as Record<string, unknown>;
  }
  return record;
}

function extractErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const record = json as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  if (typeof record.message === "string") return record.message;
  return null;
}

function isParseBlocked(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const record = json as Record<string, unknown>;
  const nested = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : record;
  return nested.status === "blocked" || nested.block_type === "akamai" || record.status === "blocked";
}

function extractRetryAfter(json: unknown): number | undefined {
  if (!json || typeof json !== "object") return undefined;
  const record = json as Record<string, unknown>;
  const nested = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : record;
  const value = Number(nested.retry_after ?? record.retry_after);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
