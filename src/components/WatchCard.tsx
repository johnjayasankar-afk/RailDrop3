'use client';

import Link from 'next/link';

import { describeDisplacement, formatShortDate } from '@/lib/domain/dates';
import { formatCents } from '@/lib/domain/money';
import { lastChange } from '@/lib/domain/price-stats';
import {
  clockFromLocalIso,
  describeService,
  flexibilityLabel,
  formatTimeInZone,
  toDateString,
} from '@/lib/format';
import { cycleStatusLabel } from '@/lib/labels';
import type { WatchSummary } from '@/lib/queries';
import { PriceSparkline } from './PriceSparkline';
import { RouteLine } from './RouteLine';
import { Badge } from './ui';

const STATUS_TONE = {
  ACTIVE: 'neutral',
  PAUSED: 'warn',
  COMPLETED: 'neutral',
  NEEDS_ATTENTION: 'danger',
} as const;

export function savingsOf(summary: WatchSummary): number {
  if (!summary.bestOption?.isQualifying) return 0;
  return Math.max(0, summary.row.benchmark_cents - summary.bestOption.totalCents);
}

/**
 * One trip, at a glance.
 *
 * The layout is a deliberate two-column split: identity and money on the left,
 * evidence on the right. The previous single-column version left more than half
 * the card empty at desktop widths and pushed the price history — the thing
 * that makes a number trustworthy — off the card entirely for most trips.
 */
export function WatchCard({ summary }: { summary: WatchSummary }) {
  const { row, bestOption, latestCycle, nextCheckAt } = summary;
  const savings = savingsOf(summary);
  const hasDrop = savings > 0;
  const checkFailed = latestCycle?.status === 'FAILED';
  const savedPct =
    hasDrop && row.benchmark_cents > 0 ? Math.round((savings / row.benchmark_cents) * 100) : null;

  const target = row.target_price_cents;
  const targetReached = target !== null && bestOption !== null && bestOption.totalCents <= target;

  return (
    <article
      data-testid="watch-card"
      className="rd-card group relative overflow-hidden transition-all hover:border-line-strong hover:shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
    >
      {/* A drop earns a coloured edge, so scanning a long list surfaces the
          trips worth acting on without reading a single number. */}
      {hasDrop ? (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-save" />
      ) : null}

      <Link
        href={`/watches/${row.id}`}
        data-list-item
        className="block rounded-[inherit] px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-rust focus-visible:ring-offset-1"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <RouteLine origin={row.origin_code} destination={row.destination_code} />
            <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
              {formatShortDate(toDateString(row.desired_date))} ·{' '}
              {flexibilityLabel(row.date_flexibility_days)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {row.pinned ? <PinBadge /> : null}
            {row.linked_watch_id ? <Badge tone="neutral">Round trip</Badge> : null}
            {targetReached ? <Badge tone="save">Target reached</Badge> : null}
            {row.status !== 'ACTIVE' ? (
              <Badge tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? 'neutral'}>
                {row.status === 'NEEDS_ATTENTION' ? 'Needs attention' : titleCaseStatus(row.status)}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <Figure label="Paid" value={formatCents(row.benchmark_cents)} />
              <Figure
                label="Best now"
                value={
                  bestOption ? formatCents(bestOption.totalCents) : checkFailed ? 'Unknown' : '—'
                }
                tone={hasDrop ? 'save' : 'ink'}
              />
              {hasDrop ? (
                <div className="rounded-lg border border-save-line bg-save-soft px-2.5 py-1.5">
                  <span className="tnum text-[15px] font-bold text-save">
                    Save {formatCents(savings)}
                  </span>
                  {savedPct !== null && savedPct > 0 ? (
                    <span className="ml-1.5 tnum text-[11.5px] font-semibold text-save/80">
                      {savedPct}%
                    </span>
                  ) : null}
                </div>
              ) : null}
              {target !== null && !targetReached && bestOption ? (
                <Figure
                  label="Target"
                  value={formatCents(target)}
                  sub={`${formatCents(bestOption.totalCents - target)} away`}
                  tone="muted"
                />
              ) : null}
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              {bestOption ? (
                <>
                  <span className="font-semibold text-ink-2">
                    {formatShortDate(bestOption.travelDate)}
                  </span>{' '}
                  · {describeService(bestOption.serviceName, bestOption.trainNumber)} ·{' '}
                  <span className="ticket">{clockFromLocalIso(bestOption.departureLocal)}</span>
                  {bestOption.displacementDays !== 0 ? (
                    <> · {describeDisplacement(bestOption.displacementDays)}</>
                  ) : null}
                </>
              ) : checkFailed ? (
                'The last check could not reach the fare provider.'
              ) : latestCycle ? (
                'No cheaper option in your window right now.'
              ) : (
                'Waiting for the first check.'
              )}
            </p>

            {row.note ? (
              <p className="mt-2.5 border-l-2 border-line-strong pl-3 text-[12.5px] italic leading-relaxed text-muted">
                {row.note}
              </p>
            ) : null}
          </div>

          <Evidence summary={summary} />
        </div>
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-5 py-2.5">
        <span className="tnum text-[12px] text-faint">
          {row.last_checked_at
            ? `Updated ${formatTimeInZone(row.last_checked_at, row.timezone)}`
            : 'Not checked yet'}
          {nextCheckAt ? ` · Next check ${formatTimeInZone(nextCheckAt, row.timezone)}` : null}
          {latestCycle && latestCycle.status !== 'SUCCESS' ? (
            <> · {cycleStatusLabel(latestCycle.status).label}</>
          ) : null}
        </span>

        <Link
          href={`/watches/${row.id}`}
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
        >
          {summary.qualifyingCount > 0
            ? `View ${summary.qualifyingCount} cheaper option${summary.qualifyingCount === 1 ? '' : 's'}`
            : 'View details'}
          <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
            &rarr;
          </span>
        </Link>
      </div>
    </article>
  );
}

/**
 * The right-hand column: what the price has actually done.
 *
 * It always renders something. Showing nothing until a chart is possible left
 * the card looking unfinished for the first day of every trip's life, and said
 * nothing about why.
 */
function Evidence({ summary }: { summary: WatchSummary }) {
  const { row, priceHistory } = summary;
  const priced = priceHistory.filter((point) => point.cents !== null);
  const change = lastChange(priceHistory.map((point) => point.cents));

  return (
    <div className="hidden w-[172px] shrink-0 flex-col items-end gap-1.5 sm:flex">
      {priced.length >= 2 ? (
        <PriceSparkline
          points={priceHistory}
          benchmarkCents={row.benchmark_cents}
          width={168}
          height={40}
        />
      ) : (
        // Absence drawn in the chart's own language: the benchmark line with
        // nothing plotted on it yet. A dashed box here read as a broken image.
        <svg
          viewBox="0 0 168 40"
          className="h-10 w-[168px]"
          role="img"
          aria-label={`Not enough history to chart yet: ${priced.length} priced check${priced.length === 1 ? '' : 's'}.`}
        >
          <line
            x1="0"
            x2="168"
            y1="20"
            y2="20"
            stroke="var(--rd-line-strong)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          {priced.length === 1 ? <circle cx="8" cy="20" r="2.5" fill="var(--rd-rust)" /> : null}
        </svg>
      )}

      <span className="tnum text-[11.5px] leading-none">
        {change === null ? (
          <span className="text-faint">
            {priced.length} check{priced.length === 1 ? '' : 's'}
          </span>
        ) : change.dropCents > 0 ? (
          <span className="font-semibold text-save">
            &darr; {formatCents(change.dropCents)} since last check
          </span>
        ) : change.dropCents < 0 ? (
          <span className="text-muted">
            &uarr; {formatCents(-change.dropCents)} since last check
          </span>
        ) : (
          <span className="text-faint">No change since last check</span>
        )}
      </span>
    </div>
  );
}

function PinBadge() {
  return (
    <span
      title="Pinned"
      aria-label="Pinned"
      className="inline-flex size-5 items-center justify-center rounded-md bg-rust-soft text-rust"
    >
      <svg viewBox="0 0 12 12" className="size-2.5" fill="currentColor" aria-hidden="true">
        <path d="M6 0.8l1.5 3.4 3.7.4-2.8 2.5.8 3.6L6 8.9 2.8 10.7l.8-3.6L0.8 4.6l3.7-.4z" />
      </svg>
    </span>
  );
}

function Figure({
  label,
  value,
  sub,
  tone = 'ink',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ink' | 'save' | 'muted';
}) {
  const colour = tone === 'save' ? 'text-save' : tone === 'muted' ? 'text-muted' : 'text-ink';
  return (
    <div>
      <div className="rd-label">{label}</div>
      <div
        className={`tnum mt-1 text-[25px] font-bold leading-none tracking-tight ${colour} ${
          tone === 'muted' ? 'text-[19px]' : ''
        }`}
      >
        {value}
      </div>
      {sub ? <div className="tnum mt-1 text-[11.5px] text-faint">{sub}</div> : null}
    </div>
  );
}

function titleCaseStatus(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}
