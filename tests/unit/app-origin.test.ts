import { afterEach, describe, expect, it } from "vitest";
import { appOrigin } from "@/lib/config";

/**
 * The origin every absolute URL is built from: canonical metadata, the
 * sitemap, robots, and the "Open board" CTA in an alert email.
 *
 * It used to be a literal (https://raildrop.app) in four places and a zod
 * default of http://localhost:3000 in a fifth — and the setup docs tell you to
 * set NEXT_PUBLIC_APP_URL *after* the first deploy, so the first production
 * alerts went out linking to localhost.
 */
describe("appOrigin", () => {
  const saved = {
    app: process.env.NEXT_PUBLIC_APP_URL,
    vercel: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  };

  afterEach(() => {
    if (saved.app === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved.app;
    if (saved.vercel === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = saved.vercel;
  });

  it("prefers explicit configuration", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fares.example.com";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ignored.vercel.app";
    expect(appOrigin()).toBe("https://fares.example.com");
  });

  it("strips a trailing slash so URLs never double up", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fares.example.com/";
    expect(appOrigin()).toBe("https://fares.example.com");
  });

  it("falls back to the domain Vercel reports, with a scheme", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "rail-drop3.vercel.app";
    expect(appOrigin()).toBe("https://rail-drop3.vercel.app");
  });

  it("does not double the scheme if the platform already included one", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "https://rail-drop3.vercel.app";
    expect(appOrigin()).toBe("https://rail-drop3.vercel.app");
  });

  it("falls back to localhost only when nothing else is known", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(appOrigin()).toBe("http://localhost:3000");
  });

  it("treats an empty string as unset rather than as an origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "   ";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "rail-drop3.vercel.app";
    expect(appOrigin()).toBe("https://rail-drop3.vercel.app");
  });
});
