import { NextResponse } from 'next/server';

import { getCurrentUser, getServerSupabase } from '@/lib/db/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Everything RailDrop holds about you, as one JSON file.
 *
 * Read entirely through the RLS-scoped client, so this route has no privilege
 * to leak: the same query run by a different session returns that session's
 * rows and nothing else. Push subscription keys are deliberately redacted — an
 * endpoint plus its keys is a live capability to notify the device, and a file
 * in a downloads folder is the wrong place for one.
 */
const TABLES = [
  'watches',
  'watch_events',
  'fare_check_cycles',
  'fare_snapshots',
  'journey_options',
  'fare_options',
  'alerts',
  'notification_deliveries',
  'booking_price_events',
] as const;

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const db = await getServerSupabase();

  const payload: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    format: 'raildrop.account-export.v1',
    account: { id: user.id, email: user.email },
  };

  const { data: profile } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  payload['profile'] = profile ?? null;

  for (const table of TABLES) {
    const { data, error } = await db.from(table).select('*').limit(5000);
    // A table that errors is reported as such rather than silently exported as
    // an empty array — "no rows" and "we could not read them" are not the same
    // claim to make about somebody's own data.
    payload[table] = error ? { error: 'could not be exported' } : (data ?? []);
  }

  const { data: subscriptions } = await db
    .from('push_subscriptions')
    .select('id, endpoint, user_agent, label, created_at, last_used_at');
  payload['push_subscriptions'] = (
    (subscriptions ?? []) as Array<{ endpoint: string; [k: string]: unknown }>
  ).map((row) => ({
    ...row,
    endpoint: `${row.endpoint.slice(0, 40)}… (truncated)`,
    keys: 'redacted — a push key is a live capability, not a record',
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="raildrop-export-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
