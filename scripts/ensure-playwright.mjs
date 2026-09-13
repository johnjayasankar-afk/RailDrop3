#!/usr/bin/env node
/**
 * Ensures Chromium is available for local Wanderu fare checks.
 * Browsers live in .playwright/ so they survive Cursor sandbox path churn.
 *
 * Never download browsers on Vercel/CI — production uses Parse only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

function shouldSkipBrowserInstall() {
  if (process.env.RAILDROP_SKIP_PLAYWRIGHT === "1") return true;
  if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") return true;
  // Vercel sets VERCEL=1 on install + build.
  if (process.env.VERCEL === "1") return true;
  if (process.env.CI === "true" || process.env.CI === "1") return true;
  return false;
}

if (shouldSkipBrowserInstall()) {
  console.log("Skipping Playwright Chromium install (CI/Vercel — Parse-only deploys).");
  process.exit(0);
}

const root = process.cwd();
const browsersPath = path.join(root, ".playwright");
fs.mkdirSync(browsersPath, { recursive: true });

const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: browsersPath,
};

function chromiumReady() {
  try {
    const require = createRequire(import.meta.url);
    const { chromium } = require("playwright");
    const exe = chromium.executablePath();
    return Boolean(exe && fs.existsSync(exe));
  } catch {
    return false;
  }
}

if (chromiumReady()) {
  process.exit(0);
}

console.log("Installing Playwright Chromium into .playwright/ …");
const result = spawnSync("npx", ["playwright", "install", "chromium"], {
  cwd: root,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  console.warn("Playwright Chromium install failed. Local live fares will try system Chrome next.");
  process.exit(0);
}

process.exit(0);
