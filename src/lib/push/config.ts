import 'server-only';

import webpush from 'web-push';
import { getServerEnv, publicEnv } from '@/lib/env';

/**
 * Web Push transport configuration.
 *
 * Push is optional: without VAPID keys the app simply reports the channel as
 * unavailable rather than failing. Email remains the guaranteed path.
 */

let configured: boolean | null = null;

export function isPushConfigured(): boolean {
  if (configured !== null) return configured;
  try {
    const env = getServerEnv();
    const ok = Boolean(publicEnv.vapidPublicKey && env.vapidPrivateKey && env.vapidSubject);
    if (ok) {
      webpush.setVapidDetails(env.vapidSubject, publicEnv.vapidPublicKey, env.vapidPrivateKey);
    }
    configured = ok;
    return ok;
  } catch {
    configured = false;
    return false;
  }
}

export { webpush };

/** Test hook. */
export function resetPushConfig(): void {
  configured = null;
}
