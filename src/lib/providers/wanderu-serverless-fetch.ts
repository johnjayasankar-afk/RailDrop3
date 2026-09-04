import type { FareSearchRequest } from "@/lib/domain/types";
import { logger } from "@/lib/logger";
import { wanderuSearchLabel } from "./wanderu-station-map";
import type { WanderuTrip } from "./wanderu-normalizer";
import { pinBrowsersPath, resolveChromiumPackUrl } from "./playwright-launch";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

type PuppeteerBrowser = {
  connected?: boolean;
  newPage: () => Promise<PuppeteerPage>;
  close: () => Promise<void>;
};

type PuppeteerPage = {
  setUserAgent: (ua: string) => Promise<void>;
  setExtraHTTPHeaders: (headers: Record<string, string>) => Promise<void>;
  goto: (
    url: string,
    options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle0" | "networkidle2"; timeout?: number },
  ) => Promise<unknown>;
  waitForFunction: (
    pageFunction: string | ((...args: unknown[]) => unknown),
    options?: { timeout?: number },
  ) => Promise<unknown>;
  evaluate: <T>(pageFunction: (...args: unknown[]) => T | Promise<T>) => Promise<T>;
  on: (event: "response", handler: (response: PuppeteerResponse) => void) => void;
  title: () => Promise<string>;
  close: () => Promise<void>;
};

type PuppeteerResponse = {
  url: () => string;
  json: () => Promise<unknown>;
};

/**
 * Vercel-safe Wanderu fetch: native puppeteer-core + chromium-min.
 * No Playwright adapter, no createBrowserContext, fresh browser per call.
 */
export async function fetchWanderuTripsServerless(
  request: FareSearchRequest,
): Promise<WanderuTrip[]> {
  pinBrowsersPath();
  const browser = await launchServerlessPuppeteer();
  try {
    return await scrapeWithBrowser(browser, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // One hard retry with a brand-new browser on CDP death.
    if (/connection closed|target closed|session closed|browser has disconnected/i.test(message)) {
      logger.warn("provider.serverless_retry_fresh_browser", { message });
      const retryBrowser = await launchServerlessPuppeteer();
      try {
        return await scrapeWithBrowser(retryBrowser, request);
      } finally {
        await retryBrowser.close().catch(() => undefined);
      }
    }
    throw error;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function healthCheckServerlessChromium(): Promise<{
  ok: boolean;
  message: string;
  latencyMs: number;
}> {
  const started = Date.now();
  pinBrowsersPath();
  let browser: PuppeteerBrowser | null = null;
  try {
    browser = await launchServerlessPuppeteer();
    const page = await browser.newPage();
    await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.close().catch(() => undefined);
    return {
      ok: true,
      message: "Wanderu serverless Chromium ready",
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Serverless Chromium failed",
      latencyMs: Date.now() - started,
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function launchServerlessPuppeteer(): Promise<PuppeteerBrowser> {
  const remote = process.env.BROWSER_WS_ENDPOINT?.trim();
  if (remote) {
    const puppeteer = await import("puppeteer-core");
    logger.info("provider.serverless_remote_connect", { host: safeHost(remote) });
    return (await puppeteer.default.connect({
      browserWSEndpoint: remote,
    })) as unknown as PuppeteerBrowser;
  }

  const sparticuzMod = (await import("@sparticuz/chromium-min")) as {
    default?: {
      args: string[];
      executablePath: (input?: string) => Promise<string>;
      setGraphicsMode?: boolean;
    };
    args?: string[];
    executablePath?: (input?: string) => Promise<string>;
    setGraphicsMode?: boolean;
  };
  const chromium = sparticuzMod.default ?? sparticuzMod;
  if (!chromium.executablePath) {
    throw new Error("chromium-min executablePath missing");
  }
  try {
    chromium.setGraphicsMode = false;
  } catch {
    // ignore
  }

  const packUrl = resolveChromiumPackUrl();
  const executablePath = await chromium.executablePath(packUrl);
  const puppeteer = await import("puppeteer-core");

  // Use Sparticuz args as-is. Extra flags have caused CDP "Connection closed" on Vercel.
  const browser = await puppeteer.default.launch({
    args: chromium.args ?? [],
    defaultViewport: { width: 1280, height: 720 },
    executablePath,
    headless: true,
    acceptInsecureCerts: true,
  });
  return browser as unknown as PuppeteerBrowser;
}

async function scrapeWithBrowser(
  browser: PuppeteerBrowser,
  request: FareSearchRequest,
): Promise<WanderuTrip[]> {
  const page = await browser.newPage();
  const intercepted: WanderuTrip[] = [];
  let resolveNetwork: () => void = () => undefined;
  const networkReady = new Promise<void>((resolve) => {
    resolveNetwork = resolve;
  });

  page.on("response", (response) => {
    void capturePsearch(response, intercepted).then((added) => {
      if (added) resolveNetwork();
    });
  });

  try {
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    const url = searchUrl(request);
    logger.info("provider.serverless_goto", { url });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 55000 });

    // Wait out Cloudflare interstitial if present.
    await page
      .waitForFunction(
        () => {
          const title = document.title || "";
          return !title.toLowerCase().includes("just a moment");
        },
        { timeout: 25000 },
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
          { timeout: 30000 },
        )
        .catch(() => undefined),
      networkReady,
      sleep(30000),
    ]);

    let fromState = await readInitialState(page);
    let trips = mergeTrips(fromState, intercepted);
    if (trips.length === 0) {
      await Promise.race([networkReady, sleep(6000)]);
      fromState = await readInitialState(page);
      trips = mergeTrips(fromState, intercepted);
    }
    if (trips.length === 0) {
      const title = await page.title().catch(() => "");
      throw new Error(
        title.toLowerCase().includes("just a moment")
          ? "Live fare site blocked this check. Recheck in a minute."
          : "Wanderu returned no trip data",
      );
    }
    return trips;
  } finally {
    await page.close().catch(() => undefined);
  }
}

function searchUrl(request: FareSearchRequest): string {
  const origin = wanderuSearchLabel(request.originCode);
  const destination = wanderuSearchLabel(request.destinationCode);
  return `https://www.wanderu.com/en-us/depart/${encodeURIComponent(`${origin.city} ${origin.state}`)}/${encodeURIComponent(`${destination.city} ${destination.state}`)}/${request.travelDate}/`;
}

async function readInitialState(page: PuppeteerPage): Promise<WanderuTrip[]> {
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

async function capturePsearch(
  response: PuppeteerResponse,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}
