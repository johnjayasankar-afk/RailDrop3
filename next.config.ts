import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  serverExternalPackages: ["playwright", "playwright-core"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
