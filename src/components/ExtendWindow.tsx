'use client';

import { useState } from 'react';

import { extendWatchAction } from '@/app/actions';
import { EXTEND_OPTIONS } from '@/lib/monitoring';
import { useToast } from './Toast';

/**
 * Extend the monitoring window.
 *
 * Windows were fixed at creation, so a trip still worth watching simply went
 * quiet, and the only way to keep watching was to create it again — throwing
 * away the price history that makes the chart worth reading.
 *
 * When the window is nearly up this renders as a notice rather than a quiet
 * row, because by then it is the most useful thing on the page.
 */
export function ExtendWindow({
  watchId,
  endsAt,
  status,
}: {
  watchId: string;
  endsAt: string;
  status: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  const msLeft = new Date(endsAt).getTime() - Date.now();
  const hoursLeft = msLeft / 3_600_000;
  const closed = msLeft <= 0 || status === 'COMPLETED';
  const endingSoon = !closed && hoursLeft <= 24;
  const urgent = closed || endingSoon;

  async function extend(days: number) {
    setBusy(days);
    try {
      const result = await extendWatchAction(watchId, days);
      toast({
        title: result.ok ? 'Monitoring extended' : 'Could not extend',
        description: result.ok ? result.message : result.error,
        tone: result.ok ? 'save' : 'warn',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      data-testid="extend-window"
      className={
        urgent
          ? 'rounded-xl border border-warn-line bg-warn-soft px-4 py-3.5'
          : 'flex flex-wrap items-center justify-between gap-3'
      }
    >
      <div className="min-w-0">
        <p className={`text-[13.5px] font-semibold ${urgent ? 'text-warn' : 'text-ink'}`}>
          {closed
            ? 'Monitoring has finished'
            : endingSoon
              ? `Monitoring ends in ${describeRemaining(msLeft)}`
              : 'Monitoring window'}
        </p>
        <p
          className={`mt-0.5 text-[12.5px] leading-relaxed ${urgent ? 'text-warn/90' : 'text-muted'}`}
        >
          {closed
            ? 'No further checks will run. Extending picks up exactly where it left off, price history and all.'
            : `Ends ${describeRemaining(msLeft)} from now. Extend to keep checking for cheaper fares.`}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {EXTEND_OPTIONS.map((option) => (
          <button
            key={option.days}
            type="button"
            onClick={() => extend(option.days)}
            disabled={busy !== null}
            className={`rd-btn !min-h-11 !px-3 !text-[13px] ${
              urgent && option.days === 7 ? 'rd-btn-primary' : 'rd-btn-secondary'
            }`}
          >
            {busy === option.days ? '…' : option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function describeRemaining(ms: number): string {
  const abs = Math.abs(ms);
  const hours = Math.round(abs / 3_600_000);
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.round(hours / 24)} days`;
}
