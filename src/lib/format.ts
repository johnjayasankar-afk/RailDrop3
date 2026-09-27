/**
 * Display formatting shared by server components and client islands.
 * Client-safe: no secrets, no I/O.
 */

import { formatClock, minutesOfDayFromLocalIso } from '@/lib/domain/dates';

/**
 * Date/timestamp columns arrive as strings from PostgREST but can arrive as Date
 * objects from a direct driver. Normalise defensively rather than assuming one.
 */
export function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

export function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

export function formatTimeInZone(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

export function formatDateTimeInZone(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/** '7:05 AM' from a local wall-clock ISO string. */
export function clockFromLocalIso(iso: string): string {
  try {
    return formatClock(minutesOfDayFromLocalIso(iso));
  } catch {
    return '—';
  }
}

export function describeService(serviceName: string | null, trainNumber: string | null): string {
  const parts = [serviceName, trainNumber].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Amtrak service';
}

export function describeTransfers(transfers: number): string {
  if (transfers === 0) return 'Direct';
  return `${transfers} transfer${transfers > 1 ? 's' : ''}`;
}

export function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export function flexibilityLabel(days: number): string {
  if (days === 0) return 'Exact date';
  return `±${days} day${days > 1 ? 's' : ''}`;
}
