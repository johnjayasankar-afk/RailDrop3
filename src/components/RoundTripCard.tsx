'use client';

import Link from 'next/link';

import { formatShortDate } from '@/lib/domain/dates';
import { formatCents } from '@/lib/domain/money';
import { flexibilityLabel, formatTimeInZone, toDateString } from '@/lib/format';
import type { WatchSummary } from '@/lib/queries';
import { RouteLine } from './RouteLine';
import { savingsOf } from './WatchCard';
import { Badge } from './ui';

/**
 * Both legs of a round trip, as one journey.
 *
 * Linked legs previously rendered as two unrelated cards that could sit pages
 * apart in a sorted list, each carrying a "Round trip" badge that pointed at
 * nothing. The pairing existed in the database and nowhere a person could see
 * it, which made the feature real only to the schema.
 *
 * Each leg still links to its own page and keeps its own benchmark, dates and
 * alert state — nothing here merges the monitoring, only the presentation. The
 * one genuinely new number is the combined saving, which is the only figure
 * that needs both legs to mean anything.
 */
export function RoundTripCard({
  outbound,
  inbound,
}: {
  outbound: WatchSummary;
  inbound: WatchSummary;
}) {
  const legs = [outbound, inbound];
  const combined = legs.reduce((total, leg) => total + savingsOf(leg), 0);
  const paid = legs.reduce((total, leg) => total + leg.row.benchmark_cents, 0);
  const anyPinned = legs.some((leg) => leg.row.pinned);
  const combinedPct = combined > 0 && paid > 0 ? Math.round((combined / paid) * 100) : null;

  return (
    <article
      data-testid="watch-card"
      data-round-trip="true"
      className="rd-card relative overflow-hidden"
    >
      {combined > 0 ? (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-save" />
      ) : null}

      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="rd-label">Round trip</span>
          {anyPinned ? <Badge tone="rust">Pinned</Badge> : null}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="tnum text-[12px] text-faint">Paid {formatCents(paid)} in total</span>
          {combined > 0 ? (
            <span className="tnum text-[14px] font-bold text-save">
              Save {formatCents(combined)}
              {combinedPct !== null ? (
                <span className="ml-1.5 text-[11.5px] font-semibold text-save/80">
                  {combinedPct}%
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-[12.5px] text-muted">Nothing cheaper on either leg yet</span>
          )}
        </div>
      </header>

      <div className="divide-y divide-line">
        {legs.map((leg, index) => (
          <Leg key={leg.row.id} summary={leg} direction={index === 0 ? 'out' : 'back'} />
        ))}
      </div>
    </article>
  );
}

function Leg({ summary, direction }: { summary: WatchSummary; direction: 'out' | 'back' }) {
  const { row, bestOption, latestCycle, nextCheckAt } = summary;
  const savings = savingsOf(summary);
  const hasDrop = savings > 0;
  const checkFailed = latestCycle?.status === 'FAILED';

  return (
    <Link
      href={`/watches/${row.id}`}
      data-testid="round-trip-leg"
      data-list-item
      className="group flex flex-col gap-2 px-5 py-3.5 outline-none transition-colors hover:bg-raised/60 focus-visible:bg-raised focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rust sm:flex-row sm:items-center sm:gap-x-6"
    >
      {/* Two stacked rows below sm, one row above. Wrapping a single flex row
          at 390px broke the date across three lines and crushed the prices. */}
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <span
          aria-hidden="true"
          className="grid size-6 shrink-0 place-items-center rounded-md bg-raised text-[13px] font-bold text-muted"
        >
          {direction === 'out' ? '→' : '←'}
        </span>
        <span className="sr-only">{direction === 'out' ? 'Outbound leg' : 'Return leg'}</span>

        <RouteLine origin={row.origin_code} destination={row.destination_code} size="sm" />
        <span className="truncate text-[11.5px] font-semibold uppercase tracking-wide text-muted">
          {formatShortDate(toDateString(row.desired_date))} ·{' '}
          {flexibilityLabel(row.date_flexibility_days)}
        </span>
        {row.status !== 'ACTIVE' ? <Badge tone="warn">{row.status.toLowerCase()}</Badge> : null}
      </div>

      <div className="flex shrink-0 items-center gap-x-4 pl-9 sm:pl-0">
        <span className="tnum text-[13px] text-muted">
          {formatCents(row.benchmark_cents)}
          <span aria-hidden="true" className="mx-1.5 text-line-strong">
            &rarr;
          </span>
          <strong className={`text-[16px] font-bold ${hasDrop ? 'text-save' : 'text-ink'}`}>
            {bestOption ? formatCents(bestOption.totalCents) : checkFailed ? 'Unknown' : '—'}
          </strong>
        </span>

        {hasDrop ? (
          <span className="tnum rounded-md border border-save-line bg-save-soft px-2 py-0.5 text-[12.5px] font-bold text-save">
            Save {formatCents(savings)}
          </span>
        ) : (
          <span className="tnum text-[12px] text-faint">
            {nextCheckAt ? `Next ${formatTimeInZone(nextCheckAt, row.timezone)}` : 'No drop yet'}
          </span>
        )}

        <span
          aria-hidden="true"
          className="ml-auto text-[13px] text-faint transition-transform group-hover:translate-x-0.5 sm:ml-0"
        >
          &rarr;
        </span>
      </div>
    </Link>
  );
}
