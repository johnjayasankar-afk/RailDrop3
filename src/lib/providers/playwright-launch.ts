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
    lower.includes("input directory") ||
    lower.includes("@sparticuz/chromium")
  ) {
    return "Browser for live fares is still setting up. Recheck in a minute.";
  }
  if (lower.includes("timeout") || lower.includes("navigation") || lower.includes("timed out")) {
    return "Live fare search timed out. Recheck in a minute.";
  }
  if (lower.includes("wanderu returned no trip data")) {
    return "No live trips came back for this window. Recheck in a minute.";
  }
  if (lower.includes("net::err") || lower.includes("cloudflare") || lower.includes("just a moment")) {
    return "Live fare site blocked this check. Recheck in a minute.";
  }
  if (lower.includes("enoent") && (lower.includes(".playwright") || lower.includes("mkdir"))) {
    return "Browser for live fares is still setting up. Recheck in a minute.";
  }
  if (lower.includes("connection closed") || lower.includes("target closed")) {
    return "Live fare browser restarted. Recheck in a minute.";
  }
  // Never dump stack / box-drawing installer essays into the UI.
  const firstLine = message.split("\n")[0]?.trim() ?? "Live fare search failed";
  if (firstLine.length > 140) return `${firstLine.slice(0, 137)}…`;
  return firstLine;
}

/**
 * Launch Chromium for fare scraping.
 * Local: Playwright browsers from `.playwright`.
 * Vercel/Lambda: @sparticuz/chromium-min + remote pack into /tmp + puppeteer-core.
 */
export async function launchChromium(): Promise<PlaywrightBrowser> {
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

  // Vercel / Lambda: read-only except /tmp — never mkdir under /var/task.
  if (isServerlessRuntime()) {
    pinBrowsersPath();
    try {
      const serverless = await launchServerlessChromium();
      if (serverless) return serverless;
      throw new Error("Serverless Chromium failed to launch");
    } catch (error) {
      logger.error("provider.serverless_chromium_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw toProviderError(error);
    }
  }

  pinBrowsersPath();
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
  // Vercel: use chromium-min + remote pack (binaries are NOT traced into /var/task).
  // Downloads/extracts into /tmp on cold start — does not need node_modules/.../bin.
  const sparticuzMod = (await import("@sparticuz/chromium-min")) as {
    default?: SparticuzChromium;
  } & SparticuzChromium;
  const chromiumPkg = sparticuzMod.default ?? sparticuzMod;
  if (!chromiumPkg.executablePath) return null;

  try {
    chromiumPkg.setGraphicsMode = false;
  } catch {
    // older builds may not expose the setter
  }

  const packUrl = resolveChromiumPackUrl();
  logger.info("provider.serverless_chromium_pack", { packUrl });
  const executablePath = await chromiumPkg.executablePath(packUrl);
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error(`Serverless Chromium missing at ${executablePath || "(empty)"}`);
  }

  const args = [...(chromiumPkg.args ?? []), ...LAUNCH_ARGS];
  logger.info("provider.serverless_chromium_launch", {
    executablePath,
    args: args.length,
  });

  // Prefer puppeteer-core on Lambda — it is the supported pairing for @sparticuz/chromium.
  try {
    const puppeteer = await import("puppeteer-core");
    const browser = await puppeteer.default.launch({
      args,
      defaultViewport: { width: 1440, height: 900 },
      executablePath,
      headless: true,
    });
    return wrapPuppeteerBrowser(browser as unknown as PuppeteerBrowserLike);
  } catch (error) {
    logger.error("provider.puppeteer_launch_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // Fallback: playwright-core against the same binary.
  const { chromium } = await import("playwright-core");
  return chromium.launch({
    args,
    executablePath,
    headless: true,
  }) as Promise<PlaywrightBrowser>;
}

const CHROMIUM_PACK_VERSION = "149.0.0";

export function resolveChromiumPackUrl(): string {
  const override = process.env.CHROMIUM_PACK_URL?.trim();
  if (override) return override;
  // Vercel Node functions are x86_64 (Amazon Linux). arm64 pack is for local/serverless ARM.
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `https://github.com/Sparticuz/chromium/releases/download/v${CHROMIUM_PACK_VERSION}/chromium-v${CHROMIUM_PACK_VERSION}-pack.${arch}.tar`;
}

type SparticuzChromium = {
  args?: string[];
  executablePath?: (input?: string) => Promise<string>;
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
  goto: (url: string, options?: { waitUntil?: string | string[]; timeout?: number }) => Promise<unknown>;
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
    waitForFunction: (
      fn: () => unknown,
      _arg?: unknown,
      options?: { timeout?: number },
    ) => page.waitForFunction(fn, { timeout: options?.timeout ?? 35000 }),
    evaluate: <T>(fn: () => T) => page.evaluate(fn),
    on: (event: "response", handler: (response: { url: () => string; json: () => Promise<unknown> }) => void) => {
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
  // Vercel/Lambda: only /tmp is writable. @sparticuz/chromium extracts there;
  // Playwright must not try to install under /var/task.
  if (isServerlessRuntime()) {
    const tmp = path.join("/tmp", "raildrop-playwright");
    try {
      fs.mkdirSync(tmp, { recursive: true });
    } catch {
      // /tmp should always exist on Lambda; ignore rare races.
    }
    process.env.PLAYWRIGHT_BROWSERS_PATH = tmp;
    // Keep Chromium pack extraction on the writable volume.
    process.env.HOME ??= "/tmp";
    return tmp;
  }

  const local = path.join(process.cwd(), ".playwright");
  const current = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (current && browserTreeLooksReady(current)) {
    return current;
  }
  if (browserTreeLooksReady(local)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = local;
    return local;
  }
  // Prefer the durable project folder over Cursor's temp sandbox cache.
  fs.mkdirSync(local, { recursive: true });
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
