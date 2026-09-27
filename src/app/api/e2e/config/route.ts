import { NextResponse } from 'next/server';
import { isE2EMode } from '@/lib/e2e/harness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * E2E-only. Reconfigures the deterministic provider WITHOUT touching data, so a
 * spec can set up several watches in different provider conditions side by side.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isE2EMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { failDates?: string[]; emptyDates?: string[] } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  process.env.DETERMINISTIC_FAIL_DATES = (body.failDates ?? []).join(',');
  process.env.DETERMINISTIC_EMPTY_DATES = (body.emptyDates ?? []).join(',');

  return NextResponse.json({
    ok: true,
    failDates: process.env.DETERMINISTIC_FAIL_DATES,
    emptyDates: process.env.DETERMINISTIC_EMPTY_DATES,
  });
}
