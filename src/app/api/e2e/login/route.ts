import { NextResponse } from 'next/server';
import { requestOrigin, safeNextPath } from '@/lib/api';
import { E2E_COOKIE, getE2EUserId, isE2EMode } from '@/lib/e2e/harness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** E2E-only session shim. Returns 404 anywhere else, so it cannot be reached in production. */
export async function GET(request: Request): Promise<NextResponse> {
  if (!isE2EMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const next = safeNextPath(url.searchParams.get('next'), origin);

  const userId = await getE2EUserId();
  const response = NextResponse.redirect(new URL(next, origin));
  response.cookies.set(E2E_COOKIE, userId, { httpOnly: true, sameSite: 'lax', path: '/' });
  return response;
}
