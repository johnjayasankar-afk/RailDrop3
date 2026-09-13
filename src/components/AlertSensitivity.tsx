'use client';

import { useState } from 'react';

import { setMinimumSavingsAction } from '@/app/actions';
import { formatCents } from '@/lib/domain/money';
import { useToast } from './Toast';

const PRESETS = [0, 500, 1500, 3000] as const;

/**
 * How much cheaper an option has to be before this trip is worth interrupting
 * you for.
 *
 * The right threshold is per trip, not per account: a $400 sleeper that swings
 * $40 a day and a $19 regional that swings $4 do not deserve the same answer.
 */
export function AlertSensitivity({
  watchId,
  minimumSavingsCents,
}: {
  watchId: string;
  minimumSavingsCents: number;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save(cents: number, raw?: string) {
    setBusy(cents);
    setError(null);
    try {
      const result = await setMinimumSavingsAction(watchId, raw ?? (cents / 100).toFixed(2));
      if (result.ok) {
        setCustom('');
        toast({ title: 'Threshold saved', description: result.message });
      } else {
        setError(result.error ?? 'Could not save the threshold.');
      }
    } finally {
      setBusy(null);
    }
  }

  const isPreset = PRESETS.includes(minimumSavingsCents as (typeof PRESETS)[number]);

  return (
    <div data-testid="alert-sensitivity">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((cents) => {
          const active = cents === minimumSavingsCents;
          return (
            <button
              key={cents}
              type="button"
              onClick={() => save(cents)}
              disabled={busy !== null}
              aria-pressed={active}
              className={`rd-btn !min-h-11 !px-3 !text-[13px] ${
                active ? 'rd-btn-primary' : 'rd-btn-secondary'
              }`}
            >
              {busy === cents ? '…' : cents === 0 ? 'Anything cheaper' : `${formatCents(cents)}+`}
            </button>
          );
        })}
      </div>

      <form
        className="mt-2.5 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (custom.trim() !== '') void save(-1, custom.trim());
        }}
      >
        <label htmlFor="min-savings" className="text-[12px] text-faint">
          Or set your own
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-faint"
          >
            $
          </span>
          <input
            id="min-savings"
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-invalid={error ? 'true' : undefined}
            placeholder={isPreset ? '10.00' : (minimumSavingsCents / 100).toFixed(2)}
            className="rd-input tnum !min-h-11 !w-28 !py-1.5 !pl-6 !text-[13px]"
          />
        </div>
        <button
          type="submit"
          disabled={busy !== null || custom.trim() === ''}
          className="rd-btn rd-btn-secondary !min-h-11 !px-3 !text-[13px]"
        >
          Save
        </button>
        {!isPreset ? (
          <span className="tnum text-[12px] text-muted">
            Currently {formatCents(minimumSavingsCents)}
          </span>
        ) : null}
      </form>

      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
