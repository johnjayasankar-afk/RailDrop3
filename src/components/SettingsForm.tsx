'use client';

import { useId, useState } from 'react';

import { saveSettingsAction } from '@/app/settings-actions';
import { formatCents } from '@/lib/domain/money';
import { PushToggle } from './PushToggle';
import { useToast } from './Toast';

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
  'Europe/London',
  'UTC',
];

export interface SettingsValues {
  emailAlerts: boolean;
  pushAlerts: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  defaultMinSavingsCents: number;
  email: string | null;
}

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const { toast } = useToast();
  const [emailAlerts, setEmailAlerts] = useState(initial.emailAlerts);
  const [pushAlerts, setPushAlerts] = useState(initial.pushAlerts);
  const [quietEnabled, setQuietEnabled] = useState(
    Boolean(initial.quietHoursStart && initial.quietHoursEnd),
  );
  const [quietStart, setQuietStart] = useState(initial.quietHoursStart || '22:00');
  const [quietEnd, setQuietEnd] = useState(initial.quietHoursEnd || '07:00');
  const [timezone, setTimezone] = useState(initial.timezone);
  const [minSavings, setMinSavings] = useState((initial.defaultMinSavingsCents / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The list is a convenience, not a limit — keep whatever the profile holds.
  const zones = TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await saveSettingsAction({
        emailAlerts,
        pushAlerts,
        quietHoursEnabled: quietEnabled,
        quietHoursStart: quietEnabled ? quietStart : '',
        quietHoursEnd: quietEnabled ? quietEnd : '',
        timezone,
        defaultMinSavings: minSavings,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not save your settings.');
        return;
      }
      toast({ title: 'Settings saved', tone: 'save' });
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      <Section
        title="How you hear about drops"
        description="RailDrop only ever contacts you when a fare is materially cheaper than what you paid."
      >
        <div className="space-y-3">
          <Switch
            checked={emailAlerts}
            onChange={setEmailAlerts}
            label="Email"
            description={
              initial.email ? `Sent to ${initial.email}` : 'No address on your account yet'
            }
          />
          <Switch
            checked={pushAlerts}
            onChange={setPushAlerts}
            label="Push notification"
            description="Instant, on any device you turn on below. Fares move fast — this is the channel that catches them."
          />
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <p className="rd-label mb-2.5">Devices</p>
          <PushToggle />
        </div>
      </Section>

      <Section
        title="Quiet hours"
        description="Alerts raised inside this window are held until it ends. Nothing is ever dropped — you will still get every drop, just not at 3am."
      >
        <Switch checked={quietEnabled} onChange={setQuietEnabled} label="Hold alerts overnight" />

        {quietEnabled ? (
          <div className="mt-4 grid max-w-sm gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="quiet-start" className="rd-label">
                From
              </label>
              <input
                id="quiet-start"
                type="time"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                className="rd-input ticket mt-1.5"
              />
            </div>
            <div>
              <label htmlFor="quiet-end" className="rd-label">
                Until
              </label>
              <input
                id="quiet-end"
                type="time"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                className="rd-input ticket mt-1.5"
              />
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Defaults for new trips">
        <div className="grid max-w-md gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="timezone" className="rd-label">
              Your timezone
            </label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="rd-input mt-1.5"
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[12px] text-faint">
              Checks run at 8am, 2pm and 8pm in this zone.
            </p>
          </div>

          <div>
            <label htmlFor="min-savings" className="rd-label">
              Minimum saving to alert
            </label>
            <div className="relative mt-1.5">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-faint"
              >
                $
              </span>
              <input
                id="min-savings"
                inputMode="decimal"
                value={minSavings}
                onChange={(e) => setMinSavings(e.target.value)}
                className="rd-input tnum !pl-7"
              />
            </div>
            <p className="mt-1.5 text-[12px] text-faint">
              Currently {formatCents(initial.defaultMinSavingsCents)}. Applies to new trips.
            </p>
          </div>
        </div>
      </Section>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-[13px] text-danger"
        >
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="rd-btn rd-btn-primary">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rd-card px-5 py-5">
      <h2 className="text-[16px] font-bold tracking-tight text-ink">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  const labelId = useId();
  const descriptionId = useId();

  /**
   * The whole row is the control.
   *
   * It used to be a <button role="switch"> inside a <label>, which is invalid:
   * a label with no `for` forwards its activation to the first labelable
   * descendant, so every tap fired the handler twice and the switch snapped
   * straight back to where it started.
   */
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={() => onChange(!checked)}
      className="flex w-full min-h-11 cursor-pointer items-start gap-3 rounded-lg text-left"
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors ${
          checked ? 'border-ink bg-invert' : 'border-line-strong bg-raised'
        }`}
      >
        <span
          className={`ml-0.5 size-4 rounded-full transition-transform ${
            checked ? 'translate-x-4 bg-on-invert' : 'translate-x-0 bg-faint'
          }`}
        />
      </span>
      <span className="min-w-0">
        <span id={labelId} className="block text-[14px] font-semibold text-ink">
          {label}
        </span>
        {description ? (
          <span
            id={descriptionId}
            className="mt-0.5 block text-[12.5px] leading-relaxed text-muted"
          >
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
