'use client';

import { useState } from 'react';

import { rebookAction } from '@/app/actions';

/**
 * "I rebooked" - records a new benchmark without ever rewriting history.
 */
export function RebookForm({ watchId, currentAmount }: { watchId: string; currentAmount: string }) {
  const [open, setOpen] = useState(false);
  const [amountPaid, setAmountPaid] = useState('');
  const [travelDate, setTravelDate] = useState('');
  const [trainNumber, setTrainNumber] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [fareFamily, setFareFamily] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!amountPaid.trim()) {
      setError('Enter the new amount you paid.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await rebookAction(watchId, {
        amountPaid,
        travelDate: travelDate || null,
        trainNumber: trainNumber || null,
        departureTime: departureTime || null,
        fareFamily: fareFamily || null,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not record the rebooking.');
        return;
      }
      setOpen(false);
      setAmountPaid('');
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="rebook-form"
        onClick={() => setOpen(true)}
        className="rd-btn rd-btn-secondary !min-h-11 !px-4 !text-[14px]"
      >
        I rebooked
      </button>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="rd-card mt-1 w-full p-4">
      <h3 className="text-[15px] font-semibold text-ink">Record your new booking</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Your previous ticket at {currentAmount} stays in the history. Monitoring continues against
        the new amount if your window is still open.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="rebook-amount" className="rd-label">
            New amount paid <span className="text-danger">*</span>
          </label>
          <div className="relative mt-1.5">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-faint"
            >
              $
            </span>
            <input
              id="rebook-amount"
              inputMode="decimal"
              required
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              aria-invalid={Boolean(error)}
              className="rd-input tnum !pl-7"
              placeholder="74.00"
            />
          </div>
        </div>

        <div>
          <label htmlFor="rebook-date" className="rd-label">
            New travel date
          </label>
          <input
            id="rebook-date"
            type="date"
            value={travelDate}
            onChange={(e) => setTravelDate(e.target.value)}
            className="rd-input mt-1.5"
          />
        </div>
        <div>
          <label htmlFor="rebook-train" className="rd-label">
            New train
          </label>
          <input
            id="rebook-train"
            value={trainNumber}
            onChange={(e) => setTrainNumber(e.target.value)}
            className="rd-input mt-1.5"
            placeholder="179"
          />
        </div>
        <div>
          <label htmlFor="rebook-time" className="rd-label">
            New departure time
          </label>
          <input
            id="rebook-time"
            type="time"
            value={departureTime}
            onChange={(e) => setDepartureTime(e.target.value)}
            className="rd-input mt-1.5"
          />
        </div>
        <div>
          <label htmlFor="rebook-family" className="rd-label">
            New fare family
          </label>
          <select
            id="rebook-family"
            value={fareFamily}
            onChange={(e) => setFareFamily(e.target.value)}
            className="rd-input mt-1.5"
          >
            <option value="">Unchanged</option>
            <option value="FLEXIBLE">Flexible</option>
            <option value="VALUE">Value</option>
            <option value="SAVER">Saver</option>
          </select>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rd-btn rd-btn-primary !min-h-11 !text-[14px]"
        >
          {busy ? 'Saving…' : 'Save new benchmark'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rd-btn rd-btn-ghost !min-h-11 !text-[14px]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
