import type { NextConfig } from "next";

const chromiumTraceGlobs = [
  "./node_modules/@sparticuz/chromium-min/**/*",
  "./node_modules/puppeteer-core/**/*",
];

const nextConfig: NextConfig = {
  typedRoutes: true,
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "puppeteer-core",
    "@sparticuz/chromium-min",
  ],
  // Ensure the chromium-min unpacker (and puppeteer-core) ship with fare API routes.
  // The heavy browser pack is downloaded at runtime into /tmp (see playwright-launch.ts).
  outputFileTracingIncludes: {
    "/api/health/provider": chromiumTraceGlobs,
    "/api/watches": chromiumTraceGlobs,
    "/api/watches/[id]/check": chromiumTraceGlobs,
    "/api/cron/dispatch": chromiumTraceGlobs,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
