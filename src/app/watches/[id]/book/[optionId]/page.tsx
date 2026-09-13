import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { Badge, Notice } from '@/components/ui';
import { RouteLine } from '@/components/RouteLine';
import { CopyBlock } from '@/components/CopyBlock';
import { resolveBookingHandoff } from '@/lib/domain/booking-link';
import { formatDurationMinutes, formatMediumDate, describeDisplacement } from '@/lib/domain/dates';
import { formatCents } from '@/lib/domain/money';
import type { Candidate, Journey, Fare, FareFamily, TravelClass } from '@/lib/domain/types';
import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { getServerEnv } from '@/lib/env';
import { clockFromLocalIso, describeService, describeTransfers, titleCase } from '@/lib/format';
import { loadWatchDetail } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Continue to Amtrak' };

export default async function BookingHandoffPage({
  params,
}: {
  params: Promise<{ id: string; optionId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id, optionId } = await params;
  const db = await getServerSupabase();
  const detail = await loadWatchDetail(db, id);
  if (!detail) notFound();

  const option = detail.options.find((o) => o.fareOptionId === optionId);
  if (!option) notFound();

  const env = getServerEnv();

  // Reuse the exact domain resolver the alert pipeline uses, so the UI can never
  // disagree with what the rest of the system believes about a booking link.
  const journey: Journey = {
    providerJourneyId: option.journeyOptionId,
    serviceName: option.serviceName,
    trainNumber: option.trainNumber,
    originCode: detail.row.origin_code,
    destinationCode: detail.row.destination_code,
    departureLocal: option.departureLocal,
    arrivalLocal: option.arrivalLocal,
    durationMinutes: option.durationMinutes,
    transfers: option.transfers,
    travelDate: option.travelDate,
    serviceType: 'DIRECT_RAIL',
    legs: [],
    fares: [],
    bookingUrl: option.bookingUrl,
  };
  const fare: Fare = {
    id: option.fareOptionId,
    family: option.fareFamily as FareFamily,
    familyRaw: null,
    travelClass: option.travelClass as TravelClass,
    travelClassRaw: null,
    amountCents: option.totalCents,
    partyTotalCents: option.totalCents,
    currency: 'USD',
    pricingBasis: 'UNKNOWN',
    pricingConfidence: 'UNAMBIGUOUS_SINGLE',
    availability: 'AVAILABLE',
    restricted: option.restricted,
    refundable: null,
    seatsRemaining: option.seatsRemaining,
  };
  const candidate: Candidate = {
    journey,
    fare,
    searchDate: { date: option.travelDate, displacementDays: option.displacementDays },
  };

  const observedAt = detail.latestCycle?.completed_at ?? new Date().toISOString();
  const handoff = resolveBookingHandoff(candidate, detail.watch, observedAt, {
    deeplinkVerified: env.amtrakDeeplinkVerified,
    deeplinkTemplate: env.amtrakDeeplinkTemplate,
  });

  const savings = detail.row.benchmark_cents - option.totalCents;

  return (
    <AppShell email={user.email} active="dashboard">
      <div className="mx-auto max-w-lg">
        <Link
          href={`/watches/${id}`}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink"
        >
          <span aria-hidden="true">&larr;</span> Back to trip
        </Link>

        <h1 className="mt-4 text-[24px] font-bold tracking-tight text-ink">You&rsquo;re booking</h1>

        <div className="rd-card mt-4 px-5 py-5">
          <RouteLine origin={detail.row.origin_code} destination={detail.row.destination_code} />

          <dl className="mt-4 space-y-2.5 text-[14px]">
            <Row label="Date">
              {formatMediumDate(option.travelDate)}
              {option.displacementDays !== 0 ? (
                <span className="ml-2 text-[12px] text-muted">
                  {describeDisplacement(option.displacementDays)}
                </span>
              ) : null}
            </Row>
            <Row label="Service">{describeService(option.serviceName, option.trainNumber)}</Row>
            <Row label="Time">
              <span className="tnum">
                {clockFromLocalIso(option.departureLocal)} &rarr;{' '}
                {clockFromLocalIso(option.arrivalLocal)}
              </span>
              <span className="ml-2 text-[12px] text-muted">
                {formatDurationMinutes(option.durationMinutes)} ·{' '}
                {describeTransfers(option.transfers)}
              </span>
            </Row>
            <Row label="Fare">
              {titleCase(option.fareFamily)} {titleCase(option.travelClass)}
              {option.restricted ? (
                <span className="ml-2">
                  <Badge tone="warn">Restricted</Badge>
                </span>
              ) : null}
            </Row>
            <Row label="Passengers">{detail.row.passengers}</Row>
          </dl>

          <div className="mt-5 border-t border-line pt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="rd-label">Observed fare</div>
                <div className="tnum mt-1 text-[30px] font-bold leading-none tracking-tight text-ink">
                  {formatCents(option.totalCents)}
                </div>
              </div>
              {savings > 0 ? (
                <div className="rounded-lg border border-save-line bg-save-soft px-3 py-1.5">
                  <span className="tnum text-[14px] font-bold text-save">
                    Save {formatCents(savings)}
                  </span>
                </div>
              ) : null}
            </div>
            <p className="tnum mt-2 text-[12px] text-faint">
              Observed {new Date(observedAt).toUTCString()}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Notice tone={handoff.confidence === 'GENERIC' ? 'neutral' : 'save'}>
            {handoff.disclosure}
          </Notice>
        </div>

        <div className="mt-5 space-y-2">
          <a
            href={handoff.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rd-btn rd-btn-primary w-full"
          >
            Continue to Amtrak
          </a>
          <CopyBlock text={handoff.copyText} label="Copy trip details" />
        </div>

        <p className="mt-5 text-[12px] leading-relaxed text-faint">
          Fares and availability change constantly. RailDrop does not hold inventory and does not
          modify your existing reservation. Once you have rebooked, come back and record the new
          price so monitoring continues correctly.
        </p>
      </div>
    </AppShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <dt className="w-24 shrink-0 text-[12px] font-semibold uppercase tracking-wider text-faint">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-ink">{children}</dd>
    </div>
  );
}
