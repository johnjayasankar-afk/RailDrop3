export function isCheckStale(
  iso: string | null | undefined,
  now = new Date(),
  maxAgeMs = 8 * 60 * 60 * 1000,
): boolean {
  if (!iso) return true;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return true;
  return now.getTime() - then > maxAgeMs;
}

export function formatRelativeTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "not yet";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "not yet";
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 20) return "just now";
  if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}
