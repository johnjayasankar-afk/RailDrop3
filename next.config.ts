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
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
