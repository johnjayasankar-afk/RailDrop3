/* RailDrop service worker.
 *
 * Deliberately small. It does exactly two jobs:
 *   1. turn a push message into a notification
 *   2. focus an existing tab (or open one) when that notification is clicked
 *
 * It does NOT cache application responses. RailDrop's pages are per-user and
 * price-sensitive, and a stale cached fare is precisely the failure mode this
 * product exists to avoid. Only the offline fallback shell is precached.
 */

const OFFLINE_CACHE = 'raildrop-offline-v1';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/icon-192.png']))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* Only navigations fall back to the offline shell; everything else fails
 * normally so the app can surface a real error rather than fake success. */
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.open(OFFLINE_CACHE).then((cache) => cache.match(OFFLINE_URL)),
    ),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'RailDrop', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'RailDrop';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    /* A tag collapses repeat alerts for the same trip instead of stacking. */
    tag: payload.tag || 'raildrop-alert',
    renotify: true,
    requireInteraction: false,
    data: { url: payload.url || '/dashboard' },
    actions: [{ action: 'open', title: 'See options' }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        /* Reuse an open RailDrop tab rather than piling up new ones. */
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
