'use client';

import { useState } from 'react';

import { probeDatesAction } from '@/app/actions';
import { formatShortDate } from '@/lib/domain/dates';
import { PROBE_STALE_HOURS, planProbe, probeAge } from '@/lib/domain/date-probe';
import { formatCents } from '@/lib/domain/money';
import type { DateProbe, DateStripEntry } from '@/lib/queries';
import { useToast } from './Toast';

interface Cell {
  date: string;
  /** Monitored dates come free with the trip; probed ones were paid for once. */
  source: 'monitored' | 'probed' | 'unknown';
  cheapestTotalCents: number | null;
  failed: boolean;
  /** True for a probed price old enough to have fallen behind the watched ones. */
  stale: boolean;
}

/**
 * A week either side of the travel date, priced.
 *
 * The monitoring window is capped at ±2 days because it runs three times a day
 * for the life of a trip. This answers the other question — *what if I shifted
 * a few days?* — as a single, explicitly costed scan, and it never re-buys a
 * date the trip is already watching.
 *
 * Every cell says where its number came from. A price from ongoing monitoring
 * is minutes old; a probed one is from whenever the scan ran, and a date that
 * could not be reached is blank rather than "nothing available".
 */
export function DateCalendar({
  watchId,
  desiredDate,
  flexibilityDays,
  today,
  benchmarkCents,
  strip,
  probes,
}: {
  watchId: string;
  desiredDate: string;
  flexibilityDays: number;
  today: string;
  benchmarkCents: number;
  strip: DateStripEntry[];
  probes: DateProbe[];
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const plan = planProbe(desiredDate, flexibilityDays, today);
  if (!plan || plan.span.length === 0) return null;

  const monitored = new Map(strip.map((entry) => [entry.travelDate, entry]));
  const probed = new Map(probes.map((probe) => [probe.travelDate, probe]));

  const cells: Cell[] = plan.span.map((date) => {
    const fromStrip = monitored.get(date);
    if (fromStrip) {
      return {
        date,
        source: 'monitored',
        cheapestTotalCents: fromStrip.cheapestTotalCents,
        failed: fromStrip.status === 'FAILED',
        stale: false,
      };
    }
    const fromProbe = probed.get(date);
    if (fromProbe) {
      return {
        date,
        source: 'probed',
        cheapestTotalCents: fromProbe.cheapestTotalCents,
        failed: fromProbe.status === 'FAILED',
        stale: probeAge(fromProbe.probedAt)?.stale ?? false,
      };
    }
    return { date, source: 'unknown', cheapestTotalCents: null, failed: false, stale: false };
  });

  // The oldest probe decides how the scan reads: a window is only as current
  // as its least recent cell.
  const oldest = probes.length > 0
    ? probes.reduce((worst, p) => (p.probedAt < worst.probedAt ? p : worst))
    : null;
  const age = oldest ? probeAge(oldest.probedAt) : null;

  const priced = cells.filter((c) => c.cheapestTotalCents !== null);
  const cheapest = priced.length > 0 ? Math.min(...priced.map((c) => c.cheapestTotalCents!)) : null;
  const unknownCount = cells.filter((c) => c.source === 'unknown').length;

  // What the window actually found, said in a sentence. A grid of fifteen
  // numbers makes the reader do the comparison the scan was run to answer.
  const cheapestCell =
    cheapest === null ? null : priced.find((c) => c.cheapestTotalCents === cheapest)!;
  const monitoredPriced = cells.filter(
    (c) => c.source === 'monitored' && c.cheapestTotalCents !== null,
  );
  const bestMonitored =
    monitoredPriced.length > 0
      ? Math.min(...monitoredPriced.map((c) => c.cheapestTotalCents!))
      : null;
  const beatsMonitored =
    cheapest !== null && bestMonitored !== null && cheapestCell?.source === 'probed'
      ? bestMonitored - cheapest
      : 0;

  async function probe() {
    setBusy(true);
    try {
      const result = await probeDatesAction(watchId);
      toast({
        title: result.ok ? 'Wider window checked' : 'Could not check',
        description: result.message ?? result.error,
        tone: result.ok ? 'save' : 'warn',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="date-calendar" className="rd-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-ink">A week either side</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            {unknownCount > 0
              ? `${unknownCount} date${unknownCount === 1 ? '' : 's'} have not been checked. Your monitoring window stays at the dates you chose.`
              : age
                ? `Priced ${age.label}${age.stale ? ' — the watched dates have moved on since.' : '.'}`
                : 'Every date in the window has been priced.'}
          </p>
        </div>

        {/* Always offered. Hiding it once every date had a price left no way to
            refresh a scan, and a probed price does not update itself — the one
            thing a fare monitor must never imply. */}
        <button
          type="button"
          onClick={probe}
          disabled={busy}
          className={`shrink-0 !min-h-11 !px-3.5 !text-[13px] rd-btn ${
            unknownCount > 0 || age?.stale ? 'rd-btn-primary' : 'rd-btn-secondary'
          }`}
        >
          {busy
            ? 'Checking…'
            : unknownCount > 0
              ? `Check ${plan.toProbe.length} more date${plan.toProbe.length === 1 ? '' : 's'}`
              : `Re-check ${plan.toProbe.length} date${plan.toProbe.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {beatsMonitored > 0 && cheapestCell ? (
        <p
          data-testid="calendar-finding"
          className="flex flex-wrap items-baseline gap-x-2 border-b border-save-line bg-save-soft px-5 py-2.5 text-[12.5px] leading-relaxed text-save"
        >
          <span className="font-semibold">
            {formatShortDate(cheapestCell.date)} is the cheapest date in this window
          </span>
          <span className="tnum text-save/90">
            at {formatCents(cheapest as number)} — {formatCents(beatsMonitored)} below the best on
            the dates you are watching. Shifting is your call; RailDrop keeps watching the dates you
            chose.
          </span>
        </p>
      ) : null}

      {/* Cell borders rather than a gap over a coloured background: with
          auto-fit the background showed through the empty tail of the last
          row as a filled grey block. */}
      <ol
        role="list"
        className="-mb-px -mr-px grid grid-cols-[repeat(auto-fit,minmax(58px,1fr))] bg-surface"
      >
        {cells.map((cell) => {
          const isDesired = cell.date === desiredDate;
          const isCheapest =
            cheapest !== null && cell.cheapestTotalCents === cheapest && priced.length > 1;

          return (
            <li
              key={cell.date}
              data-testid="calendar-cell"
              data-source={cell.source}
              aria-label={`${formatShortDate(cell.date)}: ${
                cell.cheapestTotalCents !== null
                  ? `from ${formatCents(cell.cheapestTotalCents)}`
                  : cell.failed
                    ? 'could not be checked'
                    : cell.source === 'unknown'
                      ? 'not checked'
                      : 'nothing available'
              }`}
              data-stale={cell.stale ? 'true' : undefined}
              className={`flex flex-col gap-1 border-b border-r border-line px-2 py-2.5 text-center ${
                isCheapest ? 'bg-save-soft' : 'bg-surface'
              } ${isDesired ? 'ring-1 ring-inset ring-ink' : ''} ${cell.stale ? 'opacity-60' : ''}`}
            >
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">
                {formatShortDate(cell.date)}
              </span>

              <span
                className={`tnum text-[13px] font-bold leading-none ${
                  cell.cheapestTotalCents === null
                    ? 'text-faint'
                    : isCheapest
                      ? 'text-save'
                      : cell.cheapestTotalCents < benchmarkCents
                        ? 'text-ink'
                        : 'text-muted'
                }`}
              >
                {cell.cheapestTotalCents !== null
                  ? formatCents(cell.cheapestTotalCents, { showCents: false })
                  : cell.failed
                    ? '—'
                    : cell.source === 'unknown'
                      ? '·'
                      : '—'}
              </span>

              <span className="text-[9.5px] uppercase tracking-wide text-faint">
                {cell.source === 'monitored'
                  ? 'watched'
                  : cell.source === 'probed'
                    ? 'checked'
                    : ''}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="border-t border-line px-5 py-2.5 text-[11.5px] leading-relaxed text-faint">
        <strong className="font-semibold text-ink-2">Watched</strong> dates are re-priced three
        times a day. <strong className="font-semibold text-ink-2">Checked</strong> dates were priced
        once, when you asked. A dash means the provider had nothing, or could not be reached — never
        that a date is cheap. A checked price stops being current after {PROBE_STALE_HOURS} hours;
        it is dimmed and marked <strong className="font-semibold text-ink-2">old</strong> until you
        re-check.
      </p>
    </div>
  );
}
