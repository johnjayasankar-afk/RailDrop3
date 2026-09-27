'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { clockToMinutesOrNull } from '@/lib/domain/quiet-hours';
import { isValidTimeZone } from '@/lib/domain/dates';
import { dollarsToCents } from '@/lib/domain/money';
import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { getServiceClientAsync, isServiceConfigured } from '@/lib/db/service';
import { createLogger, describeError } from '@/lib/log';

const logger = createLogger({ component: 'settings-actions' });

const clock = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
  .or(z.literal(''))
  .optional()
  .nullable();

const settingsSchema = z
  .object({
    emailAlerts: z.coerce.boolean(),
    pushAlerts: z.coerce.boolean(),
    quietHoursEnabled: z.coerce.boolean(),
    quietHoursStart: clock,
    quietHoursEnd: clock,
    timezone: z.string().min(1),
    defaultMinSavings: z.union([z.string(), z.number()]),
  })
  .refine((v) => !v.quietHoursEnabled || (v.quietHoursStart && v.quietHoursEnd), {
    message: 'Set both a start and an end time for quiet hours',
    path: ['quietHoursStart'],
  });

export interface SettingsResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function saveSettingsAction(input: unknown): Promise<SettingsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  const value = parsed.data;

  if (!isValidTimeZone(value.timezone)) {
    return { ok: false, error: 'That timezone is not recognised.' };
  }

  let minSavings: number;
  try {
    minSavings = dollarsToCents(value.defaultMinSavings);
  } catch {
    return { ok: false, error: 'Enter a valid minimum saving, for example 5.00' };
  }

  const db = await getServerSupabase();
  // Only the columns 0006 grants: `email` is deliberately NOT user-writable,
  // because it is the alert recipient and would otherwise be a mail relay.
  const { error } = await db
    .from('profiles')
    .update({
      email_alerts: value.emailAlerts,
      push_alerts: value.pushAlerts,
      quiet_hours_start: value.quietHoursEnabled
        ? clockToMinutesOrNull(value.quietHoursStart)
        : null,
      quiet_hours_end: value.quietHoursEnabled ? clockToMinutesOrNull(value.quietHoursEnd) : null,
      timezone: value.timezone,
      default_min_savings_cents: minSavings,
    })
    .eq('id', user.id);

  if (error) {
    logger.error('could not save settings', { error: error.message });
    return { ok: false, error: 'Could not save your settings.' };
  }

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  return { ok: true, message: 'Settings saved.' };
}

/** Dismiss the first-run checklist. Idempotent, and never un-dismisses. */
export async function dismissSetupAction(): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const db = await getServerSupabase();
  const { error } = await db
    .from('profiles')
    .update({ onboarded_at: new Date().toISOString() })
    .eq('id', user.id)
    .is('onboarded_at', null);

  if (error) return { ok: false, error: 'Could not save that.' };
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Delete the account and everything in it.
 *
 * Irreversible by design and by contract: the trip data cascades from the auth
 * row, so there is no soft-delete window here the way there is for a single
 * trip. The caller must confirm in the UI before this runs.
 *
 * Two paths, and the difference is reported honestly rather than papered over:
 *
 *   - with a service role, the auth user is deleted and every row cascades;
 *   - without one, the user's own rows are deleted through RLS and the login
 *     record survives. Claiming a full deletion in that case would be a lie,
 *     so the result says exactly what happened.
 */
export async function deleteAccountAction(confirmation: string): Promise<{
  ok: boolean;
  error?: string;
  message?: string;
  signOut?: boolean;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  if (confirmation.trim().toUpperCase() !== 'DELETE') {
    return { ok: false, error: 'Type DELETE to confirm.' };
  }

  const db = await getServerSupabase();

  // Remove the rows this session owns first. Under RLS these can only ever
  // match the caller, so an unexpected extra row is impossible by construction.
  const { error: watchError } = await db.from('watches').delete().eq('user_id', user.id);
  if (watchError) {
    logger.error('account deletion could not remove watches', { error: watchError.message });
    return { ok: false, error: 'Could not delete your data. Nothing was removed.' };
  }
  await db.from('push_subscriptions').delete().eq('user_id', user.id);

  if (!isServiceConfigured()) {
    logger.warn('account deleted without a service role; auth record retained', {
      user_id: user.id,
    });
    return {
      ok: true,
      signOut: true,
      message:
        'All of your trip data has been deleted. Your sign-in record remains — ask the operator to remove it.',
    };
  }

  try {
    const service = await getServiceClientAsync();
    await service.from('profiles').delete().eq('id', user.id);
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) throw new Error(error.message);
  } catch (error) {
    logger.error('could not delete the auth user', describeError(error));
    return {
      ok: true,
      signOut: true,
      message:
        'All of your trip data has been deleted. The sign-in record could not be removed automatically.',
    };
  }

  return {
    ok: true,
    signOut: true,
    message: 'Your account and all of its data have been deleted.',
  };
}
