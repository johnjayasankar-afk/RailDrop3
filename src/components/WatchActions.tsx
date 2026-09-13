'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useState } from 'react';

import {
  deleteWatchAction,
  manualCheckAction,
  restoreWatchAction,
  setWatchStatusAction,
  togglePinAction,
} from '@/app/actions';
import { useToast } from './Toast';

export function WatchActions({
  watchId,
  status,
  pinned,
}: {
  watchId: string;
  status: string;
  pinned: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | 'check' | 'toggle' | 'delete' | 'pin'>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function checkNow() {
    setBusy('check');
    setMessage(null);
    try {
      const result = await manualCheckAction(watchId);
      const text = result.message ?? result.error ?? 'The check could not run.';
      setMessage(text);
      toast({
        title: result.ok ? 'Check complete' : 'Check did not run',
        description: text,
        tone: result.ok ? 'save' : 'warn',
      });
    } catch {
      setMessage('Something went wrong — please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function toggleStatus() {
    setBusy('toggle');
    setMessage(null);
    const next = status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      const result = await setWatchStatusAction(watchId, next);
      if (!result.ok) {
        setMessage(result.error ?? 'Could not update the trip.');
        return;
      }
      toast({
        title: next === 'PAUSED' ? 'Monitoring paused' : 'Monitoring resumed',
        description:
          next === 'PAUSED'
            ? 'No checks will run and no credits are used.'
            : 'Back on the schedule.',
        tone: 'neutral',
      });
    } catch {
      setMessage('Something went wrong — please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function togglePin() {
    setBusy('pin');
    try {
      await togglePinAction(watchId, !pinned);
      toast({ title: pinned ? 'Unpinned' : 'Pinned to the top of your trips' });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Delete is a soft delete with an Undo affordance rather than a confirmation
   * dialog: a confirm interrupts the 99% of taps that are intentional, while an
   * undo protects the 1% that are not — and this row owns an irreplaceable
   * price history.
   */
  async function remove() {
    setBusy('delete');
    try {
      const result = await deleteWatchAction(watchId);
      if (!result.ok) {
        setMessage(result.error ?? 'Could not delete this trip.');
        return;
      }
      toast({
        title: 'Trip deleted',
        description: 'Its price history is kept for 30 days.',
        tone: 'warn',
        action: {
          label: 'Undo',
          onClick: async () => {
            const restored = await restoreWatchAction(watchId);
            if (restored.ok) {
              // Stay put: revalidation puts the card straight back into the
              // list the user is already looking at.
              toast({ title: 'Trip restored', tone: 'save' });
              router.refresh();
            } else {
              toast({ title: 'Could not restore', description: restored.error, tone: 'danger' });
            }
          },
        },
      });
      startTransition(() => router.push('/dashboard'));
    } catch {
      setMessage('Something went wrong — please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={checkNow}
          disabled={busy !== null}
          className="rd-btn rd-btn-secondary !min-h-11 !px-4 !text-[14px]"
        >
          {busy === 'check' ? 'Checking…' : 'Check now'}
        </button>

        <button
          type="button"
          onClick={toggleStatus}
          disabled={busy !== null || status === 'COMPLETED'}
          className="rd-btn rd-btn-secondary !min-h-11 !px-4 !text-[14px]"
        >
          {status === 'ACTIVE' ? 'Pause' : 'Resume'}
        </button>

        <button
          type="button"
          onClick={togglePin}
          disabled={busy !== null}
          aria-pressed={pinned}
          className="rd-btn rd-btn-ghost !min-h-11 !px-3 !text-[14px]"
        >
          {pinned ? 'Unpin' : 'Pin'}
        </button>

        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          className="rd-btn rd-btn-ghost !min-h-11 !px-3 !text-[14px]"
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete'}
        </button>
      </div>

      {message ? (
        <p role="status" className="mt-2.5 text-[13px] text-muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}
