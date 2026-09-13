'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';

import { describeDisplacement, formatMediumDate } from '@/lib/domain/dates';
import { formatCents } from '@/lib/domain/money';
import { describeOutcome } from '@/lib/domain/alert-outcomes';
import { clockFromLocalIso, describeService, formatDateTimeInZone } from '@/lib/format';
import { alertReasonLabel } from '@/lib/labels';
import type { AlertHistoryRow } from '@/lib/queries';
import { RouteLine } from './RouteLine';
import { useListKeys } from './use-list-keys';
import { Badge } from './ui';

const DELIVERY_TONE: Record<string, 'save' | 'warn' | 'danger' | 'neutral'> = {
  SENT: 'save',
  PENDING: 'neutral',
  FAILED: 'warn',
  ABANDONED: 'danger',
};

type Filter = 'all' | 'acted' | 'open' | 'undelivered';

/**
 * Alert history, grouped by the day it happened.
 *
 * A flat reverse-chronological list is fine at three alerts and unreadable at
 * three hundred: every row looks the same and there is no sense of when
 * anything happened. Day headers give the list a spine, and the filters answer
 * the two questions people actually bring here — "which of these did I act on"
 * and "did any of them fail to reach me".
 */
export function AlertList({ alerts, timezone }: { alerts: AlertHistoryRow[]; timezone: string }) {
  const [filter, setFilter] = useState<Filter>('all');

  const listRef = useRef<HTMLDivElement>(null);
  useListKeys(listRef, '[data-list-item]');

  const counts = useMemo(
    () => ({
      all: alerts.length,
      acted: alerts.filter((a) => a.outcome.kind === 'REBOOKED').length,
      open: alerts.filter((a) => a.outcome.kind !== 'REBOOKED').length,
      undelivered: alerts.filter((a) =>
        a.deliveries.some((d) => d.status === 'FAILED' || d.status === 'ABANDONED'),
      ).length,
    }),
    [alerts],
  );

  const visible = useMemo(
    () =>
      alerts.filter((alert) => {
        if (filter === 'acted') return alert.outcome.kind === 'REBOOKED';
        if (filter === 'open') return alert.outcome.kind !== 'REBOOKED';
        if (filter === 'undelivered')
          return alert.deliveries.some((d) => d.status === 'FAILED' || d.status === 'ABANDONED');
        return true;
      }),
    [alerts, filter],
  );

  // Grouped by the day the alert fired, in the user's own timezone — grouping
  // on the UTC date would put an 8pm Eastern alert under the following day.
  const days = useMemo(() => {
    const map = new Map<string, AlertHistoryRow[]>();
    for (const alert of visible) {
      const key = dayKey(alert.createdAt, timezone);
      const list = map.get(key);
      if (list) list.push(alert);
      else map.set(key, [alert]);
    }
    return [...map.entries()];
  }, [visible, timezone]);

  const FILTERS: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'acted', label: 'Rebooked after' },
    { id: 'open', label: 'No rebooking' },
    { id: 'undelivered', label: 'Delivery failed' },
  ];

  return (
    <div>
      {/* Useful from two: sorting one alert is not a job. */}
      {alerts.length > 1 ? (
        <div
          data-testid="alert-filters"
          role="group"
          aria-label="Filter alerts"
          className="mt-6 flex flex-wrap items-center gap-1.5"
        >
          {FILTERS.map((option) => {
            const count = counts[option.id];
            if (option.id !== 'all' && count === 0) return null;
            const on = filter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(option.id)}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors ${
                  on
                    ? 'border-ink bg-invert text-on-invert'
                    : 'border-line text-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {option.label}
                <span className={`tnum text-[11px] ${on ? 'opacity-70' : 'text-faint'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="rd-card mt-4 px-5 py-10 text-center">
          <p className="text-[15px] font-semibold text-ink">Nothing here</p>
          <p className="mt-1 text-[13px] text-muted">No alert matches that filter.</p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="rd-btn rd-btn-secondary mt-4 !min-h-11 !text-[14px]"
          >
            Show all alerts
          </button>
        </div>
      ) : (
        <div ref={listRef} className="mt-4 space-y-6">
          {days.map(([day, rows]) => (
            <section key={day}>
              <h2 className="rd-label sticky top-14 z-10 -mx-1 bg-paper/90 px-1 py-1.5 backdrop-blur-sm">
                {day}
                <span className="ml-2 tnum font-medium normal-case tracking-normal text-faint">
                  {rows.length} alert{rows.length === 1 ? '' : 's'}
                </span>
              </h2>
              <ol role="list" className="mt-1.5 space-y-2">
                {rows.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} timezone={timezone} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function AlertRow({ alert, timezone }: { alert: AlertHistoryRow; timezone: string }) {
  const reason = alertReasonLabel(alert.reason);
  const outcome = describeOutcome(alert.outcome);

  return (
    <li>
      <Link
        href={`/watches/${alert.watchId}`}
        data-testid="alert-row"
        data-list-item
        className="rd-card group relative block overflow-hidden px-5 py-3.5 outline-none transition-colors hover:border-line-strong focus-visible:border-rust focus-visible:ring-2 focus-visible:ring-rust/40"
      >
        {alert.outcome.kind === 'REBOOKED' ? (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-save" />
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <RouteLine origin={alert.originCode} destination={alert.destinationCode} size="sm" />
            <Badge tone="rust" title={reason.explanation}>
              {reason.label}
            </Badge>
            {alert.cycleStatus === 'PARTIAL_SUCCESS' ? (
              <Badge tone="warn">Some dates not checked</Badge>
            ) : null}
          </div>

          <div className="flex shrink-0 items-baseline gap-3">
            <span className="tnum text-[13px] text-faint">
              was {formatCents(alert.benchmarkCents)}
            </span>
            <span className="tnum text-[21px] font-bold leading-none tracking-tight text-ink">
              {formatCents(alert.bestTotalCents)}
            </span>
            <span className="tnum text-[13px] font-semibold text-save">
              &minus;{formatCents(alert.savingsCents)}
            </span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="min-w-0 text-[12.5px] leading-relaxed text-muted">
            {alert.best?.travelDate ? formatMediumDate(alert.best.travelDate) : null}
            {alert.best?.displacementDays !== null && alert.best?.displacementDays !== undefined ? (
              <> · {describeDisplacement(alert.best.displacementDays)}</>
            ) : null}
            {alert.best?.serviceName || alert.best?.trainNumber ? (
              <> · {describeService(alert.best.serviceName, alert.best.trainNumber)}</>
            ) : null}
            {alert.best?.departureLocal ? (
              <>
                {' '}
                · <span className="ticket">{clockFromLocalIso(alert.best.departureLocal)}</span>
              </>
            ) : null}
          </p>

          <span className="flex shrink-0 items-center gap-2">
            {/* With no outcome to report, the delivery badges ride the meta
                line rather than earning a rule and a near-empty strip. */}
            {outcome ? null : <DeliveryBadges alert={alert} />}
            <span className="tnum text-[11.5px] text-faint">
              {formatDateTimeInZone(alert.createdAt, timezone)}
            </span>
          </span>
        </div>

        {outcome ? (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-line pt-2.5">
            {/* Sequence, not causation: what happened after, never why. */}
            <p
              data-testid="alert-outcome"
              className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]"
            >
              <span className="font-semibold text-save">{outcome}</span>
              {alert.outcome.kind === 'REBOOKED' ? (
                <span className="tnum text-muted">
                  at {formatCents(alert.outcome.dropCents)} below the previous benchmark
                </span>
              ) : null}
            </p>
            <DeliveryBadges alert={alert} />
          </div>
        ) : null}
      </Link>
    </li>
  );
}

/** "Today", "Yesterday", or a written date — in the user's timezone. */
function dayKey(iso: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full' });
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  let stamp: Date;
  try {
    stamp = new Date(iso);
    if (Number.isNaN(stamp.getTime())) return 'Earlier';
  } catch {
    return 'Earlier';
  }

  const now = new Date();
  if (formatter.format(stamp) === formatter.format(now)) return 'Today';
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (formatter.format(stamp) === formatter.format(yesterday)) return 'Yesterday';
  return short.format(stamp);
}

/** Which channel carried the alert, and how it went. */
function DeliveryBadges({ alert }: { alert: AlertHistoryRow }) {
  if (alert.deliveries.length === 0) return <Badge tone="neutral">In-app only</Badge>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {alert.deliveries.map((delivery, index) => (
        <Badge
          key={`${delivery.channel}-${index}`}
          tone={DELIVERY_TONE[delivery.status] ?? 'neutral'}
          title={delivery.error ?? undefined}
        >
          {delivery.channel === 'PUSH' ? 'Push' : 'Email'} · {delivery.status.toLowerCase()}
        </Badge>
      ))}
    </span>
  );
}
