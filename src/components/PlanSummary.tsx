'use client';

import { formatShortDate } from '@/lib/domain/dates';
import { formatCents } from '@/lib/domain/money';
import { describeDuration, planPreview, type PlanInput } from '@/lib/domain/plan-preview';

/**
 * What creating this trip actually commits to.
 *
 * The form already stated every one of these facts, but scattered across five
 * hint lines attached to five different fields — dates here, cadence there,
 * cost implied by a radio label. Read that way none of them answered the
 * question a person is actually holding: *what am I signing up for*.
 *
 * It updates as the form is filled in, and every number is derived from the
 * same pure planner the scheduler uses, so it cannot drift from what will
 * really happen.
 */
export function PlanSummary({
  input,
  originCode,
  destinationCode,
  timezone,
}: {
  input: PlanInput;
  originCode: string;
  destinationCode: string;
  timezone: string;
}) {
  const plan = planPreview(input);

  if (!plan || plan.dates.length === 0) {
    return (
      <aside data-testid="plan-summary" aria-label="What will happen" className="rd-card px-5 py-5">
        <h2 className="rd-label">What will happen</h2>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          {plan && plan.dates.length === 0
            ? 'Every date in that window has already passed, so there would be nothing left to check. Pick a date in the future.'
            : 'Pick a travel date and this fills in with exactly what RailDrop will do.'}
        </p>
      </aside>
    );
  }

  const route = originCode && destinationCode ? `${originCode} → ${destinationCode}` : 'Your route';
  const threshold = input.minimumSavingsCents;

  return (
    <aside
      data-testid="plan-summary"
      aria-label="What will happen"
      className="rd-card overflow-hidden"
    >
      <h2 className="rd-label border-b border-line px-5 py-3">What will happen</h2>

      <dl className="divide-y divide-line text-[13px]">
        <Row label="Route">
          <span className="font-semibold text-ink">{route}</span>
          {plan.legs === 2 ? <span className="ml-2 text-faint">both directions</span> : null}
        </Row>

        <Row label={plan.dates.length === 1 ? 'Date' : `${plan.dates.length} dates`}>
          <span className="text-ink-2">
            {plan.dates.map((date) => formatShortDate(date)).join(' · ')}
          </span>
          {plan.droppedPastDates.length > 0 ? (
            <span className="mt-1 block text-[12px] text-faint">
              {plan.droppedPastDates.map((date) => formatShortDate(date)).join(', ')} already passed
              and will not be searched.
            </span>
          ) : null}
        </Row>

        <Row label="Checked">
          <span className="text-ink-2">{plan.checkTimes.join(', ')}</span>
          <span className="mt-1 block text-[12px] text-faint">
            {timezone.replace(/_/g, ' ')} · every day for {describeDuration(input.monitoringHours)}
            {plan.cappedByDeparture ? ', or until you travel — whichever comes first' : ''}
          </span>
        </Row>

        <Row label="Searches">
          <span className="tnum text-ink-2">
            {plan.searchesPerDay} a day
            {plan.searchesTotal > 0 ? (
              <span className="text-faint"> · about {plan.searchesTotal} in total</span>
            ) : null}
          </span>
          <span className="mt-1 block text-[12px] text-faint">
            {plan.dates.length} date{plan.dates.length === 1 ? '' : 's'} × {plan.checksPerDay}{' '}
            checks
            {plan.legs === 2 ? ' × 2 legs' : ''}
          </span>
        </Row>

        <Row label="You hear from us">
          {input.benchmarkCents === null ? (
            <span className="text-faint">once you enter what you paid</span>
          ) : (
            <span className="text-ink-2">
              when something is at least{' '}
              <strong className="tnum font-semibold text-ink">{formatCents(threshold)}</strong>{' '}
              below the{' '}
              <strong className="tnum font-semibold text-ink">
                {formatCents(input.benchmarkCents)}
              </strong>{' '}
              you paid
            </span>
          )}
        </Row>
      </dl>

      <p className="border-t border-line px-5 py-3 text-[12px] leading-relaxed text-faint">
        Nothing here changes your Amtrak booking. You can pause, retarget or delete this trip at any
        time.
      </p>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  // Stacked, not side by side: a 110px label column inside a 320px rail wrapped
  // the longer labels onto two lines and left the values crushed into 180px.
  return (
    <div className="px-5 py-3">
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-faint">{label}</dt>
      <dd className="mt-1 leading-relaxed">{children}</dd>
    </div>
  );
}
