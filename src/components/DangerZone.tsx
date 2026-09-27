'use client';

import { useState } from 'react';

import { deleteAccountAction } from '@/app/settings-actions';
import { useToast } from './Toast';

/**
 * Account deletion.
 *
 * Guarded by typing the word rather than by a dialog: a confirm can be
 * dismissed by muscle memory, and unlike deleting a single trip there is no
 * undo behind this one. The button stays disabled until the word matches, so
 * the guard is visible rather than a surprise on submit.
 */
export function DangerZone() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  const armed = confirmation.trim().toUpperCase() === 'DELETE';

  async function remove() {
    setBusy(true);
    try {
      const result = await deleteAccountAction(confirmation);
      if (!result.ok) {
        toast({ title: 'Could not delete', description: result.error, tone: 'danger' });
        return;
      }
      toast({ title: 'Account deleted', description: result.message, tone: 'neutral' });
      // A full navigation, not a client transition: every cached RSC payload
      // for this session describes data that no longer exists.
      window.location.assign('/');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="rd-label">Your data</h2>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-[13.5px] leading-relaxed text-muted">
          Download everything RailDrop holds about you — trips, every check, every alert and every
          delivery — as one JSON file.
        </p>
        <a
          href="/api/account/export"
          className="rd-btn rd-btn-secondary !min-h-11 !px-4 !text-[14px]"
        >
          Export my data
        </a>
      </div>

      <div className="mt-5 rounded-xl border border-danger-line bg-danger-soft px-4 py-4">
        <h3 className="text-[13.5px] font-semibold text-danger">Delete account</h3>
        <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-danger/90">
          Removes every trip, price history, alert and preference. This cannot be undone — unlike
          deleting a single trip, nothing is kept for 30 days.
        </p>

        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rd-btn rd-btn-danger mt-3 !min-h-11 !px-4 !text-[14px]"
          >
            Delete my account
          </button>
        ) : (
          <div className="mt-3">
            <label htmlFor="confirm-delete" className="rd-label">
              Type DELETE to confirm
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                id="confirm-delete"
                autoFocus
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                className="rd-input ticket !w-40"
              />
              <button
                type="button"
                onClick={remove}
                disabled={!armed || busy}
                className="rd-btn rd-btn-danger !min-h-11 !px-4 !text-[14px]"
              >
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setConfirmation('');
                }}
                className="rd-btn rd-btn-ghost !min-h-11 !px-3 !text-[14px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
