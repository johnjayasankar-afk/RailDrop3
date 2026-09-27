/**
 * Shared monitoring constants.
 *
 * These live outside `src/app/actions.ts` because a `'use server'` module may
 * only export async functions — a plain value there is a build-time error that
 * surfaces as a broken Server Action at runtime, not as a failed compile.
 */

/** How far a single extension can push the monitoring window. */
export const EXTEND_OPTIONS = [
  { days: 2, label: '2 more days' },
  { days: 7, label: '1 more week' },
  { days: 14, label: '2 more weeks' },
] as const;

export type WatchEventKind =
  | 'CREATED'
  | 'REBOOKED'
  | 'PAUSED'
  | 'RESUMED'
  | 'EXTENDED'
  | 'TARGET_SET'
  | 'TARGET_CLEARED'
  | 'DELETED'
  | 'RESTORED'
  | 'COMPLETED';
