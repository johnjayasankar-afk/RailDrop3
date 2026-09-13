'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useMemo, useState } from 'react';

import { createWatchAction } from '@/app/actions';

import { addDays } from '@/lib/domain/dates';
import { Disclosure } from './Disclosure';
import { dollarsToCents } from '@/lib/domain/money';
import { PlanSummary } from './PlanSummary';
import { StationPicker, type StationOption } from './StationPicker';

interface FieldErrors {
  [field: string]: string | undefined;
}

const FLEX_OPTIONS = [
  { value: 0, label: 'Exact date', hint: '1 search per check' },
  { value: 1, label: '±1 day', hint: '3 searches per check' },
  { value: 2, label: '±2 days', hint: '5 searches per check' },
] as const;

const WINDOW_OPTIONS = [
  { value: '24H', label: '24 hours' },
  { value: '48H', label: '48 hours' },
  { value: '72H', label: '72 hours' },
  { value: 'UNTIL_DEPARTURE', label: 'Until departure' },
] as const;

/** Hours each preset stands for, so the summary can do arithmetic on it.
 *  UNTIL_DEPARTURE is unbounded here; the planner caps it at the journey. */
const MONITORING_HOURS: Record<string, number> = {
  '24H': 24,
  '48H': 48,
  '72H': 72,
  UNTIL_DEPARTURE: 24 * 365,
};

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Vancouver',
  'America/Toronto',
];

export function CreateWatchForm({
  stations,
  today,
  timezone: defaultTimezone,
  defaultMinSavingsCents,
}: {
  stations: StationOption[];
  today: string;
  timezone: string;
  /** The account default that will apply to this trip unless overridden. */
  defaultMinSavingsCents: number;
}) {
  const router = useRouter();
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [desiredDate, setDesiredDate] = useState(addDays(today, 14));
  const [amountPaid, setAmountPaid] = useState('');

  // Parsed leniently for the summary only: a half-typed amount should leave
  // the panel saying "once you enter what you paid", never throw into a form
  // the user is still filling in.
  const parsedBenchmarkCents = useMemo(() => {
    const trimmed = amountPaid.trim();
    if (trimmed === '') return null;
    try {
      return dollarsToCents(trimmed);
    } catch {
      return null;
    }
  }, [amountPaid]);
  const [passengers, setPassengers] = useState('1');
  const [flex, setFlex] = useState<number>(1);
  const [monitoringPreset, setMonitoringPreset] = useState<string>('48H');
  const [travelClass, setTravelClass] = useState('COACH');
  const [fareFamily, setFareFamily] = useState('FLEXIBLE');
  const [preferredTime, setPreferredTime] = useState('');
  const [trainNumber, setTrainNumber] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [roundTrip, setRoundTrip] = useState(false);
  const [returnDate, setReturnDate] = useState('');
  const [returnAmount, setReturnAmount] = useState('');
  const [includeThruway, setIncludeThruway] = useState(false);
  const [includeRestricted, setIncludeRestricted] = useState(false);
  const [timezone, setTimezone] = useState(defaultTimezone);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const partyPricingWarning = Number(passengers) > 1;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);

    const next: FieldErrors = {};
    if (!origin) next.originCode = 'Choose a departure station';
    if (!destination) next.destinationCode = 'Choose an arrival station';
    if (origin && origin === destination) next.destinationCode = 'Pick a different station';
    if (!amountPaid.trim()) next.amountPaid = 'Enter what you actually paid';
    if (desiredDate < today) next.desiredDate = 'That date is already in the past';

    if (Object.keys(next).length > 0) {
      setErrors(next);
      setSubmitting(false);
      return;
    }

    try {
      const result = await createWatchAction({
        originCode: origin,
        destinationCode: destination,
        desiredDate,
        amountPaid,
        passengers: Number(passengers),
        dateFlexibilityDays: flex,
        travelClass,
        fareFamily,
        preferredDepartureTime: preferredTime || null,
        monitoringPreset,
        includeThruway,
        includeRestrictedFares: includeRestricted,
        timezone,
        originalTrainNumber: trainNumber || null,
        targetPrice: targetPrice.trim() === '' ? null : targetPrice.trim(),
        returnDate: roundTrip && returnDate ? returnDate : null,
        returnAmountPaid: roundTrip && returnAmount.trim() !== '' ? returnAmount.trim() : null,
      });

      if (!result.ok || !result.watchId) {
        if (result.field) setErrors({ [result.field]: result.error });
        setFormError(result.error ?? 'Could not create the watch.');
        setSubmitting(false);
        return;
      }

      startTransition(() => {
        router.push(`/watches/${result.watchId}`);
      });
    } catch {
      setFormError('Something went wrong — please try again.');
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]"
    >
      <div className="space-y-8 lg:col-start-1 lg:row-start-1">
        <fieldset className="space-y-4">
          <legend className="sr-only">Route and date</legend>
          <div className="relative grid gap-4 sm:grid-cols-2">
            <StationPicker
              label="From"
              name="originCode"
              stations={stations}
              value={origin}
              onChange={setOrigin}
              error={errors.originCode}
              autoFocus
            />

            <button
              type="button"
              onClick={() => {
                setOrigin(destination);
                setDestination(origin);
              }}
              disabled={!origin && !destination}
              aria-label="Swap origin and destination"
              title="Swap"
              className="absolute left-1/2 top-[38px] z-10 hidden size-8 -translate-x-1/2 items-center justify-center rounded-full border border-line-strong bg-surface text-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40 sm:inline-flex"
            >
              <svg
                viewBox="0 0 14 14"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 5h10M9.5 2.5L12 5 9.5 7.5M12 9H2M4.5 6.5L2 9l2.5 2.5" />
              </svg>
            </button>

            <StationPicker
              label="To"
              name="destinationCode"
              stations={stations}
              value={destination}
              onChange={setDestination}
              error={errors.destinationCode}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="desiredDate" className="rd-label">
                Travel date
              </label>
              <input
                id="desiredDate"
                type="date"
                min={today}
                value={desiredDate}
                onChange={(e) => setDesiredDate(e.target.value)}
                aria-invalid={Boolean(errors.desiredDate)}
                aria-describedby={errors.desiredDate ? 'desiredDate-error' : undefined}
                className="rd-input mt-1.5"
                required
              />
              {errors.desiredDate ? (
                <p id="desiredDate-error" role="alert" className="mt-1.5 text-[12px] text-danger">
                  {errors.desiredDate}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="passengers" className="rd-label">
                Passengers
              </label>
              <select
                id="passengers"
                value={passengers}
                onChange={(e) => setPassengers(e.target.value)}
                className="rd-input mt-1.5"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'passenger' : 'passengers'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="rd-label">Return leg</legend>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
            A round trip is watched as two legs, each against its own receipt total. Fares on the
            two directions move independently, and RailDrop never splits one combined amount across
            two dates.
          </p>

          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={roundTrip}
              onChange={(e) => setRoundTrip(e.target.checked)}
              className="mt-0.5 size-4 accent-[#16130f]"
            />
            <span className="text-[14px] leading-snug text-ink">
              This is a round trip
              <span className="block text-[12px] text-faint">
                We will also watch {destination || 'the destination'} → {origin || 'the origin'}.
              </span>
            </span>
          </label>

          {roundTrip ? (
            <div className="mt-4 grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
              <div>
                <label htmlFor="returnDate" className="rd-label">
                  Return date <span className="text-danger">*</span>
                </label>
                <input
                  id="returnDate"
                  type="date"
                  value={returnDate}
                  min={desiredDate || undefined}
                  onChange={(e) => setReturnDate(e.target.value)}
                  aria-invalid={errors['returnDate'] ? 'true' : undefined}
                  className="rd-input tnum mt-1.5"
                />
                {errors['returnDate'] ? (
                  <p role="alert" className="mt-1.5 text-[12px] text-danger">
                    {errors['returnDate']}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="returnAmount" className="rd-label">
                  Paid for the return <span className="text-danger">*</span>
                </label>
                <div className="relative mt-1.5">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-faint"
                  >
                    $
                  </span>
                  <input
                    id="returnAmount"
                    inputMode="decimal"
                    value={returnAmount}
                    onChange={(e) => setReturnAmount(e.target.value)}
                    aria-invalid={errors['returnAmountPaid'] ? 'true' : undefined}
                    placeholder="128.00"
                    className="rd-input tnum !pl-7"
                  />
                </div>
                <p className="mt-1.5 text-[12px] text-faint">
                  {errors['returnAmountPaid'] ??
                    'The return half of your receipt, for all passengers.'}
                </p>
              </div>
            </div>
          ) : null}
        </fieldset>

        <fieldset>
          <legend className="rd-label">Date flexibility</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {FLEX_OPTIONS.map((option) => (
              <div
                key={option.value}
                className={`flex flex-col gap-0.5 rounded-xl border px-4 py-3 transition-colors ${
                  flex === option.value
                    ? 'border-ink bg-surface'
                    : 'border-line bg-surface hover:border-line-strong'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    id={`flex-${option.value}`}
                    type="radio"
                    name="dateFlexibilityDays"
                    value={option.value}
                    checked={flex === option.value}
                    onChange={() => setFlex(option.value)}
                    aria-describedby={`flex-${option.value}-hint`}
                    className="accent-[#16130f]"
                  />
                  <label
                    htmlFor={`flex-${option.value}`}
                    className="cursor-pointer text-[14px] font-semibold text-ink"
                  >
                    {option.label}
                  </label>
                </span>
                <span id={`flex-${option.value}-hint`} className="pl-6 text-[12px] text-faint">
                  {option.hint}
                </span>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="sr-only">Your current ticket</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="amountPaid" className="rd-label">
                Total you actually paid
              </label>
              <div className="relative mt-1.5">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-faint"
                >
                  $
                </span>
                <input
                  id="amountPaid"
                  inputMode="decimal"
                  placeholder="128.00"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  aria-invalid={Boolean(errors.amountPaid)}
                  aria-describedby={errors.amountPaid ? 'amountPaid-error' : 'amountPaid-hint'}
                  className="rd-input tnum !pl-7"
                  required
                />
              </div>
              {errors.amountPaid ? (
                <p id="amountPaid-error" role="alert" className="mt-1.5 text-[12px] text-danger">
                  {errors.amountPaid}
                </p>
              ) : (
                <p id="amountPaid-hint" className="mt-1.5 text-[12px] text-faint">
                  The figure on your receipt, for all {passengers} passenger
                  {Number(passengers) === 1 ? '' : 's'}. Nothing is estimated from it.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="monitoringPreset" className="rd-label">
                Watch for
              </label>
              <select
                id="monitoringPreset"
                value={monitoringPreset}
                onChange={(e) => setMonitoringPreset(e.target.value)}
                className="rd-input mt-1.5"
              >
                {WINDOW_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="max-w-xs">
            <label htmlFor="timezone" className="rd-label">
              Your timezone
            </label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="rd-input mt-1.5"
            >
              {(TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]).map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[12px] text-faint">
              Decides when the three daily checks run. Change the default in Settings.
            </p>
          </div>

          {partyPricingWarning ? (
            <div className="rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-[13px] leading-relaxed text-warn">
              <strong>Multi-passenger note.</strong> Until the fare provider&rsquo;s per-passenger
              vs. total-party pricing is verified for this deployment, RailDrop will show options
              for parties but will not email savings alerts it cannot arithmetically guarantee.
            </div>
          ) : null}
        </fieldset>

        <div>
          <Disclosure
            title="Fare &amp; service options"
            hint="Travel class, fare family, preferred departure time, a target price, and whether to include buses or restricted fares."
          >
            <div className="space-y-4 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="travelClass" className="rd-label">
                    Travel class
                  </label>
                  <select
                    id="travelClass"
                    value={travelClass}
                    onChange={(e) => setTravelClass(e.target.value)}
                    className="rd-input mt-1.5"
                  >
                    <option value="COACH">Coach</option>
                    <option value="BUSINESS">Business</option>
                    <option value="FIRST">First</option>
                    <option value="SLEEPER">Sleeper</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="fareFamily" className="rd-label">
                    Fare you bought
                  </label>
                  <select
                    id="fareFamily"
                    value={fareFamily}
                    onChange={(e) => setFareFamily(e.target.value)}
                    className="rd-input mt-1.5"
                  >
                    <option value="FLEXIBLE">Flexible</option>
                    <option value="VALUE">Value</option>
                    <option value="SAVER">Saver</option>
                  </select>
                  <p className="mt-1.5 text-[12px] text-faint">
                    Compared like for like unless you include restricted fares below.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="preferredTime" className="rd-label">
                    Preferred departure (optional)
                  </label>
                  <input
                    id="preferredTime"
                    type="time"
                    value={preferredTime}
                    onChange={(e) => setPreferredTime(e.target.value)}
                    className="rd-input mt-1.5"
                  />
                  <p className="mt-1.5 text-[12px] text-faint">
                    Only used to break ties — price always wins.
                  </p>
                </div>
                <div>
                  <label htmlFor="targetPrice" className="rd-label">
                    Target price (optional)
                  </label>
                  <div className="relative mt-1.5">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-faint"
                    >
                      $
                    </span>
                    <input
                      id="targetPrice"
                      inputMode="decimal"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      aria-invalid={errors['targetPrice'] ? 'true' : undefined}
                      placeholder="89.00"
                      className="rd-input tnum !pl-7"
                    />
                  </div>
                  <p className="mt-1.5 text-[12px] text-faint">
                    {errors['targetPrice'] ??
                      'We will tell you the moment it reaches this, on top of the normal drop alerts.'}
                  </p>
                </div>
                <div>
                  <label htmlFor="trainNumber" className="rd-label">
                    Train you booked (optional)
                  </label>
                  <input
                    id="trainNumber"
                    value={trainNumber}
                    onChange={(e) => setTrainNumber(e.target.value)}
                    placeholder="179"
                    className="rd-input mt-1.5"
                  />
                  <p className="mt-1.5 text-[12px] text-faint">
                    Context only. Every eligible train competes.
                  </p>
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={includeRestricted}
                  onChange={(e) => setIncludeRestricted(e.target.checked)}
                  className="mt-0.5 size-4 accent-[#16130f]"
                />
                <span className="text-[14px] leading-snug text-ink">
                  Include cheaper restricted fares
                  <span className="block text-[12px] text-faint">
                    Value and Saver fares limit changes and refunds. They are labelled clearly.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={includeThruway}
                  onChange={(e) => setIncludeThruway(e.target.checked)}
                  className="mt-0.5 size-4 accent-[#16130f]"
                />
                <span className="text-[14px] leading-snug text-ink">
                  Include Thruway bus connections
                  <span className="block text-[12px] text-faint">
                    Off by default. Bus segments are never labelled as rail.
                  </span>
                </span>
              </label>
            </div>
          </Disclosure>
        </div>

        {formError ? (
          <div
            role="alert"
            className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-[13px] text-danger"
          >
            {formError}
          </div>
        ) : null}
      </div>

      {/* Column two on a wide screen, and on a phone it falls between the
          fields and the button — so the commitment is read before it is made,
          not after. Sticky so it stays with you down a long form. */}
      <div className="lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1 lg:row-span-2">
        <PlanSummary
          input={{
            desiredDate,
            dateFlexibilityDays: flex,
            monitoringHours: MONITORING_HOURS[monitoringPreset] ?? 48,
            today,
            benchmarkCents: parsedBenchmarkCents,
            minimumSavingsCents: defaultMinSavingsCents,
            passengers: Number(passengers),
            returnDate: roundTrip && returnDate ? returnDate : null,
          }}
          originCode={origin}
          destinationCode={destination}
          timezone={timezone}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 lg:col-start-1 lg:row-start-2">
        <button type="submit" disabled={submitting} className="rd-btn rd-btn-primary">
          {submitting ? 'Starting first check…' : 'Start watching'}
        </button>
        <p className="text-[12px] text-faint">We run the first check immediately.</p>
      </div>
    </form>
  );
}
