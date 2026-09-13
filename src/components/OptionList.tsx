'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';

import { describeDisplacement, formatDurationMinutes, formatMediumDate } from '@/lib/domain/dates';
import { formatCents } from '@/lib/domain/money';
import { clockFromLocalIso, describeService, describeTransfers, titleCase } from '@/lib/format';
import { MEANINGFUL_MINUTES, fasterAlternative, tradeoffs } from '@/lib/domain/tradeoffs';
import {
  NO_FILTERS,
  filterCounts,
  filterOptions,
  isFiltered,
  type OptionFilters,
} from '@/lib/domain/option-filters';
import type { OptionView } from '@/lib/queries';
import { OptionFilterBar } from './OptionFilterBar';
import { useListKeys } from './use-list-keys';
import { Badge } from './ui';

const INITIAL_VISIBLE = 5;

export function OptionList({
  options,
  watchId,
  benchmarkCents,
  cycleFailed = false,
}: {
  options: OptionView[];
  watchId: string;
  benchmarkCents: number;
  /** True when the last check could not reach the provider at all. */
  cycleFailed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filters, setFilters] = useState<OptionFilters>(NO_FILTERS);

  const listRef = useRef<HTMLUListElement>(null);
  useListKeys(listRef, '[data-list-item]');

  const matching = useMemo(() => filterOptions(options, filters), [options, filters]);
  const counts = useMemo(() => filterCounts(options, filters), [options, filters]);
  const dates = useMemo(
    () => [...new Set(options.map((option) => option.travelDate))].sort(),
    [options],
  );
  const hasBus = useMemo(
    () => options.some((option) => option.serviceType === 'THRUWAY_BUS'),
    [options],
  );
  const hasRestricted = useMemo(() => options.some((option) => option.restricted), [options]);

  const visible = expanded ? matching : matching.slice(0, INITIAL_VISIBLE);
  const hidden = matching.length - visible.length;

  // Computed over everything that matches the filters, not just the rows on
  // screen: "the fastest" has to mean the fastest of what was found, or the
  // label changes meaning when you press "show more".
  // Keyed by the option itself rather than by position: the rendered list is a
  // slice of `matching`, so index alignment holds only by accident of slicing
  // from zero and would break silently the moment that changed.
  const times = useMemo(() => {
    const result = tradeoffs(matching);
    const fastest = result.fastestIndex >= 0 ? matching[result.fastestIndex] : null;
    return new Map(
      matching.map((option, index) => [
        option.fareOptionId,
        {
          isFastest: option === fastest,
          slowerByMinutes: result.slowerByMinutes[index] ?? 0,
        },
      ]),
    );
  }, [matching]);

  const alternative = useMemo(() => fasterAlternative(matching), [matching]);

  if (options.length === 0) {
    // An empty list after a FAILED check means we know nothing — saying
    // "nothing cheaper" there would be a false negative.
    return (
      <div className="rd-card px-5 py-9 text-center">
        <p className="text-[15px] font-semibold text-ink">
          {cycleFailed ? 'We could not check this trip' : 'Nothing cheaper right now'}
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">
          {cycleFailed
            ? 'The fare provider could not be reached, so we have nothing to show. This is not a result — we will try again on the next check.'
            : 'Every eligible option we found costs at least what you paid. We keep checking three times a day.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Only worth the space once there is enough to narrow. */}
      {options.length > 4 ? (
        <OptionFilterBar
          filters={filters}
          onChange={(next) => {
            setFilters(next);
            setExpanded(false);
          }}
          counts={counts}
          total={options.length}
          shown={matching.length}
          dates={dates}
          hasBus={hasBus}
          hasRestricted={hasRestricted}
        />
      ) : null}

      {matching.length === 0 ? (
        <div className="rd-card px-5 py-9 text-center">
          <p className="text-[15px] font-semibold text-ink">No option matches those filters</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">
            {options.length} option{options.length === 1 ? '' : 's'} were found for this trip. Widen
            the filters to see them.
          </p>
          <button
            type="button"
            onClick={() => setFilters(NO_FILTERS)}
            className="rd-btn rd-btn-secondary mt-4 !min-h-11 !text-[14px]"
          >
            Clear filters
          </button>
        </div>
      ) : null}

      {/* Ranking by price is right, but on a real corridor the cheapest fare is
          routinely the slowest, and the list makes the reader do the arithmetic
          across a dozen rows to notice. */}
      {alternative && matching.length > 0 ? (
        <p
          data-testid="faster-alternative"
          className="mb-3 flex flex-wrap items-baseline gap-x-2 rounded-lg border border-line bg-raised px-4 py-2.5 text-[12.5px] leading-relaxed text-muted"
        >
          <span className="font-semibold text-ink">Worth knowing</span>
          <span>
            The cheapest option is the slowest.{' '}
            <strong className="tnum font-semibold text-ink">
              {formatCents(alternative.extraCents)} more
            </strong>{' '}
            gets you there{' '}
            <strong className="tnum font-semibold text-ink">
              {formatDurationMinutes(alternative.minutesSaved)}
            </strong>{' '}
            sooner.
          </span>
        </p>
      ) : null}

      <ul ref={listRef} className="space-y-2" role="list">
        {visible.map((option, index) => (
          <OptionRow
            key={option.fareOptionId}
            option={option}
            index={index}
            watchId={watchId}
            benchmarkCents={benchmarkCents}
            filtered={isFiltered(filters)}
            isFastest={times.get(option.fareOptionId)?.isFastest ?? false}
            slowerByMinutes={times.get(option.fareOptionId)?.slowerByMinutes ?? 0}
          />
        ))}
      </ul>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rd-btn rd-btn-secondary mt-2.5 w-full"
        >
          Show {hidden} more option{hidden > 1 ? 's' : ''}
        </button>
      ) : null}
    </div>
  );
}

function OptionRow({
  option,
  index,
  watchId,
  benchmarkCents,
  filtered,
  isFastest,
  slowerByMinutes,
}: {
  option: OptionView;
  index: number;
  watchId: string;
  benchmarkCents: number;
  /** True when a filter is narrowing the list, so "cheapest" needs qualifying. */
  filtered: boolean;
  /** The quickest journey among everything that matched the filters. */
  isFastest: boolean;
  /** How far behind the quickest this one is. */
  slowerByMinutes: number;
}) {
  const savings = benchmarkCents - option.totalCents;
  const isBus = option.serviceType === 'THRUWAY_BUS';
  const isBest = index === 0;
  const savedPct =
    savings > 0 && benchmarkCents > 0 ? Math.round((savings / benchmarkCents) * 100) : null;

  return (
    <li
      data-testid="option-row"
      className={`rd-card overflow-hidden transition-colors ${
        isBest ? 'border-save-line' : 'hover:border-line-strong'
      }`}
    >
      {isBest ? (
        <div className="flex items-center gap-2 border-b border-save-line bg-save-soft px-4 py-1.5 sm:px-5">
          <BestIcon />
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-save">
            {filtered ? 'Cheapest match' : 'Cheapest option'}
          </span>
        </div>
      ) : null}

      <div className="px-4 py-4 sm:px-5">
        {/* Stacked below sm. Keeping the price column beside the details at
            390px squeezed the meta line to ~190px, so it wrapped mid-value —
            "7:30 / PM", "+2h / 7m" — which is worse than no delta at all. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-x-4">
          <div className="min-w-0 sm:flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-[14.5px] font-bold text-ink">
                {formatMediumDate(option.travelDate)}
              </span>
              {option.displacementDays !== 0 ? (
                <Badge tone="rust">{describeDisplacement(option.displacementDays)}</Badge>
              ) : (
                <Badge tone="neutral">Your date</Badge>
              )}
              {isBus ? <Badge tone="bus">Bus &mdash; not rail</Badge> : null}
              {option.restricted ? (
                <Badge tone="warn" title="Restricted fares limit changes and refunds">
                  Restricted
                </Badge>
              ) : null}
              {option.availability === 'LIMITED' ? (
                <Badge tone="warn">
                  {option.seatsRemaining !== null
                    ? `${option.seatsRemaining} seats left`
                    : 'Limited'}
                </Badge>
              ) : null}
              {option.pricingConfidence === 'AMBIGUOUS' ? (
                <Badge
                  tone="danger"
                  title="Party pricing basis unverified — no alert is sent for this"
                >
                  Price unverified
                </Badge>
              ) : null}
            </div>

            <p className="mt-1.5 text-[14px] font-medium text-ink-2">
              {describeService(option.serviceName, option.trainNumber)}
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              <span className="ticket">{clockFromLocalIso(option.departureLocal)}</span>
              <span aria-hidden="true" className="mx-1.5 text-line-strong">
                &rarr;
              </span>
              <span className="ticket">{clockFromLocalIso(option.arrivalLocal)}</span>
              <span className="mx-1.5 text-line-strong">·</span>
              {formatDurationMinutes(option.durationMinutes)}
              {isFastest ? (
                <>
                  {' '}
                  <span className="font-semibold text-save">fastest</span>
                </>
              ) : slowerByMinutes >= MEANINGFUL_MINUTES ? (
                <>
                  {' '}
                  <span className="tnum text-faint">+{formatDurationMinutes(slowerByMinutes)}</span>
                </>
              ) : null}
              <span className="mx-1.5 text-line-strong">·</span>
              {describeTransfers(option.transfers)}
            </p>
            <p className="mt-0.5 text-[12px] text-faint">
              {titleCase(option.fareFamily)} · {titleCase(option.travelClass)}
            </p>
          </div>

          {/* Price and actions share one column so the row stays three lines
              tall. The actions previously sat on their own full-width rule,
              which added ~60px of empty space to every option in the list. */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line pt-3 sm:flex-col sm:items-end sm:gap-2 sm:border-0 sm:pt-0">
            {/* Grouped, so the mobile row is [price and saving] | [actions]
                rather than three items spread across the width. */}
            <span className="flex items-baseline gap-2 sm:flex-col sm:items-end sm:gap-1">
              <span
                data-testid="option-price"
                className="tnum text-[24px] font-bold leading-none tracking-tight text-ink"
              >
                {formatCents(option.totalCents)}
              </span>
              {savings > 0 ? (
                <span className="tnum text-[13px] font-semibold leading-none text-save">
                  Save {formatCents(savings)}
                  {savedPct !== null && savedPct > 0 ? (
                    <span className="ml-1 font-medium text-save/75">({savedPct}%)</span>
                  ) : null}
                </span>
              ) : (
                <span className="tnum text-[13px] leading-none text-faint">
                  +{formatCents(Math.abs(savings))} vs paid
                </span>
              )}
            </span>

            <div className="flex w-full items-center justify-end gap-1.5 sm:mt-1 sm:w-auto">
              <CopyTripButton option={option} />
              <Link
                href={`/watches/${watchId}/book/${option.fareOptionId}`}
                data-list-item
                className={`rd-btn !min-h-11 !px-3.5 !text-[13.5px] ${
                  isBest ? 'rd-btn-primary' : 'rd-btn-secondary'
                }`}
              >
                Book on Amtrak
              </Link>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function BestIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="size-3 shrink-0 text-save"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 7l2.5 2.5L10 3.5" />
    </svg>
  );
}

function CopyTripButton({ option }: { option: OptionView }) {
  const [copied, setCopied] = useState(false);

  const text = [
    'RailDrop - trip details',
    `Date:       ${formatMediumDate(option.travelDate)}`,
    `Service:    ${describeService(option.serviceName, option.trainNumber)}`,
    `Time:       ${clockFromLocalIso(option.departureLocal)} - ${clockFromLocalIso(option.arrivalLocal)}`,
    `Class:      ${titleCase(option.fareFamily)} / ${titleCase(option.travelClass)}`,
    `Observed:   ${formatCents(option.totalCents)}`,
    '',
    'Fares and availability change. RailDrop does not modify your Amtrak reservation.',
  ].join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy the trip details to your clipboard"
      className="rd-btn rd-btn-ghost !min-h-11 !px-2.5 !text-[13.5px]"
    >
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}
