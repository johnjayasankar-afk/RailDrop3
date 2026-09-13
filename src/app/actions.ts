'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { getServiceClientAsync, isServiceConfigured } from '@/lib/db/service';
import { createFareProvider } from '@/lib/providers';
import { runSingleWatchCycle } from '@/lib/services/dispatcher';
import {
  claimManualCheck,
  createRoundTrip,
  createWatchSchema,
  rebookSchema,
  rebookWatch,
  WatchValidationError,
} from '@/lib/services/watches';
import { addDays, formatMediumDate } from '@/lib/domain/dates';
import { dollarsToCents, formatCents } from '@/lib/domain/money';
import { toDateString } from '@/lib/format';
import { createLogger, describeError } from '@/lib/log';
import { EXTEND_OPTIONS, type WatchEventKind } from '@/lib/monitoring';
import type { WatchRow } from '@/lib/db/types';

/**
 * Mutations run as Server Actions rather than fetch + router.refresh().
 *
 * The refresh approach was measurably unreliable: the server rendered the new
 * value every time, and the browser intermittently never committed it, so a user
 * who had just rebooked still saw their old price. A Server Action performs the
 * mutation and the revalidation in one server round-trip and React applies the
 * resulting payload as part of the action, which removes that class of bug
 * entirely — and the forms degrade to working without JavaScript.
 *
 * Every action re-establishes the session and reads through the RLS-scoped
 * client, so authorization does not depend on the caller.
 */

const logger = createLogger({ component: 'actions' });

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
  message?: string;
  watchId?: string;
}

/**
 * Append to the trip timeline.
 *
 * Deliberately best-effort: an event is a record of something that already
 * happened, so failing to write one must never fail the action that succeeded.
 * A missing timeline row is a cosmetic loss; a rolled-back rebook is not.
 */
async function recordEvent(
  db: Awaited<ReturnType<typeof getServerSupabase>>,
  watchId: string,
  userId: string,
  kind: WatchEventKind,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db
    .from('watch_events')
    .insert({ watch_id: watchId, user_id: userId, kind, detail });
  if (error) logger.warn('could not record watch event', { watch_id: watchId, kind });
}

function revalidateWatch(id?: string): void {
  if (id) revalidatePath(`/watches/${id}`);
  revalidatePath('/dashboard');
}

/** Loads a watch through RLS: another user's id simply matches no rows. */
async function loadOwnedWatch(id: string): Promise<WatchRow | null> {
  const db = await getServerSupabase();
  const { data, error } = await db.from('watches').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as unknown as WatchRow;
}

export async function createWatchAction(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const parsed = createWatchSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first?.message ?? 'Check the form and try again.',
      field: first?.path.join('.'),
    };
  }

  try {
    const userDb = await getServerSupabase();
    const { outbound, inbound } = await createRoundTrip(userDb, user.id, parsed.data);
    const watch = outbound;
    for (const leg of [outbound, inbound]) {
      if (leg) {
        await recordEvent(userDb, leg.id, user.id, 'CREATED', {
          benchmarkCents: leg.benchmark_cents,
          roundTrip: inbound !== null,
        });
      }
    }

    // The immediate INITIAL scan. A failure here must not lose the watch the
    // user just created, so it is reported rather than thrown.
    let message = inbound ? 'Watching both legs of this trip.' : 'Watching this trip.';
    if (isServiceConfigured()) {
      const service = await getServiceClientAsync();
      const provider = createFareProvider();
      for (const leg of [outbound, inbound]) {
        if (!leg) continue;
        try {
          const result = await runSingleWatchCycle(service, provider, leg, 'INITIAL');
          const status = result.cycles[0]?.status;
          if (status === 'FAILED') message = 'Watch created, but the first check could not run.';
          else if (status === 'PARTIAL_SUCCESS')
            message = 'Watch created. Some dates could not be checked.';
        } catch (error) {
          logger.error('initial scan failed', { watch_id: leg.id, ...describeError(error) });
          message = 'Watch created, but the first check could not run.';
        }
      }
    }

    revalidateWatch(watch.id);
    return { ok: true, watchId: watch.id, message };
  } catch (error) {
    if (error instanceof WatchValidationError) {
      return { ok: false, error: error.message, field: error.field };
    }
    logger.error('watch creation failed', describeError(error));
    return { ok: false, error: 'Could not create the watch.' };
  }
}

export async function setWatchStatusAction(
  id: string,
  status: 'ACTIVE' | 'PAUSED',
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const db = await getServerSupabase();
  const { data, error } = await db
    .from('watches')
    .update({ status, status_reason: null })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: 'Could not update the trip.' };
  if (!data) return { ok: false, error: 'Not found.' };

  await recordEvent(db, id, user.id, status === 'PAUSED' ? 'PAUSED' : 'RESUMED');
  revalidateWatch(id);
  return { ok: true, message: status === 'PAUSED' ? 'Monitoring paused.' : 'Monitoring resumed.' };
}

/**
 * Soft delete, so the action is instantly undoable.
 *
 * A watch owns its entire price history; a mis-tap that destroyed it would be
 * unrecoverable. The row is hidden everywhere immediately, excluded from
 * scheduling, and really removed by the retention job after 30 days.
 */
export async function deleteWatchAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const db = await getServerSupabase();
  const { data, error } = await db
    .from('watches')
    .update({ deleted_at: new Date().toISOString(), status: 'PAUSED' })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: 'Could not delete the trip.' };
  if (!data) return { ok: false, error: 'Not found.' };

  await recordEvent(db, id, user.id, 'DELETED');
  revalidateWatch(id);
  return { ok: true, message: 'Trip deleted.' };
}

export async function restoreWatchAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const db = await getServerSupabase();
  const now = new Date();
  const { data, error } = await db
    .from('watches')
    .update({ deleted_at: null })
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .select('id, monitoring_ends_at')
    .maybeSingle();

  if (error) return { ok: false, error: 'Could not restore the trip.' };
  if (!data) return { ok: false, error: 'That trip is no longer restorable.' };

  // Only resume monitoring if the window is genuinely still open.
  const row = data as { id: string; monitoring_ends_at: string };
  if (new Date(row.monitoring_ends_at) > now) {
    await db.from('watches').update({ status: 'ACTIVE' }).eq('id', id);
  }

  await recordEvent(db, id, user.id, 'RESTORED');
  revalidateWatch(id);
  return { ok: true, message: 'Trip restored.' };
}

export async function togglePinAction(id: string, pinned: boolean): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const db = await getServerSupabase();
  const { data, error } = await db
    .from('watches')
    .update({ pinned })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Could not update the trip.' };
  revalidateWatch(id);
  return { ok: true, message: pinned ? 'Pinned to the top.' : 'Unpinned.' };
}

export async function saveNoteAction(id: string, note: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const trimmed = note.trim().slice(0, 500);
  const db = await getServerSupabase();
  const { data, error } = await db
    .from('watches')
    .update({ note: trimmed === '' ? null : trimmed })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Could not save the note.' };
  revalidateWatch(id);
  return { ok: true, message: 'Note saved.' };
}

/**
 * Set or clear a target price.
 *
 * A target is a second, independent reason to alert: "materially cheaper than
 * what I paid" answers a different question from "under the number I had in
 * mind". It is clamped below the benchmark, because a target at or above what
 * you already paid would be satisfied by every check forever.
 */
export async function setTargetAction(id: string, amount: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const db = await getServerSupabase();
  const { data: current } = await db
    .from('watches')
    .select('benchmark_cents')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!current) return { ok: false, error: 'Not found.' };
  const benchmarkCents = (current as { benchmark_cents: number }).benchmark_cents;

  const raw = typeof amount === 'string' ? amount.trim() : amount;
  let targetCents: number | null = null;

  if (raw !== '' && raw !== null && raw !== undefined) {
    try {
      targetCents = dollarsToCents(raw as string | number);
    } catch {
      return { ok: false, error: 'Enter a valid amount, for example 89.00', field: 'target' };
    }
    if (targetCents <= 0) {
      return { ok: false, error: 'Enter an amount above zero.', field: 'target' };
    }
    if (targetCents >= benchmarkCents) {
      return {
        ok: false,
        error: `A target has to be below the ${formatCents(benchmarkCents)} you paid — otherwise it is met the moment monitoring starts.`,
        field: 'target',
      };
    }
  }

  const { data, error } = await db
    .from('watches')
    .update({ target_price_cents: targetCents })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Could not save the target.' };

  await recordEvent(db, id, user.id, targetCents === null ? 'TARGET_CLEARED' : 'TARGET_SET', {
    targetCents,
  });
  revalidateWatch(id);
  return {
    ok: true,
    message:
      targetCents === null
        ? 'Target removed.'
        : `We will tell you the moment it reaches ${formatCents(targetCents)}.`,
  };
}

/**
 * Extend the monitoring window.
 *
 * Windows were fixed at creation, so a trip that was still worth watching went
 * quiet with no recourse but to recreate it — losing its entire price history.
 *
 * The new end is measured from whichever is later, now or the current end, so
 * extending an already-expired watch gives a full window rather than a window
 * that is still in the past. It is capped at the travel date: monitoring a
 * train after it has departed cannot find anything and would only burn credits.
 */
/**
 * Per-trip alert sensitivity.
 *
 * The column existed from the first migration and was only ever set from the
 * profile default, so a trip whose fares swing $40 and one whose fares swing
 * $4 were held to the same threshold. This makes it reachable per trip, which
 * is where the right answer actually lives.
 */
export async function setMinimumSavingsAction(id: string, amount: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const raw = typeof amount === 'string' ? amount.trim() : amount;
  if (raw === '' || raw === null || raw === undefined) {
    return { ok: false, error: 'Enter an amount, for example 5.00', field: 'minimumSavings' };
  }

  let cents: number;
  try {
    cents = dollarsToCents(raw as string | number);
  } catch {
    return { ok: false, error: 'Enter a valid amount, for example 5.00', field: 'minimumSavings' };
  }
  if (cents < 0) return { ok: false, error: 'That cannot be negative.', field: 'minimumSavings' };
  if (cents > 100_000) {
    return {
      ok: false,
      error: 'A threshold above $1,000 would silence this trip entirely.',
      field: 'minimumSavings',
    };
  }

  const db = await getServerSupabase();
  const { data, error } = await db
    .from('watches')
    .update({ minimum_savings_cents: cents })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Could not save the threshold.' };

  revalidateWatch(id);
  return {
    ok: true,
    message:
      cents === 0
        ? 'Any cheaper option will now qualify.'
        : `Only options at least ${formatCents(cents)} cheaper will qualify.`,
  };
}

export async function extendWatchAction(id: string, days: number): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };
  if (!EXTEND_OPTIONS.some((option) => option.days === days)) {
    return { ok: false, error: 'Choose one of the offered extensions.' };
  }

  const db = await getServerSupabase();
  const { data: current } = await db
    .from('watches')
    .select('monitoring_ends_at, desired_date, date_flexibility_days, status, timezone')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!current) return { ok: false, error: 'Not found.' };

  const row = current as {
    monitoring_ends_at: string;
    desired_date: string;
    date_flexibility_days: number;
    status: string;
  };

  const now = new Date();
  const from = new Date(Math.max(now.getTime(), new Date(row.monitoring_ends_at).getTime()));
  const proposed = new Date(from.getTime() + days * 86_400_000);

  // The last moment worth checking: the end of the latest date in the window.
  const lastTravelDate = addDays(toDateString(row.desired_date), row.date_flexibility_days);
  const ceiling = new Date(`${lastTravelDate}T23:59:59.000Z`);

  if (ceiling.getTime() <= now.getTime()) {
    return {
      ok: false,
      error: 'Every date in this window has already passed, so there is nothing left to check.',
    };
  }

  const next = new Date(Math.min(proposed.getTime(), ceiling.getTime()));
  if (next.getTime() <= new Date(row.monitoring_ends_at).getTime()) {
    return { ok: false, error: 'Monitoring already runs to the last date of this trip.' };
  }

  const { data, error } = await db
    .from('watches')
    .update({
      monitoring_ends_at: next.toISOString(),
      // An extension is also a resumption: a window that ran out is the most
      // common reason a watch is sitting in COMPLETED.
      ...(row.status === 'COMPLETED' || row.status === 'ACTIVE'
        ? { status: 'ACTIVE', status_reason: null }
        : {}),
    })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Could not extend monitoring.' };

  await recordEvent(db, id, user.id, 'EXTENDED', { days, until: next.toISOString() });
  revalidateWatch(id);
  const capped = next.getTime() === ceiling.getTime() && proposed.getTime() > ceiling.getTime();
  return {
    ok: true,
    message: capped
      ? 'Extended to the last date of this trip, which is as far as checking can help.'
      : `Monitoring extended. Next end: ${formatMediumDate(toDateString(next.toISOString()))}.`,
  };
}

export async function rebookAction(id: string, input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const parsed = rebookSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first?.message ?? 'Enter the amount you paid.',
      field: first?.path.join('.'),
    };
  }

  const watch = await loadOwnedWatch(id);
  if (!watch) return { ok: false, error: 'Not found.' };

  try {
    const db = await getServerSupabase();
    const previousCents = watch.benchmark_cents;
    await rebookWatch(db, watch, parsed.data);
    await recordEvent(db, id, user.id, 'REBOOKED', {
      fromCents: previousCents,
      toCents: parsed.data.amountPaid,
    });
    revalidateWatch(id);
    return { ok: true, message: 'New price saved. Monitoring continues against it.' };
  } catch (error) {
    logger.error('rebook failed', { watch_id: id, ...describeError(error) });
    return { ok: false, error: 'Could not record the rebooking.' };
  }
}

export async function manualCheckAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const watch = await loadOwnedWatch(id);
  if (!watch) return { ok: false, error: 'Not found.' };
  if (!isServiceConfigured()) return { ok: false, error: 'Background worker is not configured.' };

  const db = await getServiceClientAsync();

  // Atomic: the reservation and the cooldown guard are one statement, so a
  // double-click cannot put two provider runs through the gate.
  const claim = await claimManualCheck(db, watch);
  if (!claim.cycleId) {
    return {
      ok: false,
      error: `You just checked this trip. Try again in ${Math.ceil(claim.retryAfterSeconds / 60)} min.`,
    };
  }

  try {
    const result = await runSingleWatchCycle(
      db,
      createFareProvider(),
      watch,
      'MANUAL',
      new Date(),
      {
        reservedCycleId: claim.cycleId,
      },
    );
    revalidateWatch(id);

    const cycle = result.cycles[0];
    if (cycle?.status === 'FAILED') {
      return {
        ok: true,
        message: 'The fare provider could not be reached. Nothing was concluded.',
      };
    }
    if (cycle?.status === 'PARTIAL_SUCCESS') {
      return { ok: true, message: 'Checked — some dates could not be reached.' };
    }
    return { ok: true, message: 'Check complete.' };
  } catch (error) {
    logger.error('manual check failed', { watch_id: id, ...describeError(error) });
    // The reservation row is RUNNING; close it so it does not sit there forever,
    // invisible to the UI and blocking the next manual check.
    await db
      .from('fare_check_cycles')
      .update({
        status: 'FAILED',
        error_kind: 'WORKER',
        error_message: describeError(error).message.slice(0, 400),
        completed_at: new Date().toISOString(),
      })
      .eq('id', claim.cycleId)
      .eq('status', 'RUNNING');
    revalidateWatch(id);
    return { ok: false, error: 'The fare check could not be completed.' };
  }
}
