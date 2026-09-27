'use client';

import { useMemo, useRef, useState } from 'react';

import { formatCents } from '@/lib/domain/money';
import { groupTrips } from '@/lib/domain/trip-grouping';
import { useListKeys } from './use-list-keys';
import type { WatchSummary } from '@/lib/queries';
import { RoundTripCard } from './RoundTripCard';
import { WatchCard, savingsOf } from './WatchCard';
import { ButtonLink, EmptyState } from './ui';

type Filter = 'all' | 'drops' | 'active' | 'paused';
type Sort = 'savings' | 'travel' | 'updated';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'drops', label: 'Price drops' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
];

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'savings', label: 'Biggest saving' },
  { id: 'travel', label: 'Travel date' },
  { id: 'updated', label: 'Recently checked' },
];

/**
 * The trip list, with the controls that only start mattering once you have more
 * than a handful. Filtering and sorting happen client-side over an already
 * loaded page — cheap, instant, and no extra round trip.
 */
export function DashboardList({ summaries }: { summaries: WatchSummary[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('savings');

  const listRef = useRef<HTMLDivElement>(null);
  useListKeys(listRef, '[data-list-item]');

  const counts = useMemo(
    () => ({
      all: summaries.length,
      drops: summaries.filter((s) => savingsOf(s) > 0).length,
      active: summaries.filter((s) => s.row.status === 'ACTIVE').length,
      paused: summaries.filter((s) => s.row.status !== 'ACTIVE').length,
    }),
    [summaries],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = summaries.filter((summary) => {
      if (filter === 'drops' && savingsOf(summary) <= 0) return false;
      if (filter === 'active' && summary.row.status !== 'ACTIVE') return false;
      if (filter === 'paused' && summary.row.status === 'ACTIVE') return false;
      if (q === '') return true;
      const haystack =
        `${summary.row.origin_code} ${summary.row.destination_code} ${summary.row.desired_date} ${summary.row.note ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });

    return [...filtered].sort((a, b) => {
      // Pinned trips stay on top regardless of the chosen sort.
      if (a.row.pinned !== b.row.pinned) return a.row.pinned ? -1 : 1;
      if (sort === 'savings') return savingsOf(b) - savingsOf(a);
      if (sort === 'travel')
        return String(a.row.desired_date).localeCompare(String(b.row.desired_date));
      return String(b.row.last_checked_at ?? '').localeCompare(String(a.row.last_checked_at ?? ''));
    });
  }, [summaries, query, filter, sort]);

  // Linked legs collapse into one journey *after* filtering and sorting, so the
  // pair lands wherever its first leg sorted to. A leg whose partner was
  // filtered out still renders on its own rather than vanishing.
  const groups = useMemo(
    () =>
      groupTrips(
        visible.map((summary) => ({
          id: summary.row.id,
          linkedWatchId: summary.row.linked_watch_id,
          summary,
        })),
      ),
    [visible],
  );

  if (summaries.length === 0) {
    return (
      <EmptyState
        title="Watch your first trip"
        body="Add a ticket you have already bought. RailDrop checks your date plus the day before and after, three times a day, and only tells you when it finds a materially cheaper option."
        action={<ButtonLink href="/watches/new">Watch a trip</ButtonLink>}
      />
    );
  }

  return (
    <div>
      {summaries.length > 2 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <svg
              viewBox="0 0 16 16"
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path strokeLinecap="round" d="M10.5 10.5L14 14" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by station or date"
              aria-label="Filter trips"
              className="rd-input !min-h-10 !pl-9 !text-[14px]"
            />
          </div>

          <div role="group" aria-label="Filter" className="flex flex-wrap items-center gap-1">
            {FILTERS.map((option) => {
              const count = counts[option.id];
              if (option.id !== 'all' && count === 0) return null;
              const active = filter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(option.id)}
                  className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors ${
                    active
                      ? 'border-ink bg-invert text-on-invert'
                      : 'border-line text-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {option.label}
                  <span className={`tnum text-[11px] ${active ? 'opacity-70' : 'text-faint'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="sr-only" htmlFor="sort">
            Sort trips
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rd-input !min-h-10 w-auto !text-[13px]"
          >
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="rd-card px-5 py-10 text-center">
          <p className="text-[15px] font-semibold text-ink">No trips match</p>
          <p className="mt-1 text-[13px] text-muted">
            {query ? `Nothing matches “${query}”.` : 'Try a different filter.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
            className="rd-btn rd-btn-secondary mt-4 !min-h-10 !text-[14px]"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div ref={listRef} className="space-y-3">
          {groups.map((group) =>
            group.kind === 'pair' ? (
              <RoundTripCard
                key={`pair-${group.outbound.id}`}
                outbound={group.outbound.summary}
                inbound={group.inbound.summary}
              />
            ) : (
              <WatchCard key={group.leg.id} summary={group.leg.summary} />
            ),
          )}
        </div>
      )}

      {visible.length > 0 && visible.length < summaries.length ? (
        <p className="tnum mt-4 text-center text-[12px] text-faint">
          Showing {visible.length} of {summaries.length} trips
        </p>
      ) : null}
    </div>
  );
}

/** The headline numbers, so the value of the product is visible at a glance. */
export function DashboardStats({ summaries }: { summaries: WatchSummary[] }) {
  const active = summaries.filter((s) => s.row.status === 'ACTIVE').length;
  const totalSavings = summaries.reduce((acc, s) => acc + savingsOf(s), 0);
  const withDrops = summaries.filter((s) => savingsOf(s) > 0).length;
  const best = summaries.reduce((acc, s) => Math.max(acc, savingsOf(s)), 0);

  if (summaries.length === 0) return null;

  return (
    <dl className="rd-card grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
      <Stat label="Watching" value={String(active)} sub={active === 1 ? 'trip' : 'trips'} />
      <Stat
        label="Cheaper now"
        value={String(withDrops)}
        sub={withDrops === 1 ? 'trip' : 'trips'}
        tone={withDrops > 0 ? 'save' : 'muted'}
      />
      <Stat
        label="Savings found"
        value={totalSavings > 0 ? formatCents(totalSavings) : '—'}
        tone={totalSavings > 0 ? 'save' : 'muted'}
      />
      <Stat
        label="Best drop"
        value={best > 0 ? formatCents(best) : '—'}
        tone={best > 0 ? 'save' : 'muted'}
      />
    </dl>
  );
}

function Stat({
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
  const colour = tone === 'save' ? 'text-save' : tone === 'muted' ? 'text-faint' : 'text-ink';
  return (
    <div className="border-b border-line px-5 py-4 last:border-b-0 sm:border-b-0">
      <dt className="rd-label">{label}</dt>
      <dd className={`tnum mt-1 text-[22px] font-bold leading-none tracking-tight ${colour}`}>
        {value}
        {sub ? <span className="ml-1.5 text-[12px] font-medium text-faint">{sub}</span> : null}
      </dd>
    </div>
  );
}
