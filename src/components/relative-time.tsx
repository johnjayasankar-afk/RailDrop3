"use client";

import { useSyncExternalStore } from "react";
import { formatRelativeTime } from "@/lib/domain/relative-time";

/* "Checked 3 min ago", without lying to the server about what time it is.
 *
 * `formatRelativeTime` defaults its `now` to a fresh Date, and it was being
 * called in the body of components that render on the server and then hydrate.
 * The two readings are milliseconds apart, which is invisible until one of them
 * lands on the far side of a boundary: the server writes "just now", the client
 * writes "21s ago", and React reports a hydration mismatch and rebuilds the
 * subtree. It fired reliably on the dashboard, where the watch had just been
 * checked.
 *
 * useSyncExternalStore is the fix rather than an effect: React uses
 * `getServerSnapshot` for the server render *and* for hydration, so both sides
 * agree by construction, and only the render after hydration reads the clock.
 * An effect writing state would produce the same pixels but would also trip
 * react-hooks/set-state-in-effect, because that is exactly what it is.
 *
 * The side effect is a better product: the label now counts up while the page
 * is open instead of freezing at whatever it said on load.
 */

/** Milliseconds, or 0 for "no clock yet". Cached so getSnapshot is stable. */
let reading = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function publish(): void {
  reading = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    // Thirty seconds: the shortest step this formatter has above a minute is a
    // minute, so anything faster is renders nobody can see.
    timer = setInterval(publish, 30_000);
    // Subscriptions run after hydration has committed, so taking a first
    // reading here cannot contradict the server's HTML mid-hydration.
    queueMicrotask(publish);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      // Left as-is rather than reset: a remount re-reads it immediately, and
      // zeroing it would flash the absolute stamp back in.
    }
  };
}

const getSnapshot = () => reading;
const getServerSnapshot = () => 0;

/**
 * The wall clock, or 0 before the client has one.
 *
 * Exported because anything that renders "how long ago" needs it and needs it
 * this way. Reading Date.now() during render is a hydration mismatch waiting
 * for a boundary to land on, and the React Compiler lint refuses it outright —
 * correctly. Callers treat 0 as "no clock yet" and render something true
 * without it.
 */
export function useClientNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function RelativeTime({
  at,
  /**
   * What the server renders, and what a reader with no JavaScript keeps.
   *
   * Supplied by the caller because only the caller knows the trip's timezone —
   * formatting a date here would use the server's zone on one side and the
   * browser's on the other, which is the same bug wearing a different hat.
   */
  fallback,
}: {
  at: string | null | undefined;
  fallback?: string | null;
}) {
  const now = useClientNow();
  if (!at) return <>{fallback ?? "not yet"}</>;
  if (!now) return <time dateTime={at}>{fallback ?? "recently"}</time>;
  return (
    <time dateTime={at} title={fallback ?? undefined}>
      {formatRelativeTime(at, new Date(now))}
    </time>
  );
}
