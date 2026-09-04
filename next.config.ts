import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  serverExternalPackages: ["playwright", "playwright-core", "@sparticuz/chromium"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
