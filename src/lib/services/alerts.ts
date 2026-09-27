import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { decideAlert, nextAlertState } from '@/lib/domain/alert-comparator';
import type { AlertReason, AlertState, CycleStatus, Opportunity, Watch } from '@/lib/domain/types';
import { getServerEnv, publicEnv } from '@/lib/env';
import { createLogger, describeError } from '@/lib/log';
import { renderAlertEmail } from '@/lib/email/render';
import { heldUntil } from '@/lib/domain/quiet-hours';
import { describeDisplacement, formatShortDate } from '@/lib/domain/dates';
import { formatCentsCompact } from '@/lib/domain/money';
import { isPushConfigured } from '@/lib/push/config';
import { sendPushToUser } from '@/lib/push/send';
import { sendEmail as sendEmailTransport, isEmailConfigured } from '@/lib/email/transport';
import type { WatchJob } from './batch-runner';

const logger = createLogger({ component: 'alerts' });

export interface AlertOutcome {
  alertCreated: boolean;
  emailSent: boolean;
  pushSent: boolean;
  reason: AlertReason | null;
  suppressedReason: string | null;
  alertId: string | null;
  deliveryId: string | null;
}

export interface ProcessAlertInput {
  db: SupabaseClient;
  watch: Watch;
  job: WatchJob;
  cycleId: string | null;
  cycleStatus: CycleStatus;
  opportunities: Opportunity[];
  uncheckedDates: string[];
  now: Date;
  sendEmail: boolean;
}

const MAX_OTHER_OPTIONS = 3;

export async function processAlert(input: ProcessAlertInput): Promise<AlertOutcome> {
  const env = getServerEnv();
  const { db, watch, cycleId, cycleStatus, opportunities, uncheckedDates, now } = input;

  // Re-read alert state and benchmark version: the user may have rebooked while
  // this cycle was in flight, which invalidates every savings figure we computed.
  const { data: fresh, error: freshError } = await db
    .from('watches')
    .select(
      'benchmark_version, benchmark_cents, target_price_cents, last_alerted_at, last_alert_best_total_cents, last_alert_signature, last_alert_convenience_score',
    )
    .eq('id', watch.id)
    .single();

  if (freshError || !fresh) {
    logger.error('could not re-read watch before alerting', {
      watch_id: watch.id,
      error: freshError?.message,
    });
    return none('CYCLE_FAILED');
  }

  const row = fresh as {
    benchmark_version: number;
    benchmark_cents: number;
    target_price_cents: number | null;
    last_alerted_at: string | null;
    last_alert_best_total_cents: number | null;
    last_alert_signature: string | null;
    last_alert_convenience_score: number | null;
  };

  const benchmarkChanged =
    row.benchmark_version !== watch.benchmarkVersion ||
    row.benchmark_cents !== watch.benchmarkCents;

  const state: AlertState = {
    lastAlertedAt: row.last_alerted_at,
    lastBestTotalCents: row.last_alert_best_total_cents,
    lastBestSignature: row.last_alert_signature,
    lastBestConvenienceScore: row.last_alert_convenience_score,
  };

  const decision = decideAlert({
    opportunities,
    state,
    cycleStatus,
    now,
    benchmarkChanged,
    benchmarkVersion: row.benchmark_version,
    targetPriceCents: row.target_price_cents,
    thresholds: {
      materialDropCents: env.alertMaterialDropCents,
      urgentDropCents: env.alertUrgentDropCents,
      cooldownMinutes: env.alertCooldownMinutes,
      convenienceDelta: env.alertConvenienceDelta,
      priceToleranceCents: env.alertPriceToleranceCents,
      priceTolerancePct: env.alertPriceTolerancePct,
    },
  });

  if (!decision.shouldAlert || !decision.best || !decision.reason || !decision.dedupeKey) {
    return none(decision.suppressedReason);
  }

  const best = decision.best;
  const others = opportunities.slice(1, 1 + MAX_OTHER_OPTIONS);

  // The unique (watch_id, dedupe_key) index is what makes a retried cycle safe.
  const { data: alertRow, error: alertError } = await db
    .from('alerts')
    .insert({
      watch_id: watch.id,
      user_id: watch.userId,
      cycle_id: cycleId,
      reason: decision.reason,
      dedupe_key: decision.dedupeKey,
      benchmark_cents: watch.benchmarkCents,
      best_total_cents: best.totalCents,
      savings_cents: best.savingsCents,
      best_signature: best.signature,
      best_convenience_score: best.convenienceScore,
      cycle_status: cycleStatus,
      unchecked_dates: uncheckedDates,
      options_snapshot: [best, ...others].map(summariseOpportunity),
    })
    .select('id')
    .single();

  if (alertError) {
    // 23505 = unique violation: this exact alert already exists. Correct no-op.
    if (alertError.code === '23505') {
      logger.info('duplicate alert suppressed by dedupe key', {
        watch_id: watch.id,
        dedupe_key: decision.dedupeKey,
      });
      return none('NO_MATERIAL_CHANGE');
    }
    logger.error('failed to create alert', { watch_id: watch.id, error: alertError.message });
    return none('CYCLE_FAILED');
  }

  const alertId = (alertRow as { id: string }).id;

  // Alert state advances even if email later fails: the dashboard is a first
  // class delivery channel, and we must not re-alert on the same information.
  await db
    .from('watches')
    .update({
      last_alerted_at: nextAlertState(best, now).lastAlertedAt,
      last_alert_best_total_cents: best.totalCents,
      last_alert_signature: best.signature,
      last_alert_convenience_score: best.convenienceScore,
    })
    .eq('id', watch.id);

  const profile = await loadNotificationProfile(db, watch.userId, input.job);

  // Quiet hours HOLD a notification, they never drop one. The delivery row is
  // written immediately with a deliver_after stamp and the retry sweep picks it
  // up when the window closes.
  const holdUntil = heldUntil(now, profile.timezone ?? watch.timezone, {
    startMinutes: profile.quietHoursStart,
    endMinutes: profile.quietHoursEnd,
  });

  const watchUrl = `${publicEnv.appUrl.replace(/\/+$/, '')}/watches/${watch.id}`;
  let emailSent = false;
  let pushSent = false;
  let firstDeliveryId: string | null = null;

  // ── Email ─────────────────────────────────────────────────────────────────
  if (profile.emailAlerts && profile.email) {
    const email = renderAlertEmail({
      watch,
      reason: decision.reason,
      best,
      others,
      benchmarkCents: watch.benchmarkCents,
      cycleStatus,
      uncheckedDates,
      watchUrl,
    });

    // The delivery row is written BEFORE the send, so a crash between send and
    // record cannot lose the fact that a notification was attempted.
    const deliveryId = await createDelivery(db, {
      alertId,
      watch,
      channel: 'EMAIL',
      recipient: profile.email,
      subject: email.subject,
      deliverAfter: holdUntil,
    });
    firstDeliveryId ??= deliveryId;

    if (deliveryId && !holdUntil) {
      if (!input.sendEmail || !isEmailConfigured()) {
        await db
          .from('notification_deliveries')
          .update({ status: 'FAILED', attempt: 1, error: 'Email transport not configured.' })
          .eq('id', deliveryId);
      } else {
        emailSent = await deliverEmail(db, {
          deliveryId,
          recipient: profile.email,
          email,
          attempt: 0,
          maxAttempts: env.emailMaxAttempts,
        });
      }
    }
  }

  // ── Push ──────────────────────────────────────────────────────────────────
  if (profile.pushAlerts && isPushConfigured()) {
    // Hitting a target the user named themselves deserves to read differently
    // from "something got cheaper" — it is the notification they asked for.
    const title =
      decision.reason === 'TARGET_REACHED'
        ? `Target reached — ${watch.originCode} to ${watch.destinationCode} at ${formatCentsCompact(best.totalCents)}`
        : `${watch.originCode} to ${watch.destinationCode} — ${formatCentsCompact(best.totalCents)}`;
    const body = `Save ${formatCentsCompact(best.savingsCents)} on ${formatShortDate(best.candidate.journey.travelDate)}. ${describeDisplacement(best.displacementDays)}.`;

    const deliveryId = await createDelivery(db, {
      alertId,
      watch,
      channel: 'PUSH',
      recipient: `user:${watch.userId}`,
      subject: title,
      deliverAfter: holdUntil,
    });
    firstDeliveryId ??= deliveryId;

    if (deliveryId && !holdUntil && input.sendEmail) {
      const result = await sendPushToUser(db, watch.userId, {
        title,
        body,
        url: watchUrl,
        tag: `raildrop-${watch.id}`,
      });
      pushSent = result.sent > 0;
      await db
        .from('notification_deliveries')
        .update(
          pushSent
            ? { status: 'SENT', attempt: 1, sent_at: new Date().toISOString() }
            : {
                status: result.removed > 0 ? 'ABANDONED' : 'FAILED',
                attempt: 1,
                error: result.removed > 0 ? 'No live subscription.' : 'No device subscribed.',
              },
        )
        .eq('id', deliveryId);
    }
  }

  if (holdUntil) {
    logger.info('notification held for quiet hours', {
      watch_id: watch.id,
      alert_id: alertId,
      deliver_after: holdUntil.toISOString(),
    });
  }

  return {
    alertCreated: true,
    emailSent,
    pushSent,
    reason: decision.reason,
    suppressedReason: null,
    alertId,
    deliveryId: firstDeliveryId,
  };
}

interface CreateDeliveryInput {
  alertId: string;
  watch: Watch;
  channel: 'EMAIL' | 'PUSH';
  recipient: string;
  subject: string;
  deliverAfter: Date | null;
}

async function createDelivery(
  db: SupabaseClient,
  input: CreateDeliveryInput,
): Promise<string | null> {
  const { data, error } = await db
    .from('notification_deliveries')
    .insert({
      alert_id: input.alertId,
      watch_id: input.watch.id,
      user_id: input.watch.userId,
      channel: input.channel,
      recipient: input.recipient,
      subject: input.subject,
      status: 'PENDING',
      attempt: 0,
      deliver_after: input.deliverAfter ? input.deliverAfter.toISOString() : null,
    })
    .select('id')
    .single();

  if (error) {
    logger.error('failed to record delivery', { alert_id: input.alertId, error: error.message });
    return null;
  }
  return (data as { id: string }).id;
}

export interface DeliverInput {
  deliveryId: string;
  recipient: string;
  email: { subject: string; html: string; text: string };
  attempt: number;
  maxAttempts: number;
}

export async function deliverEmail(db: SupabaseClient, input: DeliverInput): Promise<boolean> {
  const attempt = input.attempt + 1;
  try {
    // The delivery id is the idempotency key: a retry after a post-acceptance
    // timeout is collapsed by Resend rather than delivered twice.
    const result = await sendEmailTransport({
      to: input.recipient,
      email: input.email,
      idempotencyKey: input.deliveryId,
    });

    if (result.ok) {
      await db
        .from('notification_deliveries')
        .update({
          status: 'SENT',
          attempt,
          provider_message_id: result.messageId,
          sent_at: new Date().toISOString(),
          error: null,
        })
        .eq('id', input.deliveryId);
      logger.info('alert email sent', { notification_id: input.deliveryId, attempt });
      return true;
    }

    const exhausted = attempt >= input.maxAttempts || !result.retryable;
    await db
      .from('notification_deliveries')
      .update({
        status: exhausted ? 'ABANDONED' : 'FAILED',
        attempt,
        error: result.error?.slice(0, 400) ?? 'Unknown email failure',
      })
      .eq('id', input.deliveryId);
    logger.error('alert email failed', {
      notification_id: input.deliveryId,
      attempt,
      retryable: result.retryable,
      error: result.error,
    });
    return false;
  } catch (error) {
    await db
      .from('notification_deliveries')
      .update({ status: 'FAILED', attempt, error: describeError(error).message.slice(0, 400) })
      .eq('id', input.deliveryId);
    return false;
  }
}

/** Retry deliveries that failed transiently on a previous cycle. */
export async function retryPendingDeliveries(db: SupabaseClient, limit = 20): Promise<number> {
  const env = getServerEnv();
  if (!isEmailConfigured()) return 0;

  // PENDING must be included. A process that dies inside the send leaves the row
  // PENDING forever while the watch's alert state has ALREADY advanced - so the
  // next cycle computes drop=0, returns NO_MATERIAL_CHANGE, and the user is
  // never told about a real price drop. Resend's idempotency key makes an
  // overlapping retry harmless.
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60_000).toISOString();
  const { data, error } = await db
    .from('notification_deliveries')
    .select(
      'id, recipient, subject, attempt, alert_id, updated_at, channel, deliver_after, watch_id, user_id',
    )
    .in('status', ['PENDING', 'FAILED'])
    .lt('attempt', env.emailMaxAttempts)
    .lt('updated_at', staleBefore)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error || !data || data.length === 0) return 0;

  let sent = 0;
  for (const row of data as Array<{
    id: string;
    recipient: string;
    subject: string;
    attempt: number;
    alert_id: string;
    updated_at: string;
    channel: string;
    deliver_after: string | null;
    watch_id: string;
    user_id: string;
  }>) {
    // Held for quiet hours: not due yet, and not a failure.
    if (row.deliver_after && new Date(row.deliver_after) > now) continue;

    // Exponential backoff. Without it the dispatcher's own end-of-run sweep
    // burns attempts 1 and 2 seconds apart, so EMAIL_MAX_ATTEMPTS=3 buys two
    // time windows rather than three and a brief provider incident abandons a
    // delivery that would have succeeded minutes later.
    const backoffMs = 5 * 60_000 * 2 ** Math.max(0, row.attempt - 1);
    const lastTouched = new Date(row.updated_at).getTime();
    if (Number.isFinite(lastTouched) && now.getTime() - lastTouched < backoffMs) continue;

    if (row.channel === 'PUSH') {
      const result = await sendPushToUser(db, row.user_id, {
        title: row.subject,
        body: 'A cheaper option is available on your watched route.',
        url: `${publicEnv.appUrl.replace(/\/+$/, '')}/watches/${row.watch_id}`,
        tag: `raildrop-${row.watch_id}`,
      });
      await db
        .from('notification_deliveries')
        .update(
          result.sent > 0
            ? { status: 'SENT', attempt: row.attempt + 1, sent_at: new Date().toISOString() }
            : { status: 'FAILED', attempt: row.attempt + 1, error: 'No device subscribed.' },
        )
        .eq('id', row.id);
      if (result.sent > 0) sent += 1;
      continue;
    }

    const { data: alert } = await db
      .from('alerts')
      .select('options_snapshot')
      .eq('id', row.alert_id)
      .single();
    if (!alert) continue;

    // Re-send the recorded subject with a minimal body; the full alert always
    // remains available in the dashboard.
    const ok = await deliverEmail(db, {
      deliveryId: row.id,
      recipient: row.recipient,
      email: {
        subject: row.subject,
        html: `<p>${row.subject}</p><p><a href="${publicEnv.appUrl}">Open RailDrop</a></p>`,
        text: `${row.subject}\n\nOpen RailDrop: ${publicEnv.appUrl}`,
      },
      attempt: row.attempt,
      maxAttempts: env.emailMaxAttempts,
    });
    if (ok) sent += 1;
  }
  return sent;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function none(suppressedReason: string | null): AlertOutcome {
  return {
    alertCreated: false,
    emailSent: false,
    pushSent: false,
    reason: null,
    suppressedReason,
    alertId: null,
    deliveryId: null,
  };
}

interface NotificationProfile {
  email: string | null;
  emailAlerts: boolean;
  pushAlerts: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
}

async function loadNotificationProfile(
  db: SupabaseClient,
  userId: string,
  job: WatchJob,
): Promise<NotificationProfile> {
  const { data } = await db
    .from('profiles')
    .select('email, email_alerts, push_alerts, quiet_hours_start, quiet_hours_end, timezone')
    .eq('id', userId)
    .maybeSingle();

  const row = data as {
    email: string | null;
    email_alerts: boolean | null;
    push_alerts: boolean | null;
    quiet_hours_start: number | null;
    quiet_hours_end: number | null;
    timezone: string | null;
  } | null;

  return {
    email: row?.email ?? job.recipientEmail ?? null,
    // Default to on: a missing preferences row must not silence someone.
    emailAlerts: row?.email_alerts ?? true,
    pushAlerts: row?.push_alerts ?? true,
    quietHoursStart: row?.quiet_hours_start ?? null,
    quietHoursEnd: row?.quiet_hours_end ?? null,
    timezone: row?.timezone ?? null,
  };
}

function summariseOpportunity(opp: Opportunity): Record<string, unknown> {
  const j = opp.candidate.journey;
  return {
    travelDate: j.travelDate,
    displacementDays: opp.displacementDays,
    totalCents: opp.totalCents,
    savingsCents: opp.savingsCents,
    serviceName: j.serviceName,
    trainNumber: j.trainNumber,
    departureLocal: j.departureLocal,
    arrivalLocal: j.arrivalLocal,
    durationMinutes: j.durationMinutes,
    transfers: j.transfers,
    fareFamily: opp.candidate.fare.family,
    travelClass: opp.candidate.fare.travelClass,
    availability: opp.candidate.fare.availability,
    signature: opp.signature,
  };
}
