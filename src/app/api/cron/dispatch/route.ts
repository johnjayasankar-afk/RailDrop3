import { NextResponse } from 'next/server';

import { isAuthorizedCron, json, serverError } from '@/lib/api';
import { getServiceClientAsync, isServiceConfigured } from '@/lib/db/service';
import { createFareProvider } from '@/lib/providers';
import { runDispatch } from '@/lib/services/dispatcher';
import { createLogger, describeError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** A dispatch runs at most a few dozen provider calls; give it room. */
export const maxDuration = 300;

const logger = createLogger({ component: 'cron-endpoint' });

async function handle(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(request)) {
    logger.warn('rejected unauthorized dispatch attempt');
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!isServiceConfigured()) {
    return json({ error: 'Supabase service role is not configured.' }, 503);
  }

  try {
    const result = await runDispatch({
      db: await getServiceClientAsync(),
      provider: createFareProvider(),
      source: new URL(request.url).searchParams.get('source') ?? 'CRON',
    });

    return json({
      ok: true,
      owned: result.owned,
      dispatchId: result.dispatchId,
      watchesConsidered: result.watchesConsidered,
      runsClaimed: result.runsClaimed,
      slotsSkipped: result.slotsSkipped,
      searchesRequested: result.batch?.searchesRequested ?? 0,
      searchesExecuted: result.batch?.searchesExecuted ?? 0,
      searchesSaved: result.batch?.searchesSaved ?? 0,
      alertsCreated: result.batch?.alertsCreated ?? 0,
      emailsSent: (result.batch?.emailsSent ?? 0) + result.emailRetriesSent,
      errors: result.batch?.errors ?? 0,
      durationMs: result.durationMs,
    });
  } catch (error) {
    logger.error('dispatch endpoint failed', describeError(error));
    // A 500 tells cron to try again next hour; the claim table keeps it safe.
    return serverError('Dispatch failed.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}

/** Vercel Cron issues GET requests. */
export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}
