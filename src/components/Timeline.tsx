'use client';

import { useState } from 'react';

import { formatCents } from '@/lib/domain/money';
import { formatDateTimeInZone } from '@/lib/format';
import { alertReasonLabel } from '@/lib/labels';
import type { TimelineEntry } from '@/lib/queries';

const INITIAL_VISIBLE = 8;

/**
 * Everything that has happened to this trip, newest first.
 *
 * The dashboard answers "what is true now". This answers "what has RailDrop
 * actually been doing", which is the question people ask when they are deciding
 * whether to trust a monitor that is, by design, silent most of the time. A
 * failed check appears here as a failed check — never as an absence.
 */
export function Timeline({ entries, timezone }: { entries: TimelineEntry[]; timezone: string }) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) {
    return (
      <div data-testid="timeline" className="rd-card px-5 py-8 text-center">
        <p className="text-[14px] font-semibold text-ink">Nothing has happened yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
          The first check runs as soon as this trip is created, and everything after it is recorded
          here.
        </p>
      </div>
    );
  }

  const visible = expanded ? entries : entries.slice(0, INITIAL_VISIBLE);

  return (
    <div data-testid="timeline" className="rd-card overflow-hidden">
      <ol role="list" className="relative m-0 list-none px-5 py-4">
        {/* The rail. Inset to sit through the middle of the markers. */}
        <span
          aria-hidden="true"
          className="absolute bottom-6 left-[calc(1.25rem+7px)] top-7 w-px bg-line"
        />

        {visible.map((entry) => {
          const view = describe(entry);
          return (
            <li key={entry.id} className="relative flex gap-3.5 pb-4 last:pb-0">
              <span
                aria-hidden="true"
                className={`relative z-10 mt-1.5 size-[15px] shrink-0 rounded-full border-2 bg-surface ${view.marker}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-[13.5px] font-semibold leading-snug text-ink">{view.title}</p>
                  <time
                    dateTime={entry.at}
                    className="tnum shrink-0 text-[11.5px] leading-snug text-faint"
                  >
                    {formatDateTimeInZone(entry.at, timezone)}
                  </time>
                </div>
                {view.body ? (
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{view.body}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {entries.length > INITIAL_VISIBLE ? (
        <div className="border-t border-line px-5 py-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex min-h-9 items-center text-[13px] font-semibold text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
          >
            {expanded ? 'Show less' : `Show all ${entries.length} entries`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface EntryView {
  title: string;
  body: string | null;
  marker: string;
}

function centsOf(detail: Record<string, unknown>, key: string): number | null {
  const value = detail[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function describe(entry: TimelineEntry): EntryView {
  if (entry.kind === 'ALERT') {
    const reason = alertReasonLabel(entry.reason);
    return {
      title: `${reason.label} — ${formatCents(entry.bestTotalCents)}`,
      body: `We told you about this. ${formatCents(entry.savingsCents)} below what you paid.`,
      marker: 'border-save',
    };
  }

  if (entry.kind === 'CHECK') {
    const trigger = entry.trigger === 'MANUAL' ? 'Manual check' : 'Scheduled check';
    switch (entry.status) {
      case 'SUCCESS':
        return {
          title:
            entry.bestTotalCents !== null
              ? `${trigger} — best ${formatCents(entry.bestTotalCents)}`
              : `${trigger} — nothing cheaper`,
          body:
            entry.bestTotalCents !== null
              ? null
              : 'All dates checked. No option below what you paid.',
          marker: 'border-line-strong',
        };
      case 'PARTIAL_SUCCESS':
        return {
          title: `${trigger} — ${entry.datesSucceeded} of ${entry.datesTotal} dates`,
          body: 'The rest could not be checked, so this run is not evidence about them.',
          marker: 'border-warn',
        };
      case 'FAILED':
        return {
          title: `${trigger} failed`,
          body: entry.errorKind
            ? `${humaniseErrorKind(entry.errorKind)}. No price was observed, so nothing was concluded.`
            : 'No price was observed, so nothing was concluded.',
          marker: 'border-danger',
        };
      case 'SKIPPED_BUDGET':
        return {
          title: `${trigger} skipped`,
          body: 'The monthly provider budget was reached. No credits were spent.',
          marker: 'border-warn',
        };
      case 'SKIPPED_EXPIRED':
        return {
          title: `${trigger} skipped`,
          body: 'The monitoring window had already closed.',
          marker: 'border-line-strong',
        };
      default:
        return {
          title: `${trigger} — ${entry.status.toLowerCase()}`,
          body: null,
          marker: 'border-line-strong',
        };
    }
  }

  const detail = entry.detail;
  switch (entry.event) {
    case 'CREATED': {
      const paid = centsOf(detail, 'benchmarkCents');
      return {
        title: 'Trip added',
        body:
          paid !== null ? `Benchmark set to ${formatCents(paid)} — what you actually paid.` : null,
        marker: 'border-rust',
      };
    }
    case 'REBOOKED': {
      const from = centsOf(detail, 'fromCents');
      const to = centsOf(detail, 'toCents');
      return {
        title: 'Rebooked',
        body:
          from !== null && to !== null
            ? `Benchmark moved from ${formatCents(from)} to ${formatCents(to)}. Alert history reset against the new price.`
            : 'Monitoring continues against your new price.',
        marker: 'border-rust',
      };
    }
    case 'PAUSED':
      return {
        title: 'Monitoring paused',
        body: 'No checks run and no credits are used.',
        marker: 'border-line-strong',
      };
    case 'RESUMED':
      return { title: 'Monitoring resumed', body: null, marker: 'border-rust' };
    case 'EXTENDED': {
      const days = detail['days'];
      return {
        title: 'Monitoring extended',
        body:
          typeof days === 'number'
            ? `Window extended by ${days} day${days === 1 ? '' : 's'}.`
            : null,
        marker: 'border-rust',
      };
    }
    case 'TARGET_SET': {
      const target = centsOf(detail, 'targetCents');
      return {
        title: 'Target price set',
        body:
          target !== null
            ? `You will hear from us the moment it reaches ${formatCents(target)}.`
            : null,
        marker: 'border-rust',
      };
    }
    case 'TARGET_CLEARED':
      return { title: 'Target price removed', body: null, marker: 'border-line-strong' };
    case 'DELETED':
      return {
        title: 'Trip deleted',
        body: 'Price history kept for 30 days.',
        marker: 'border-danger',
      };
    case 'RESTORED':
      return { title: 'Trip restored', body: null, marker: 'border-save' };
    case 'COMPLETED':
      return { title: 'Monitoring window closed', body: null, marker: 'border-line-strong' };
    default:
      return {
        title: entry.event.toLowerCase().replace(/_/g, ' '),
        body: null,
        marker: 'border-line-strong',
      };
  }
}

function humaniseErrorKind(kind: string): string {
  switch (kind) {
    case 'AUTH':
      return 'The fare provider rejected our credentials';
    case 'RATE_LIMIT':
      return 'The fare provider rate-limited us';
    case 'TIMEOUT':
      return 'The fare provider did not respond in time';
    case 'SCHEMA':
      return 'The fare provider returned something we could not read';
    case 'UPSTREAM':
      return 'The fare provider returned an error';
    case 'NO_ROUTE':
      return 'The provider reports no service on this route';
    default:
      return 'The check could not complete';
  }
}
