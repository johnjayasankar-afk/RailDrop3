'use client';

import { useState } from 'react';

import { setTargetAction } from '@/app/actions';
import { formatCents } from '@/lib/domain/money';
import { useToast } from './Toast';

/**
 * A target price is a second, independent reason to alert.
 *
 * "Materially cheaper than what I paid" is the right default, but it answers a
 * different question from the one most people actually hold in their head:
 * *under this number and I will rebook*. A watch that has gone quiet because
 * nothing changed materially still has to speak the moment it crosses that line.
 */
export function TargetPrice({
  watchId,
  targetCents,
  benchmarkCents,
  bestTotalCents,
}: {
  watchId: string;
  targetCents: number | null;
  benchmarkCents: number;
  bestTotalCents: number | null;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(targetCents !== null ? (targetCents / 100).toFixed(2) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(next: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await setTargetAction(watchId, next);
      if (result.ok) {
        setEditing(false);
        toast({
          title: next === '' ? 'Target removed' : 'Target saved',
          description: result.message,
        });
      } else {
        setError(result.error ?? 'Could not save the target.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    const reached =
      targetCents !== null && bestTotalCents !== null && bestTotalCents <= targetCents;
    return (
      <div data-testid="target-price" className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {targetCents === null ? (
            <p className="text-[13px] text-faint">
              No target set — you will hear from us whenever something is materially cheaper.
            </p>
          ) : (
            <p className="text-[13px] leading-relaxed text-muted">
              Alert me at{' '}
              <span className="tnum font-semibold text-ink">{formatCents(targetCents)}</span>
              {reached ? (
                <span className="ml-2 inline-flex items-center rounded-md bg-save-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-save">
                  Reached
                </span>
              ) : bestTotalCents !== null ? (
                <span className="tnum text-faint">
                  {' '}
                  · {formatCents(bestTotalCents - targetCents)} to go
                </span>
              ) : null}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rd-btn rd-btn-ghost !min-h-11 !px-3 !text-[13px]"
          >
            {targetCents === null ? 'Set a target' : 'Change'}
          </button>
          {targetCents !== null ? (
            <button
              type="button"
              onClick={() => {
                setValue('');
                void submit('');
              }}
              disabled={busy}
              className="rd-btn rd-btn-ghost !min-h-11 !px-3 !text-[13px]"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      data-testid="target-price"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(value.trim());
      }}
    >
      <label htmlFor="target-price" className="rd-label">
        Tell me when it reaches
      </label>
      <div className="mt-1.5 flex flex-wrap items-start gap-2">
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-faint"
          >
            $
          </span>
          <input
            id="target-price"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby="target-hint"
            placeholder="89.00"
            className="rd-input tnum !w-40 !pl-7"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rd-btn rd-btn-primary !min-h-11 !text-[14px]"
        >
          {busy ? 'Saving…' : 'Save target'}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(targetCents !== null ? (targetCents / 100).toFixed(2) : '');
            setError(null);
            setEditing(false);
          }}
          className="rd-btn rd-btn-ghost !min-h-11 !text-[14px]"
        >
          Cancel
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : (
        <p id="target-hint" className="mt-2 text-[12px] leading-relaxed text-faint">
          Anything below the {formatCents(benchmarkCents)} you paid. This is in addition to the
          normal drop alerts, not instead of them.
        </p>
      )}
    </form>
  );
}
