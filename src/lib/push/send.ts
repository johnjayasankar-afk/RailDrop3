import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createLogger, describeError } from '@/lib/log';
import { isPushConfigured, webpush } from './config';

const logger = createLogger({ component: 'push' });

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  /** Rendered into the notification so a glance is enough. */
  savings?: string;
}

export interface PushResult {
  sent: number;
  removed: number;
  failed: number;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

/**
 * Deliver a push to every device a user has registered.
 *
 * A 404 or 410 from the push service is definitive: the browser revoked that
 * subscription, and the row is deleted rather than retried forever. Anything
 * else is counted, and a subscription that keeps failing is eventually dropped
 * so a dead endpoint cannot slow every future alert.
 */
export async function sendPushToUser(
  db: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  if (!isPushConfigured()) return { sent: 0, removed: 0, failed: 0 };

  const { data, error } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .eq('user_id', userId);

  if (error || !data || data.length === 0) return { sent: 0, removed: 0, failed: 0 };

  const subscriptions = data as unknown as SubscriptionRow[];
  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 60 * 60 * 6, urgency: 'high' },
        );
        sent += 1;
        await db
          .from('push_subscriptions')
          .update({ last_used_at: new Date().toISOString(), failure_count: 0 })
          .eq('id', sub.id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // Gone for good: the browser unsubscribed or the endpoint expired.
        if (status === 404 || status === 410 || sub.failure_count >= 4) {
          await db.from('push_subscriptions').delete().eq('id', sub.id);
          removed += 1;
          return;
        }
        failed += 1;
        await db
          .from('push_subscriptions')
          .update({ failure_count: sub.failure_count + 1 })
          .eq('id', sub.id);
        logger.warn('push delivery failed', { status, ...describeError(error) });
      }
    }),
  );

  return { sent, removed, failed };
}
