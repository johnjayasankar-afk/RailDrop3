import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";

type LaunchOptions = {
  headless?: boolean;
  channel?: string;
  args?: string[];
  executablePath?: string;
};

type PlaywrightBrowser = {
  isConnected?: () => boolean;
  newContext: (options?: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

type ChromiumModule = {
  launch: (options?: LaunchOptions) => Promise<PlaywrightBrowser>;
  executablePath: () => string;
};

const LAUNCH_ARGS = ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"];

let installPromise: Promise<boolean> | null = null;
let installSucceeded = false;

export function isServerlessRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function sanitizeProviderError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("executable doesn't exist") ||
    lower.includes("playwright was just installed") ||
    lower.includes("browserType.launch") ||
    lower.includes("npx playwright install") ||
    lower.includes("could not find chromium") ||
    lower.includes("libnss3") ||
    lower.includes("error while loading shared libraries") ||
    // Read-only filesystem on a serverless cold start: the browser cache could
    // not be created. Operationally the same thing as "not installed yet".
    lower.includes("mkdir") ||
    lower.includes("erofs") ||
    lower.includes("read-only file system")
  ) {
    return "Browser for live fares is still setting up. Recheck in a minute.";
  }
  if (lower.includes("timeout") || lower.includes("navigation") || lower.includes("timed out")) {
    return "Live fare search timed out. Recheck in a minute.";
  }
  if (lower.includes("wanderu returned no trip data")) {
    return "No live trips came back for this window. Recheck in a minute.";
  }
  if (
    lower.includes("net::err") ||
    lower.includes("cloudflare") ||
    lower.includes("just a moment")
  ) {
    return "Live fare site blocked this check. Recheck in a minute.";
  }
  // Never dump stack / box-drawing installer essays into the UI.
  const firstLine = message.split("\n")[0]?.trim() ?? "Live fare search failed";
  if (firstLine.length > 140) return `${firstLine.slice(0, 137)}…`;
  return firstLine;
}

/**
 * Launch Chromium for fare scraping.
 * Local: Playwright browsers from `.playwright`.
 * Vercel/Lambda: @sparticuz/chromium + puppeteer-core (Playwright CDP wrapper).
 */
export async function launchChromium(): Promise<PlaywrightBrowser> {
  pinBrowsersPath();

  // Optional hosted browser (Browserless / Browserbase / etc.) — most reliable on Vercel
  // when Cloudflare blocks datacenter IPs. Example:
  // BROWSER_WS_ENDPOINT=wss://chrome.browserless.io?token=...
  const remote = process.env.BROWSER_WS_ENDPOINT?.trim();
  if (remote) {
    try {
      const { chromium } = await import("playwright-core");
      logger.info("provider.remote_browser_connect", { endpointHost: safeWsHost(remote) });
      try {
        return (await chromium.connectOverCDP(remote)) as unknown as PlaywrightBrowser;
      } catch {
        return (await chromium.connect(remote)) as unknown as PlaywrightBrowser;
      }
    } catch (error) {
      logger.error("provider.remote_browser_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      // Fall through to local/serverless launch.
    }
  }

  if (isServerlessRuntime()) {
    try {
      const serverless = await launchServerlessChromium();
      if (serverless) return serverless;
    } catch (error) {
      logger.error("provider.serverless_chromium_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw toProviderError(error);
    }
  }

  const { chromium } = await import("playwright");
  const attempts: LaunchOptions[] = [
    { headless: true, args: LAUNCH_ARGS },
    { headless: true, channel: "chrome", args: LAUNCH_ARGS },
    { headless: true, channel: "chromium", args: LAUNCH_ARGS },
  ];

  let lastError: unknown;
  for (const options of attempts) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastError = error;
      if (!isMissingBrowser(error)) throw toProviderError(error);
    }
  }

  const installed = await ensureChromiumInstalled();
  if (installed) {
    try {
      return await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    } catch (error) {
      lastError = error;
    }
  }

  try {
    return await chromium.launch({ headless: true, channel: "chrome", args: LAUNCH_ARGS });
  } catch (error) {
    lastError = error;
  }

  throw toProviderError(lastError);
}

async function launchServerlessChromium(): Promise<PlaywrightBrowser | null> {
  // Bundled for Vercel — no Playwright postinstall browser download required.
  const sparticuzMod = (await import("@sparticuz/chromium")) as {
    default?: SparticuzChromium;
  } & SparticuzChromium;
  const chromiumPkg = sparticuzMod.default ?? sparticuzMod;
  if (!chromiumPkg.executablePath) return null;

  try {
    chromiumPkg.setGraphicsMode = false;
  } catch {
    // older builds may not expose the setter
  }

  const executablePath = await chromiumPkg.executablePath();
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error(`Serverless Chromium missing at ${executablePath || "(empty)"}`);
  }

  const bundled = chromiumPkg.args ?? [];
  const withoutSingleProcess = bundled.filter((arg) => arg !== "--single-process");

  /* Four ways to start it, and each one is made to prove it works.
   *
   * The deployed app failed with "Protocol error (Target.createTarget): Target
   * closed" on every search. Launching succeeded; what failed was the next
   * step. The provider asks for a context and then a page, and each of those is
   * a new target — which Chromium cannot create when it is running with
   * --single-process, a flag @sparticuz/chromium includes by default (its own
   * comment says it is there to avoid `prctl(PR_SET_NO_NEW_PRIVS) failed`, which
   * --no-sandbox and --disable-setuid-sandbox, both also present, already
   * handle). So the browser died the first time it was asked for a page, and it
   * died the same way every time: this was never intermittent.
   *
   * We also were not following either pairing the package documents. Its
   * puppeteer example passes `defaultArgs({ args, headless: "shell" })` with
   * `headless: "shell"`; we passed the raw args with `headless: true`, so
   * puppeteer added a second, different headless flag on top of the
   * `--headless='shell'` already in the list. Its playwright example is our
   * exact newContext/newPage usage, and we only reached that path if puppeteer
   * threw — which it did not.
   *
   * Rather than pick the one right combination from a laptop that cannot
   * reproduce the runtime, each candidate is smoke-tested against the operation
   * that actually broke — open a context, open a page — and the first one that
   * survives is used. Which one won is logged, because that is the fact worth
   * having the next time this moves.
   */
  type Strategy = { name: string; open: () => Promise<PlaywrightBrowser> };
  const strategies: Strategy[] = [
    {
      // The package's documented Playwright pairing, and our own calling style.
      name: "playwright-core",
      open: async () => {
        const { chromium } = await import("playwright-core");
        return (await chromium.launch({
          args: [...bundled, ...LAUNCH_ARGS],
          executablePath,
          headless: true,
        })) as unknown as PlaywrightBrowser;
      },
    },
    {
      name: "playwright-core+multiprocess",
      open: async () => {
        const { chromium } = await import("playwright-core");
        return (await chromium.launch({
          args: [...withoutSingleProcess, ...LAUNCH_ARGS],
          executablePath,
          headless: true,
        })) as unknown as PlaywrightBrowser;
      },
    },
    {
      // The package's documented Puppeteer pairing, this time actually followed.
      name: "puppeteer-core",
      open: async () => {
        const puppeteer = await import("puppeteer-core");
        const args = await puppeteer.default.defaultArgs({
          args: [...bundled, ...LAUNCH_ARGS],
          headless: "shell",
        });
        const browser = await puppeteer.default.launch({
          args,
          defaultViewport: { width: 1440, height: 900 },
          executablePath,
          headless: "shell",
        });
        return wrapPuppeteerBrowser(browser as unknown as PuppeteerBrowserLike);
      },
    },
    {
      name: "puppeteer-core+multiprocess",
      open: async () => {
        const puppeteer = await import("puppeteer-core");
        const browser = await puppeteer.default.launch({
          args: [...withoutSingleProcess, ...LAUNCH_ARGS],
          defaultViewport: { width: 1440, height: 900 },
          executablePath,
          headless: "shell",
        });
        return wrapPuppeteerBrowser(browser as unknown as PuppeteerBrowserLike);
      },
    },
  ];

  let lastError: unknown = null;
  for (const strategy of strategies) {
    let browser: PlaywrightBrowser | null = null;
    try {
      browser = await strategy.open();
      await proveItCanOpenAPage(browser);
      logger.info("provider.serverless_chromium_launch", {
        strategy: strategy.name,
        executablePath,
      });
      return browser;
    } catch (error) {
      lastError = error;
      logger.warn("provider.serverless_chromium_strategy_failed", {
        strategy: strategy.name,
        message: error instanceof Error ? error.message.split("\n")[0] : String(error),
      });
      await browser?.close().catch(() => undefined);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No serverless Chromium configuration could open a page");
}

/**
 * The check that would have caught this on the first deploy.
 *
 * A launch that returns a browser object proves nothing: the failure was one
 * step later, when the first context and page were created. So a candidate is
 * only accepted once it has done exactly that and cleaned up after itself.
 */
async function proveItCanOpenAPage(browser: PlaywrightBrowser): Promise<void> {
  /* newContext is typed Promise<unknown> because the puppeteer wrapper and the
     real Playwright browser only agree on the shape used here. */
  const context = (await browser.newContext({})) as {
    newPage: () => Promise<{ close?: () => Promise<void> }>;
    close?: () => Promise<void>;
  };
  try {
    /* Twice, sequentially, because that is the shape of the real work: the
       provider opens a page per date and closes it. Under --single-process the
       first target can succeed and the second kill the browser, so a one-page
       check would hand back a configuration that fails on the second date. */
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const page = await context.newPage();
      await page.close?.().catch(() => undefined);
    }
  } finally {
    await context.close?.().catch(() => undefined);
  }
}

type SparticuzChromium = {
  args?: string[];
  executablePath?: () => Promise<string>;
  setGraphicsMode?: boolean;
};

type PuppeteerBrowserLike = {
  connected?: boolean;
  isConnected?: () => boolean;
  createBrowserContext?: () => Promise<PuppeteerContextLike>;
  newPage: () => Promise<PuppeteerPageLike>;
  close: () => Promise<void>;
};

type PuppeteerContextLike = {
  newPage: () => Promise<PuppeteerPageLike>;
  close: () => Promise<void>;
};

type PuppeteerPageLike = {
  setUserAgent?: (ua: string) => Promise<void>;
  setExtraHTTPHeaders?: (headers: Record<string, string>) => Promise<void>;
  setViewport?: (viewport: { width: number; height: number }) => Promise<void>;
  goto: (
    url: string,
    options?: { waitUntil?: string | string[]; timeout?: number },
  ) => Promise<unknown>;
  waitForFunction: (
    fn: (...args: unknown[]) => unknown,
    options?: { timeout?: number },
    ...args: unknown[]
  ) => Promise<unknown>;
  evaluate: <T>(fn: (...args: unknown[]) => T | Promise<T>, ...args: unknown[]) => Promise<T>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  close: () => Promise<void>;
};

/**
 * Adapt puppeteer-core to the small Playwright-shaped surface WanderuBrowserProvider uses.
 */
function wrapPuppeteerBrowser(browser: PuppeteerBrowserLike): PlaywrightBrowser {
  return {
    isConnected: () => {
      if (typeof browser.isConnected === "function") return browser.isConnected();
      return browser.connected !== false;
    },
    newContext: async (options?: Record<string, unknown>) => {
      const context =
        typeof browser.createBrowserContext === "function"
          ? await browser.createBrowserContext()
          : null;
      const userAgent =
        typeof options?.userAgent === "string"
          ? options.userAgent
          : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
      const extraHeaders =
        options?.extraHTTPHeaders && typeof options.extraHTTPHeaders === "object"
          ? (options.extraHTTPHeaders as Record<string, string>)
          : { "Accept-Language": "en-US,en;q=0.9" };
      const viewport =
        options?.viewport && typeof options.viewport === "object"
          ? (options.viewport as { width: number; height: number })
          : { width: 1440, height: 900 };

      return {
        newPage: async () => {
          const page = context ? await context.newPage() : await browser.newPage();
          await page.setUserAgent?.(userAgent);
          await page.setExtraHTTPHeaders?.(extraHeaders);
          await page.setViewport?.(viewport);
          return wrapPuppeteerPage(page);
        },
        close: async () => {
          await context?.close().catch(() => undefined);
        },
      };
    },
    close: () => browser.close(),
  };
}

function wrapPuppeteerPage(page: PuppeteerPageLike) {
  return {
    goto: (url: string, options?: { waitUntil?: string; timeout?: number }) =>
      page.goto(url, {
        waitUntil: (options?.waitUntil as "domcontentloaded") ?? "domcontentloaded",
        timeout: options?.timeout ?? 45000,
      }),
    waitForFunction: (fn: () => unknown, _arg?: unknown, options?: { timeout?: number }) =>
      page.waitForFunction(fn, { timeout: options?.timeout ?? 35000 }),
    evaluate: <T>(fn: () => T) => page.evaluate(fn),
    on: (
      event: "response",
      handler: (response: { url: () => string; json: () => Promise<unknown> }) => void,
    ) => {
      page.on("response", (response: unknown) => {
        const res = response as {
          url: () => string;
          json: () => Promise<unknown>;
        };
        handler({
          url: () => res.url(),
          json: () => res.json(),
        });
      });
    },
    close: () => page.close(),
  };
}

export function pinBrowsersPath(): string {
  const current = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (current && browserTreeLooksReady(current)) {
    return current;
  }

  // On Vercel the deployment bundle is mounted read-only at /var/task, which is
  // also the working directory. Joining cwd there produced /var/task/.playwright
  // and mkdirSync threw EROFS/ENOENT on every cold start — the live-fare path
  // failed before a browser was ever launched. Only /tmp is writable.
  const onVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
  const local = onVercel
    ? path.join("/tmp", ".playwright")
    : path.join(process.cwd(), ".playwright");

  if (browserTreeLooksReady(local)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = local;
    return local;
  }

  // Prefer the durable project folder over a temp sandbox cache. A failure here
  // is not fatal: Playwright may still find a browser through its own defaults,
  // and the launch error is the honest place to report it.
  try {
    fs.mkdirSync(local, { recursive: true });
  } catch {
    // read-only filesystem — fall through with the path set anyway
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH = local;
  return local;
}

function browserTreeLooksReady(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some((name) => name.startsWith("chromium"));
  } catch {
    return false;
  }
}

function isMissingBrowser(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("browserType.launch") ||
    message.toLowerCase().includes("playwright was just installed")
  );
}

function toProviderError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(sanitizeProviderError(message));
}

async function ensureChromiumInstalled(): Promise<boolean> {
  if (installSucceeded) return true;
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const browsersPath = pinBrowsersPath();
    logger.info("provider.playwright_install_start", { browsersPath });
    try {
      await runPlaywrightInstall(browsersPath);
      const { chromium } = (await import("playwright")) as unknown as { chromium: ChromiumModule };
      const exe = chromium.executablePath();
      const ok = Boolean(exe && fs.existsSync(exe));
      logger.info("provider.playwright_install_done", { ok, exe });
      return ok;
    } catch (error) {
      logger.error("provider.playwright_install_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  })();
  const ok = await installPromise;
  if (ok) {
    installSucceeded = true;
  } else {
    installPromise = null;
  }
  return ok;
}

function runPlaywrightInstall(browsersPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["playwright", "install", "chromium"], {
      cwd: process.cwd(),
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Playwright install timed out"));
    }, 180_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Playwright install exited ${code ?? "null"}`));
    });
  });
}

function safeWsHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid-ws-url";
  }
}
