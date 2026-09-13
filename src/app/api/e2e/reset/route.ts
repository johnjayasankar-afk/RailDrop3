import { NextResponse } from 'next/server';
import { isE2EMode, resetE2EData } from '@/lib/e2e/harness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * E2E-only. Clears user data between specs and lets a spec configure the
 * deterministic provider (e.g. to exercise the partial-failure UI).
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

  await resetE2EData();
  return NextResponse.json({ ok: true });
}
