import 'server-only';

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getServerEnv } from '@/lib/env';

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function badRequest(message: string, details?: unknown): NextResponse {
  return json({ error: message, details }, 400);
}

export function unauthorized(): NextResponse {
  return json({ error: 'Sign in to continue.' }, 401);
}

export function notFound(): NextResponse {
  // Deliberately identical to the response for "exists but is not yours", so the
  // API never confirms the existence of another user's resource.
  return json({ error: 'Not found.' }, 404);
}

export function serverError(message = 'Something went wrong.'): NextResponse {
  return json({ error: message }, 500);
}

/** Constant-time bearer-token comparison for the cron endpoint. */
export function isAuthorizedCron(request: Request): boolean {
  const expected = getServerEnv().cronSecret;
  if (!expected) return false;

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided.length === 0) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still burn a comparison so length is not a timing oracle.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Resolve a caller-supplied `next` into a same-origin path, or fall back.
 *
 * The obvious check — startsWith('/') && !startsWith('//') — is NOT sufficient:
 * WHATWG URL treats a backslash like a slash in a special scheme, so the string
 * "/\\evil.com" passes that test and resolves to https://evil.com/. In the auth
 * callback that is an open redirect that fires AFTER the session cookie is set.
 * Resolving first and comparing origins is the only reliable test.
 */
export function safeNextPath(
  rawNext: string | null | undefined,
  origin: string,
  fallback = '/dashboard',
): string {
  if (!rawNext) return fallback;
  try {
    const resolved = new URL(rawNext, origin);
    if (resolved.origin !== new URL(origin).origin) return fallback;
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    return path.startsWith('/') ? path : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The public origin of a request.
 *
 * `new URL(request.url).origin` is not reliable behind a proxy or a rewriting
 * dev server - it can report the internal host, which silently breaks cookies on
 * redirect. Prefer the forwarded headers the platform actually sets.
 */
export function requestOrigin(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost ?? request.headers.get('host');
  if (!host) return new URL(request.url).origin;
  const proto =
    request.headers.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
