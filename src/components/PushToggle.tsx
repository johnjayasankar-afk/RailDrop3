'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  pushAvailabilityAction,
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from '@/app/push-actions';
import { useToast } from './Toast';

type State =
  'checking' | 'unsupported' | 'unconfigured' | 'unavailable' | 'denied' | 'off' | 'on' | 'working';

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalised);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function encodeKey(key: ArrayBuffer | null): string {
  if (!key) return '';
  return window.btoa(String.fromCharCode(...new Uint8Array(key)));
}

/**
 * Per-device push notifications.
 *
 * Push is the channel that actually matters for a fare alert — a drop you hear
 * about eight hours later is often gone. It degrades honestly: unsupported
 * browsers, a deployment without VAPID keys, and a user who has blocked
 * notifications each get a specific explanation rather than a dead switch.
 */
export function PushToggle() {
  const [state, setState] = useState<State>('checking');
  const [publicKey, setPublicKey] = useState('');
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setState('unsupported');
      return;
    }

    const availability = await pushAvailabilityAction();
    if (!availability.configured || !availability.publicKey) {
      setState('unconfigured');
      return;
    }
    setPublicKey(availability.publicKey);

    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    try {
      // `serviceWorker.ready` never resolves when no worker ever activates —
      // registration blocked, a private window, an error inside sw.js. Without
      // a deadline the panel sits on "Checking this device…" forever, which
      // looks broken and explains nothing. Losing the race is reported as a
      // real state rather than a spinner.
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5000)),
      ]);
      if (!registration) {
        setState('unavailable');
        return;
      }
      const existing = await registration.pushManager.getSubscription();
      setEndpoint(existing?.endpoint ?? null);
      setState(existing ? 'on' : 'off');
    } catch {
      setState('off');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function enable() {
    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const json = subscription.toJSON() as { keys?: { p256dh?: string; auth?: string } };
      const result = await savePushSubscriptionAction({
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh ?? encodeKey(subscription.getKey('p256dh')),
        auth: json.keys?.auth ?? encodeKey(subscription.getKey('auth')),
        userAgent: navigator.userAgent,
      });

      if (!result.ok) {
        await subscription.unsubscribe().catch(() => {});
        toast({ title: 'Could not turn push on', description: result.error, tone: 'danger' });
        setState('off');
        return;
      }

      setEndpoint(subscription.endpoint);
      setState('on');
      toast({ title: 'Push notifications on', description: 'For this device.', tone: 'save' });
    } catch (error) {
      toast({
        title: 'Could not turn push on',
        description: error instanceof Error ? error.message : undefined,
        tone: 'danger',
      });
      setState('off');
    }
  }

  async function disable() {
    setState('working');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe().catch(() => {});
        await removePushSubscriptionAction(subscription.endpoint);
      } else if (endpoint) {
        await removePushSubscriptionAction(endpoint);
      }
      setEndpoint(null);
      setState('off');
      toast({ title: 'Push notifications off', description: 'For this device.' });
    } catch {
      setState('on');
    }
  }

  async function test() {
    const result = await sendTestPushAction();
    toast({
      title: result.ok ? 'Test notification sent' : 'Could not send it',
      description: result.message ?? result.error,
      tone: result.ok ? 'save' : 'danger',
    });
  }

  if (state === 'checking') {
    return <p className="text-[13px] text-faint">Checking this device…</p>;
  }

  if (state === 'unsupported') {
    return (
      <Explain title="Not supported on this browser">
        Push needs a browser with service workers. On iPhone, add RailDrop to your Home Screen first
        — Safari only allows notifications for installed apps.
      </Explain>
    );
  }

  if (state === 'unavailable') {
    return (
      <Explain title="This browser did not start the background worker">
        Push needs a service worker, and this browser has not activated one — a private window or
        blocked site data will do it. Email alerts are unaffected.
      </Explain>
    );
  }

  if (state === 'unconfigured') {
    return (
      <Explain title="Push is not configured on this deployment">
        Run <code className="ticket">npm run gen:vapid</code> and set the two keys it prints. Email
        alerts work regardless.
      </Explain>
    );
  }

  if (state === 'denied') {
    return (
      <Explain title="Blocked in this browser">
        You previously declined notifications for this site. Re-enable them in your browser&rsquo;s
        site settings, then reload.
      </Explain>
    );
  }

  const on = state === 'on';
  const busy = state === 'working';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={on ? disable : enable}
        disabled={busy}
        aria-pressed={on}
        className={`rd-btn !min-h-11 !text-[14px] ${on ? 'rd-btn-secondary' : 'rd-btn-primary'}`}
      >
        {busy ? 'Working…' : on ? 'Turn off on this device' : 'Turn on for this device'}
      </button>

      {on ? (
        <button type="button" onClick={test} className="rd-btn rd-btn-ghost !min-h-11 !text-[14px]">
          Send a test
        </button>
      ) : null}

      {on ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-save">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-save" />
          Active on this device
        </span>
      ) : null}
    </div>
  );
}

function Explain({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3">
      <p className="text-[13.5px] font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}
