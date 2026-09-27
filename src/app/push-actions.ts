'use server';

import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { getServiceClientAsync, isServiceConfigured } from '@/lib/db/service';
import { isPushConfigured } from '@/lib/push/config';
import { sendPushToUser } from '@/lib/push/send';
import { publicEnv } from '@/lib/env';
import { createLogger, describeError } from '@/lib/log';

const logger = createLogger({ component: 'push-actions' });

export interface PushActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/** Whether push is even available in this deployment, for the settings UI. */
export async function pushAvailabilityAction(): Promise<{
  configured: boolean;
  publicKey: string;
}> {
  return { configured: isPushConfigured(), publicKey: publicEnv.vapidPublicKey };
}

export async function savePushSubscriptionAction(subscription: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<PushActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };
  if (!isPushConfigured())
    return { ok: false, error: 'Push is not configured on this deployment.' };

  const { endpoint, p256dh, auth } = subscription;
  if (!endpoint || !p256dh || !auth) return { ok: false, error: 'Incomplete subscription.' };
  // A push endpoint is a URL the server will later POST to; refuse anything
  // that is not an https URL so a malformed value cannot become an SSRF target.
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return { ok: false, error: 'Invalid subscription endpoint.' };
  } catch {
    return { ok: false, error: 'Invalid subscription endpoint.' };
  }

  const db = await getServerSupabase();
  // The endpoint is the natural key: re-subscribing the same browser refreshes
  // the keys instead of accumulating a row per visit.
  const { error } = await db.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: (subscription.userAgent ?? '').slice(0, 300) || null,
      failure_count: 0,
    },
    { onConflict: 'endpoint' },
  );

  if (error) {
    logger.error('could not save push subscription', { error: error.message });
    return { ok: false, error: 'Could not enable push on this device.' };
  }
  return { ok: true, message: 'Push notifications are on for this device.' };
}

export async function removePushSubscriptionAction(endpoint: string): Promise<PushActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const db = await getServerSupabase();
  const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) return { ok: false, error: 'Could not turn push off.' };
  return { ok: true, message: 'Push notifications are off for this device.' };
}

/** Proves the whole path end to end, which is the only way to trust it. */
export async function sendTestPushAction(): Promise<PushActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };
  if (!isPushConfigured())
    return { ok: false, error: 'Push is not configured on this deployment.' };
  if (!isServiceConfigured()) return { ok: false, error: 'Background worker is not configured.' };

  try {
    const db = await getServiceClientAsync();
    const result = await sendPushToUser(db, user.id, {
      title: 'RailDrop is watching',
      body: 'Push notifications are working. You will get one like this when a fare drops.',
      url: '/dashboard',
      tag: 'raildrop-test',
    });

    if (result.sent === 0 && result.removed > 0) {
      return { ok: false, error: 'This device was unsubscribed. Turn push off and on again.' };
    }
    if (result.sent === 0) return { ok: false, error: 'No device is subscribed yet.' };
    return { ok: true, message: `Sent to ${result.sent} device${result.sent > 1 ? 's' : ''}.` };
  } catch (error) {
    logger.error('test push failed', describeError(error));
    return { ok: false, error: 'Could not send the test notification.' };
  }
}
