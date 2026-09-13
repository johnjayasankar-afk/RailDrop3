'use client';

import { useEffect } from 'react';

/**
 * Route-level error boundary. Without it, an unexpected throw renders Next's
 * default error page, which leaks nothing useful and looks broken.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(JSON.stringify({ level: 'error', msg: 'route error', digest: error.digest }));
  }, [error]);

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <p className="rd-label">Something went wrong</p>
      <h1 className="mt-3 text-[26px] font-bold tracking-tight text-ink">
        RailDrop hit an unexpected error
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        Your watches and their history are unaffected. Try again — if it keeps happening, the error
        reference below will help.
      </p>
      {error.digest ? (
        <p className="ticket mt-3 text-[12px] text-faint">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" onClick={reset} className="rd-btn rd-btn-primary">
          Try again
        </button>
        <a href="/dashboard" className="rd-btn rd-btn-secondary">
          Back to your trips
        </a>
      </div>
    </main>
  );
}
