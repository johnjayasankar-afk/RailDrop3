import { STATIONS } from "@/lib/stations/catalog";
import { DEFAULT_PROVIDER_ID } from "@/lib/domain/search-key";
import type { FareSearchRequest, FareSearchResult, Station } from "@/lib/domain/types";
import { FareProvider, ProviderRequestError } from "./fare-provider";
import { logger } from "@/lib/logger";
import { withRetry } from "./retry";
import { normalizeWanderuTrips, type WanderuTrip } from "./wanderu-normalizer";
import { wanderuSearchLabel } from "./wanderu-station-map";
import {
  isServerlessRuntime,
  launchChromium,
  sanitizeProviderError,
} from "./playwright-launch";

type PlaywrightBrowser = {
  isConnected?: () => boolean;
  newContext: (options?: Record<string, unknown>) => Promise<PlaywrightContext>;
  close: () => Promise<void>;
};
type PlaywrightContext = {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
};
type PlaywrightPage = {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  waitForFunction: (
    fn: () => unknown,
    arg?: unknown,
    options?: { timeout?: number },
  ) => Promise<unknown>;
  evaluate: <T>(fn: () => T) => Promise<T>;
  on: (event: "response", handler: (response: PlaywrightResponse) => void) => void;
  close: () => Promise<void>;
};
type PlaywrightResponse = {
  url: () => string;
  json: () => Promise<unknown>;
};

const MAX_CONCURRENT_PAGES = isServerlessRuntime() ? 1 : 3;
const PAGE_GOTO_TIMEOUT_MS = isServerlessRuntime() ? 55000 : 45000;
const TRIP_WAIT_MS = isServerlessRuntime() ? 28000 : 35000;
const EXTRA_WAIT_MS = isServerlessRuntime() ? 5000 : 8000;

const globalBrowser = globalThis as unknown as {
  __raildropWanderuBrowser?: PlaywrightBrowser | null;
  __raildropWanderuContext?: PlaywrightContext | null;
  __raildropWanderuActive?: number;
  __raildropWanderuWait?: Array<() => void>;
  __raildropWanderuPlaces?: Record<string, { pathCity: string; query: string }>;
};

export class WanderuBrowserProvider implements FareProvider {
  readonly id = DEFAULT_PROVIDER_ID;

  async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    try {
      const trips = await this.withSlot(() =>
        withRetry(() => this.fetchTrips(request), {
          maxAttempts: isServerlessRuntime() ? 2 : 3,
          baseDelayMs: 800,
          maxDelayMs: 2500,
          retryable: (error) => isRetryableWanderuError(error),
        }),
      );
      const metadata = {
        provider: this.id,
        requestId,
        retrievedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        creditsCharged: 0,
      };
      let journeys = normalizeWanderuTrips(trips, request, metadata);
      if (journeys.length === 0) {
        journeys = normalizeWanderuTrips(trips, request, metadata, { relaxStationMatch: true });
        if (journeys.length > 0) {
          logger.warn("provider.station_filter_relaxed", {
            requestId,
            origin: request.originCode,
            destination: request.destinationCode,
            travelDate: request.travelDate,
            journeys: journeys.length,
          });
        }
      }
      logger.info("provider.search", {
        requestId,
        origin: request.originCode,
        destination: request.destinationCode,
        travelDate: request.travelDate,
        wanderuTrips: trips.length,
        journeys: journeys.length,
        latencyMs: metadata.latencyMs,
        source: isServerlessRuntime() ? "wanderu-serverless" : "wanderu-browser",
      });
      return {
        request,
        status: journeys.length === 0 ? "NO_INVENTORY" : "SUCCESS",
        journeys,
        metadata,
      };
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Wanderu search failed";
      const message = sanitizeProviderError(raw);
      logger.error("provider.search_failed", {
        requestId,
        origin: request.originCode,
        destination: request.destinationCode,
        travelDate: request.travelDate,
        retryable: true,
        message: raw,
        userMessage: message,
        source: isServerlessRuntime() ? "wanderu-serverless" : "wanderu-browser",
      });
      return {
        request,
        status: "PROVIDER_ERROR",
        journeys: [],
        providerError: {
          code: error instanceof ProviderRequestError ? error.code : "provider_error",
          message,
          retryable: true,
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
    return STATIONS.map((station) => ({
      ...station,
      country: "US",
    }));
  }

  async healthCheck() {
    const started = Date.now();
    try {
      await this.browser();
      return {
        ok: true,
        message: isServerlessRuntime()
          ? "Wanderu serverless Chromium ready"
          : "Wanderu browser fare provider ready",
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        message: sanitizeProviderError(
          error instanceof Error ? error.message : "Playwright unavailable",
        ),
        latencyMs: Date.now() - started,
      };
    }
  }

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    const gate = globalBrowser;
    gate.__raildropWanderuActive ??= 0;
    gate.__raildropWanderuWait ??= [];
    if (gate.__raildropWanderuActive >= MAX_CONCURRENT_PAGES) {
      await new Promise<void>((resolve, reject) => {
        const entry = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          const queue = gate.__raildropWanderuWait!;
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          reject(new Error("Live fare search queued too long. Recheck in a minute."));
        }, 120_000);
        gate.__raildropWanderuWait!.push(entry);
      });
    }
    gate.__raildropWanderuActive += 1;
    try {
      return await fn();
    } finally {
      gate.__raildropWanderuActive -= 1;
      gate.__raildropWanderuWait.shift()?.();
    }
  }

  private async fetchTrips(request: FareSearchRequest): Promise<WanderuTrip[]> {
    const url = this.searchUrl(request);
    const context = await this.context();
    const page = await context.newPage();
    const intercepted: WanderuTrip[] = [];
    let sawNetworkTrips = false;
    let resolveNetwork: () => void = () => undefined;
    const networkReady = new Promise<void>((resolve) => {
      resolveNetwork = resolve;
    });
    page.on("response", (response) => {
      void capturePsearch(response, intercepted).then((added) => {
        if (added) {
          sawNetworkTrips = true;
          resolveNetwork();
        }
      });
      // Cache place ids from redirects for faster follow-up dates.
      const responseUrl = response.url();
      if (responseUrl.includes("/en-us/depart/") && responseUrl.includes("dpid=")) {
        cachePlacesFromUrl(request.originCode, request.destinationCode, responseUrl);
      }
    });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_GOTO_TIMEOUT_MS });
      // Cloudflare challenge pages sometimes appear on datacenter IPs (Vercel).
      await page
        .waitForFunction(
          () => {
            const title = document.title || "";
            return !title.toLowerCase().includes("just a moment");
          },
          undefined,
          { timeout: isServerlessRuntime() ? 25000 : 8000 },
        )
        .catch(() => undefined);
      await Promise.race([
        page
          .waitForFunction(
            () => {
              const state = (window as unknown as { __INITIAL_STATE__?: Record<string, unknown> })
                .__INITIAL_STATE__;
              const trips = (
                state?.["DUCKS/TRIPS"] as
                  | { TRIP_DATA?: { trips?: Record<string, unknown> } }
                  | undefined
              )?.TRIP_DATA?.trips;
              return Boolean(trips && Object.keys(trips).length > 0);
            },
            undefined,
            { timeout: TRIP_WAIT_MS },
          )
          .catch(() => undefined),
        networkReady,
        sleep(TRIP_WAIT_MS),
      ]);
      let fromState = await readInitialState(page);
      let trips = mergeTrips(fromState, intercepted);
      if (trips.length === 0) {
        await Promise.race([networkReady, sleep(EXTRA_WAIT_MS)]);
        fromState = await readInitialState(page);
        trips = mergeTrips(fromState, intercepted);
      } else if (!sawNetworkTrips) {
        await sleep(600);
        trips = mergeTrips(fromState, intercepted);
      }
      if (trips.length === 0) {
        throw new Error("Wanderu returned no trip data");
      }
      return trips;
    } catch (error) {
      if (shouldResetBrowser(error)) {
        await this.resetBrowser();
      }
      throw error;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private searchUrl(request: FareSearchRequest): string {
    const origin = wanderuSearchLabel(request.originCode);
    const destination = wanderuSearchLabel(request.destinationCode);
    const cached = globalBrowser.__raildropWanderuPlaces?.[placeCacheKey(request)];
    if (cached) {
      return `https://www.wanderu.com${cached.pathCity}/${request.travelDate}/${cached.query}`;
    }
    return `https://www.wanderu.com/en-us/depart/${encodeURIComponent(`${origin.city} ${origin.state}`)}/${encodeURIComponent(`${destination.city} ${destination.state}`)}/${request.travelDate}/`;
  }

  private async browser(): Promise<PlaywrightBrowser> {
    const existing = globalBrowser.__raildropWanderuBrowser;
    if (existing && existing.isConnected?.() !== false) {
      return existing;
    }
    await this.resetBrowser();
    globalBrowser.__raildropWanderuBrowser =
      (await launchChromium()) as unknown as PlaywrightBrowser;
    return globalBrowser.__raildropWanderuBrowser;
  }

  private async context(): Promise<PlaywrightContext> {
    const existing = globalBrowser.__raildropWanderuContext;
    if (existing && globalBrowser.__raildropWanderuBrowser?.isConnected?.() !== false) {
      return existing;
    }
    const browser = await this.browser();
    globalBrowser.__raildropWanderuContext = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    return globalBrowser.__raildropWanderuContext;
  }

  private async resetBrowser(): Promise<void> {
    const context = globalBrowser.__raildropWanderuContext;
    const current = globalBrowser.__raildropWanderuBrowser;
    globalBrowser.__raildropWanderuContext = null;
    globalBrowser.__raildropWanderuBrowser = null;
    await context?.close().catch(() => undefined);
    await current?.close().catch(() => undefined);
  }
}

async function readInitialState(page: PlaywrightPage): Promise<WanderuTrip[]> {
  return page.evaluate(() => {
    const state = (window as unknown as { __INITIAL_STATE__?: Record<string, unknown> })
      .__INITIAL_STATE__;
    const trips = (
      state?.["DUCKS/TRIPS"] as { TRIP_DATA?: { trips?: Record<string, WanderuTrip> } } | undefined
    )?.TRIP_DATA?.trips;
    return trips ? Object.values(trips) : [];
  });
}

function mergeTrips(fromState: WanderuTrip[], intercepted: WanderuTrip[]): WanderuTrip[] {
  const out: WanderuTrip[] = [];
  const seen = new Set<string>();
  for (const trip of [...fromState, ...intercepted]) {
    const key =
      trip.trip_id ??
      [trip.depart_datetime, trip.arrive_datetime, trip.price, trip.carrier, trip.depart_id].join(
        ":",
      );
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trip);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function capturePsearch(
  response: PlaywrightResponse,
  bucket: WanderuTrip[],
): Promise<boolean> {
  if (!response.url().includes("psearch.json")) return false;
  try {
    const json = (await response.json()) as { result?: unknown };
    const result = json.result;
    const trips = Array.isArray(result)
      ? (result as WanderuTrip[])
      : result && typeof result === "object"
        ? (Object.values(result) as WanderuTrip[])
        : [];
    if (trips.length === 0) return false;
    bucket.push(...trips);
    return true;
  } catch {
    return false;
  }
}

function placeCacheKey(request: Pick<FareSearchRequest, "originCode" | "destinationCode">): string {
  return `${request.originCode}:${request.destinationCode}`.toUpperCase();
}

function cachePlacesFromUrl(originCode: string, destinationCode: string, url: string): void {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/en-us\/depart\/([^/]+)\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/?/);
    if (!match) return;
    const dpid = parsed.searchParams.get("dpid");
    const opid = parsed.searchParams.get("opid");
    if (!dpid || !opid) return;
    globalBrowser.__raildropWanderuPlaces ??= {};
    globalBrowser.__raildropWanderuPlaces[placeCacheKey({ originCode, destinationCode })] = {
      pathCity: `/en-us/depart/${match[1]}/${match[2]}`,
      query: `?dpid=${encodeURIComponent(dpid)}&opid=${encodeURIComponent(opid)}`,
    };
  } catch {
    // ignore malformed URLs
  }
}

function isRetryableWanderuError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("no trip data")) return false;
  if (message.includes("still setting up")) return true;
  return (
    message.includes("timeout") ||
    message.includes("navigation") ||
    message.includes("net::") ||
    message.includes("target closed") ||
    message.includes("browser has been closed") ||
    message.includes("executable doesn't exist") ||
    message.includes("connection") ||
    message.includes("protocol error") ||
    message.includes("crashed")
  );
}

function shouldResetBrowser(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("target closed") ||
    message.includes("browser has been closed") ||
    message.includes("protocol error") ||
    message.includes("executable doesn't exist") ||
    message.includes("crashed") ||
    message.includes("session closed")
  );
}
