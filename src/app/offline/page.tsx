export const metadata = { title: 'Offline' };

/** Served by the service worker when a navigation fails with no connection. */
export default function OfflinePage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <p className="rd-label">No connection</p>
      <h1 className="mt-3 text-[26px] font-bold tracking-tight text-ink">RailDrop is offline</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        Your trips and their price history are safe on the server. Fares are never cached — showing
        you a stale price is the one thing this app must not do — so this page waits until you are
        back online.
      </p>
      <div className="mt-6">
        <a href="/dashboard" className="rd-btn rd-btn-primary">
          Try again
        </a>
      </div>
    </main>
  );
}
