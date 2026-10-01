import type { NextConfig } from "next";
import { FRAMING_CSP } from "./src/lib/embed";

/* The security headers the Labs family sends.
 *
 * The content policy ships in report-only mode on purpose: the fare board is
 * fetched server side, but a policy that is wrong here breaks a page people are
 * mid-booking on. Report-only lets real traffic prove the list is complete;
 * once the console is quiet, rename the header to Content-Security-Policy and
 * add upgrade-insecure-requests, which a report-only policy ignores.
 */
const CSP = [
  "default-src 'self'",
  // Next.js hydrates through an inline script
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.parse.bot",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  FRAMING_CSP,
].join("; ");

const nextConfig: NextConfig = {
  typedRoutes: true,
  /* A static shell for every page, and links that prefetch it.
   *
   * Before this the build table had no static page in it: all eight carried
   * `export const dynamic = "force-dynamic"`, several of them only so the
   * header could read a session cookie — /how-it-works is a hero and twelve
   * hard-coded FAQ strings and was rendered on demand for every visitor.
   *
   * The session now resolves behind a Suspense boundary inside the header and
   * the footer, so the chrome, the headings and the page structure prerender
   * and only the part that genuinely differs per person streams. Every page
   * reports as Partial Prerender.
   *
   * partialPrefetching requires cacheComponents and makes each visible <Link>
   * fetch its destination's shell ahead of the click. */
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // No X-Frame-Options: SAMEORIGIN would block the portfolio's live
          // preview on its own, whatever the CSP says, because the policy
          // below is report-only and a report-only policy overrides nothing.
          { key: "Content-Security-Policy", value: FRAMING_CSP },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "Content-Security-Policy-Report-Only", value: CSP },
        ],
      },
    ];
  },
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "puppeteer-core",
    "@sparticuz/chromium",
  ],

  /* The browser binary, which tracing does not find on its own.
   *
   * This is why the deployed app never returned a price. serverExternalPackages
   * above keeps @sparticuz/chromium out of the bundle and lets it be required at
   * runtime, and tracing duly shipped its JavaScript — build/index.js,
   * build/lambdafs.js, build/paths.js. It did not ship bin/chromium.br, because
   * nothing imports that file: executablePath() builds the path at runtime
   * (`inflate(join(input, "chromium.br"))`, @sparticuz/chromium build/index.js)
   * and a static trace cannot follow a computed path.
   *
   * So every serverless function had the loader for a browser and no browser.
   * executablePath() resolved a path that did not exist, launchBrowser threw
   * "Serverless Chromium missing at ...", and every date in the window came back
   * PROVIDER_ERROR. On the board that rendered as "The fare search did not get
   * through either. Nothing to show." — on a corridor where the search works
   * perfectly from a laptop, which is what made it look like a scraper bug.
   *
   * Verified by reading each route's .nft.json trace under .next/server/app
   * before and after: zero browser-archive entries before, four after.
   *
   * Only the routes that actually launch a browser. Each inclusion adds ~66 MB
   * to that function, taking it to ~84 MB against Vercel's 250 MB uncompressed
   * ceiling; adding it everywhere would waste that headroom on routes that
   * never scrape. `*` stands in for `[id]` on purpose — these keys are picomatch
   * globs, and a literal `[id]` would be read as a character class.
   */
  /* The Chromium binary, for the three routes that launch it.
   *
   * `executablePath()` composes its path at runtime, and tracing follows
   * imports — so nothing tells the bundler the binary is needed and the
   * route 500s in production while working perfectly in dev. That cost a
   * fortnight once. Seven routes needed this; three do now, and a test
   * asserts the list covers every route that reaches for a provider. */
  outputFileTracingIncludes: {
    "/api/fares": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/fares/stream": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/health/provider": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
