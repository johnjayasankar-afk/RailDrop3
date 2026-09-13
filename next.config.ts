import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  // `next dev` and `next start` share .next by default, so running the demo
  // server while the E2E suite builds silently corrupts the production chunk
  // graph — it surfaces as "Cannot read properties of undefined (reading
  // 'call')" from webpack-runtime, which points nowhere near the cause.
  // `npm run demo` sets this so the two can never collide.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep tracing scoped to this app; the machine has an unrelated parent lockfile.
  outputFileTracingRoot: __dirname,
  // Native/WASM packages must not be bundled by webpack.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next's dev server compiles with eval for Fast Refresh, and its
              // websocket is a different origin in some setups. Neither
              // relaxation is ever emitted by `next build`.
              isDev
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
                : "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              isDev
                ? "connect-src 'self' ws: http://localhost:* https://*.supabase.co https://*.supabase.in"
                : "connect-src 'self' https://*.supabase.co https://*.supabase.in",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
