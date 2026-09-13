import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AlertSensitivity } from '@/components/AlertSensitivity';
import { Disclosure } from '@/components/Disclosure';
import { AppShell } from '@/components/AppShell';
import { ExtendWindow } from '@/components/ExtendWindow';
import { FareStrip } from '@/components/FareStrip';
import { OptionList } from '@/components/OptionList';
import { PriceHistoryChart } from '@/components/PriceHistoryChart';
import { PricePosition } from '@/components/PricePosition';
import { RebookForm } from '@/components/RebookForm';
import { RouteLine } from '@/components/RouteLine';
import { TargetPrice } from '@/components/TargetPrice';
import { Timeline } from '@/components/Timeline';
import { TripNote } from '@/components/TripNote';
import { WatchActions } from '@/components/WatchActions';
import { Badge, Notice, Section, Stat } from '@/components/ui';
import { formatMediumDate } from '@/lib/domain/dates';
import { formatCents } from '@/lib/domain/money';
import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { isSupabaseConfigured } from '@/lib/env';
import {
  flexibilityLabel,
  formatDateTimeInZone,
  formatTimeInZone,
  toDateString,
  toIsoString,
} from '@/lib/format';
import { cycleStatusLabel } from '@/lib/labels';
import { loadWatchDetail, type LinkedLeg } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Trip ${id.slice(0, 8)}` };
}

export default async function WatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) redirect('/dashboard');

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const db = await getServerSupabase();
  const detail = await loadWatchDetail(db, id);
  if (!detail) notFound();
  if (process.env.RD_DEBUG_RENDER === '1') {
    console.warn(
      `RENDER watch=${id.slice(0, 8)} benchmark=${detail.row.benchmark_cents} version=${detail.row.benchmark_version}`,
    );
  }

  const { row, latestCycle, options, strip, nextCheckAt, priceHistory } = detail;
  const qualifying = options.filter((o) => o.isQualifying);
  const best = qualifying[0] ?? null;
  const savings = best ? row.benchmark_cents - best.totalCents : null;
  const cycle = cycleStatusLabel(latestCycle?.status);

  const uncheckedDates = strip.filter((s) => s.status === 'FAILED');
  // A failed check tells us nothing; it must never be rendered as "no drop".
  const checkFailed = latestCycle?.status === 'FAILED';
  const savedPct =
    savings !== null && savings > 0 && row.benchmark_cents > 0
      ? Math.round((savings / row.benchmark_cents) * 100)
      : null;

  return (
    <AppShell email={user.email} active="dashboard">
      <Link
        href="/dashboard"
        className="inline-flex min-h-8 items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-ink"
      >
        <span aria-hidden="true">&larr;</span> All trips
      </Link>

      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {/* The route IS the page title. It was rendered as a plain div, which
              left the app's most content-rich page with no <h1> at all — a
              screen-reader user landing here had no heading to orient by. */}
          <h1 className="m-0">
            <RouteLine origin={row.origin_code} destination={row.destination_code} size="lg" />
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">
              {formatMediumDate(toDateString(row.desired_date))} ·{' '}
              {flexibilityLabel(row.date_flexibility_days)}
            </Badge>
            {row.passengers > 1 ? <Badge tone="neutral">{row.passengers} passengers</Badge> : null}
            {row.status !== 'ACTIVE' ? (
              <Badge tone={row.status === 'NEEDS_ATTENTION' ? 'danger' : 'warn'}>
                {row.status === 'NEEDS_ATTENTION' ? 'Needs attention' : 'Paused'}
              </Badge>
            ) : null}
          </div>
        </div>

        <p className="mt-3 text-[12.5px] text-muted">
          <span className="tnum">
            Last checked {formatDateTimeInZone(row.last_checked_at, row.timezone)}
          </span>
          {nextCheckAt ? (
            <>
              <span aria-hidden="true" className="mx-2 text-line-strong">
                ·
              </span>
              <span className="tnum">Next check {formatTimeInZone(nextCheckAt, row.timezone)}</span>
            </>
          ) : null}
          <span aria-hidden="true" className="mx-2 text-line-strong">
            ·
          </span>
          <span className="tnum">
            Monitoring until {formatDateTimeInZone(row.monitoring_ends_at, row.timezone)}
          </span>
        </p>
      </header>

      <div className="rd-card mt-5 flex flex-wrap items-center justify-between gap-6 px-5 py-5">
        <div className="grid flex-1 grid-cols-2 gap-5 sm:grid-cols-3">
          <Stat
            label="Current ticket"
            value={formatCents(row.benchmark_cents)}
            testId="stat-paid"
          />
          <Stat
            label="Best now"
            value={
              best
                ? formatCents(best.totalCents)
                : checkFailed || !latestCycle
                  ? 'Unknown'
                  : 'No drop'
            }
            tone={savings && savings > 0 ? 'save' : 'ink'}
            size="lg"
            testId="stat-best"
          />
          <Stat
            label="Save up to"
            value={savings && savings > 0 ? formatCents(savings) : checkFailed ? 'Not known' : '—'}
            tone={savings && savings > 0 ? 'save' : 'muted'}
            testId="stat-savings"
            sub={
              savedPct !== null
                ? `${savedPct}% off what you paid · ${qualifying.length} option${qualifying.length === 1 ? '' : 's'} below it`
                : qualifying.length > 0
                  ? `${qualifying.length} option${qualifying.length > 1 ? 's' : ''} below what you paid`
                  : undefined
            }
          />
        </div>
      </div>

      {row.status === 'NEEDS_ATTENTION' && row.status_reason ? (
        <div className="mt-4">
          <Notice tone="danger" title="This trip needs attention">
            {row.status_reason} Monitoring is paused until you fix it, so it is not using provider
            credits.
          </Notice>
        </div>
      ) : null}

      {latestCycle?.status === 'PARTIAL_SUCCESS' && uncheckedDates.length > 0 ? (
        <div className="mt-4">
          <Notice tone="warn" title="Some dates could not be checked">
            We did not get a usable response for{' '}
            {uncheckedDates.map((d) => formatMediumDate(d.travelDate)).join(', ')} on the last run,
            so those days are not represented below. We will retry on the next check.
          </Notice>
        </div>
      ) : null}

      {checkFailed ? (
        <div className="mt-4">
          <Notice tone="danger" title="The last check failed">
            The fare provider could not be reached, so we cannot say whether anything got cheaper.
            This is not a &ldquo;no drop&rdquo; result.
          </Notice>
        </div>
      ) : null}

      {detail.lastDeliveryFailed ? (
        <div className="mt-4">
          <Notice tone="warn" title="We could not email you">
            At least one alert email failed to send. Everything is still visible here, and we retry
            automatically.
          </Notice>
        </div>
      ) : null}

      {detail.linkedLeg ? (
        <Section title="Round trip" className="mt-8">
          <RoundTripLeg leg={detail.linkedLeg} />
        </Section>
      ) : null}

      <div className="mt-8">
        <PricePosition
          history={priceHistory.map((point) => point.cents)}
          currentCents={detail.bestOption?.totalCents ?? null}
          benchmarkCents={row.benchmark_cents}
        />
      </div>

      {/* The chart is omitted rather than shown as an empty box: the panel
          above already explains that history is thin, and two grey cards
          saying so in slightly different words read as something broken. */}
      {priceHistory.filter((point) => point.cents !== null).length >= 2 ? (
        <Section
          title="Price history"
          className="mt-8"
          action={
            detail.alertCount > 0 ? (
              <span className="text-[12px] text-faint">
                {detail.alertCount} alert{detail.alertCount === 1 ? '' : 's'} sent
              </span>
            ) : null
          }
        >
          <PriceHistoryChart
            points={priceHistory}
            benchmarkCents={row.benchmark_cents}
            alerts={detail.alertMarkers}
            timezone={row.timezone}
          />
        </Section>
      ) : null}

      <Section title="Fares by date" className="mt-8">
        <FareStrip strip={strip} benchmarkCents={row.benchmark_cents} />
      </Section>

      <Section
        title="Cheapest options"
        className="mt-8"
        action={latestCycle ? <Badge tone={cycle.tone}>{cycle.label}</Badge> : null}
      >
        <OptionList
          options={qualifying.length > 0 ? qualifying : options}
          watchId={row.id}
          benchmarkCents={row.benchmark_cents}
          cycleFailed={checkFailed}
        />
      </Section>

      {/* Recording a rebooking is how the product learns what actually
          happened, and it belongs where the decision is made — not fifth in a
          stack of settings below the fold. */}
      {/* One row, not a section: it belongs immediately after the fares
          because that is where the decision happens, but it is a single action
          and does not need a heading of its own. */}
      <div className="rd-card mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
        <p className="min-w-0 max-w-xl text-[13px] leading-relaxed text-muted">
          <span className="font-semibold text-ink">Booked one of these?</span> Tell RailDrop what
          you paid and it watches against the new price — and counts the difference as money you
          actually saved. It never changes your reservation itself.
        </p>
        <RebookForm watchId={row.id} currentAmount={formatCents(row.benchmark_cents)} />
      </div>

      <Section title="Manage this trip" className="mt-10">
        <div className="space-y-3">
          <div className="rd-card divide-y divide-line">
            <div className="px-5 py-4">
              <WatchActions watchId={row.id} status={row.status} pinned={row.pinned} />
            </div>

            <ManageRow
              title="Target price"
              hint="A second reason to alert, on top of the normal drop rules."
            >
              <TargetPrice
                watchId={row.id}
                targetCents={row.target_price_cents}
                benchmarkCents={row.benchmark_cents}
                bestTotalCents={detail.bestOption?.totalCents ?? null}
              />
            </ManageRow>

            <div className="px-5 py-4">
              <ExtendWindow
                watchId={row.id}
                endsAt={toIsoString(row.monitoring_ends_at)}
                status={row.status}
              />
            </div>
          </div>

          {/* Set once, then forgotten. Findable, but not occupying a permanent
              block between the fares and the record of what happened. */}
          <Disclosure
            title="More settings"
            hint="Alert sensitivity for this trip, and a private note."
          >
            <div className="divide-y divide-line">
              <ManageRow
                title="Alert sensitivity"
                hint="How much cheaper an option has to be before this trip is worth interrupting you for."
              >
                <AlertSensitivity
                  watchId={row.id}
                  minimumSavingsCents={row.minimum_savings_cents}
                />
              </ManageRow>

              <ManageRow title="Private note" hint="Only you can see this.">
                <TripNote watchId={row.id} note={row.note} />
              </ManageRow>
            </div>
          </Disclosure>
        </div>
      </Section>

      <Section
        title="Activity"
        className="mt-10"
        action={
          <span className="flex items-center gap-3 text-[12px]">
            <a
              href={`/watches/${row.id}/export?format=csv`}
              className="font-semibold text-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
            >
              Export CSV
            </a>
            <a
              href={`/watches/${row.id}/export?format=ics`}
              className="font-semibold text-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
            >
              Add to calendar
            </a>
          </span>
        }
      >
        <Timeline entries={detail.timeline} timezone={row.timezone} />
      </Section>
    </AppShell>
  );
}

function ManageRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <h3 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-0.5 max-w-xl text-[12px] leading-relaxed text-faint">{hint}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/**
 * The other half of a round trip.
 *
 * Each leg is monitored independently — its own benchmark, dates and alert
 * state — so this is a link and a summary, not a merged view. The combined
 * figure is the only thing worth adding up, and it only exists once both legs
 * have a price.
 */
function RoundTripLeg({ leg }: { leg: LinkedLeg }) {
  const savings = leg.bestTotalCents !== null ? leg.benchmarkCents - leg.bestTotalCents : null;
  const hasDrop = savings !== null && savings > 0;

  return (
    <Link
      href={`/watches/${leg.id}`}
      data-testid="linked-leg"
      className="rd-card block px-5 py-4 transition-colors hover:border-line-strong"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <RouteLine origin={leg.originCode} destination={leg.destinationCode} size="sm" />
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
            {formatMediumDate(leg.desiredDate)}
          </span>
          {leg.status !== 'ACTIVE' ? (
            <Badge tone="warn">{leg.status.toLowerCase().replace('_', ' ')}</Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <div className="rd-label">Paid</div>
            <div className="tnum mt-1 text-[18px] font-bold leading-none tracking-tight text-ink">
              {formatCents(leg.benchmarkCents)}
            </div>
          </div>
          <div>
            <div className="rd-label">Best now</div>
            <div
              className={`tnum mt-1 text-[18px] font-bold leading-none tracking-tight ${
                hasDrop ? 'text-save' : 'text-ink'
              }`}
            >
              {leg.bestTotalCents !== null
                ? formatCents(leg.bestTotalCents)
                : leg.lastCycleStatus === 'FAILED'
                  ? 'Unknown'
                  : '—'}
            </div>
          </div>
          {hasDrop ? (
            <span className="tnum rounded-lg border border-save-line bg-save-soft px-2.5 py-1 text-[13px] font-bold text-save">
              Save {formatCents(savings)}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
