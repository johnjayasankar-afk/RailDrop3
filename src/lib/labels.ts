import type { CycleStatus } from '@/lib/domain/types';

/**
 * Pure presentation helpers shared by server and client components.
 *
 * Deliberately NOT in queries.ts: that module is `server-only`, and a client
 * component importing a value from it drags the whole server graph into the
 * browser bundle.
 */

export function cycleStatusLabel(status: string | null | undefined): {
  label: string;
  tone: 'neutral' | 'save' | 'warn' | 'danger';
} {
  switch (status as CycleStatus) {
    case 'SUCCESS':
      return { label: 'All dates checked', tone: 'neutral' };
    case 'PARTIAL_SUCCESS':
      return { label: 'Some dates not checked', tone: 'warn' };
    case 'FAILED':
      return { label: 'Check failed', tone: 'danger' };
    case 'SKIPPED_BUDGET':
      return { label: 'Paused: credit budget', tone: 'warn' };
    case 'SKIPPED_EXPIRED':
      return { label: 'Monitoring window closed', tone: 'neutral' };
    default:
      return { label: 'Not checked yet', tone: 'neutral' };
  }
}

export function alertReasonLabel(reason: string): { label: string; explanation: string } {
  switch (reason) {
    case 'FIRST_DROP':
      return { label: 'First drop', explanation: 'The first option we found below what you paid.' };
    case 'PRICE_DROP':
      return {
        label: 'Cheaper again',
        explanation: 'The best price fell materially below the last one we told you about.',
      };
    case 'TARGET_REACHED':
      return {
        label: 'Target reached',
        explanation: 'The best price reached the target you set for this trip.',
      };
    case 'BETTER_CONVENIENCE':
      return {
        label: 'Better trip',
        explanation:
          'A similarly priced option became materially more convenient — a closer date, fewer changes, or a better time.',
      };
    default:
      return { label: reason, explanation: '' };
  }
}
