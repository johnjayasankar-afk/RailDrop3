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

export function sanitizeProviderError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("executable doesn't exist") ||
    lower.includes("playwright was just installed") ||
    lower.includes("browserType.launch") ||
    lower.includes("npx playwright install")
  ) {
    return "Browser for live fares is still setting up. Recheck in a minute.";
  }
  if (lower.includes("timeout") || lower.includes("navigation")) {
    return "Live fare search timed out. Recheck in a minute.";
  }
  if (lower.includes("wanderu returned no trip data")) {
    return "No live trips came back for this window. Recheck in a minute.";
  }
  // Never dump stack / box-drawing installer essays into the UI.
  const firstLine = message.split("\n")[0]?.trim() ?? "Live fare search failed";
  if (firstLine.length > 140) return `${firstLine.slice(0, 137)}…`;
  return firstLine;
}

export async function launchChromium(): Promise<PlaywrightBrowser> {
  pinBrowsersPath();

  // Vercel / Lambda: use the serverless Chromium build (no postinstall browser download).
  if (process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    try {
      const serverless = await launchServerlessChromium();
      if (serverless) return serverless;
    } catch (error) {
      logger.error("provider.serverless_chromium_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
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
  const sparticuz = (await import("@sparticuz/chromium")) as {
    default?: { args: string[]; executablePath: () => Promise<string> };
    args?: string[];
    executablePath?: () => Promise<string>;
  };
  const chromiumPkg = sparticuz.default ?? sparticuz;
  if (!chromiumPkg.executablePath) return null;
  const { chromium } = await import("playwright-core");
  const executablePath = await chromiumPkg.executablePath();
  return chromium.launch({
    args: [...(chromiumPkg.args ?? []), ...LAUNCH_ARGS],
    executablePath,
    headless: true,
  }) as Promise<PlaywrightBrowser>;
}

export function pinBrowsersPath(): string {
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
