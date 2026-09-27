import { redirect } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { Badge, Notice, Section } from '@/components/ui';
import { getCurrentUser } from '@/lib/db/server';
import { getServiceClientAsync, isServiceConfigured } from '@/lib/db/service';
import { getServerEnv, isAdminEmail, isSupabaseConfigured } from '@/lib/env';
import { describeActiveProvider } from '@/lib/providers';
import { getUsageSummary, isProviderCircuitOpen } from '@/lib/services/usage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Provider usage' };

export default async function UsagePage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/usage');

  const env = getServerEnv();

  if (!isAdminEmail(user.email)) {
    return (
      <AppShell email={user.email} active="usage">
        <h1 className="text-[28px] font-bold tracking-tight text-ink">Provider usage</h1>
        <div className="mt-6">
          <Notice tone="neutral" title="Operations only">
            This page shows account-wide fare-provider spend, so it is restricted to operators. Add
            your address to <code>RAILDROP_ADMIN_EMAILS</code> to see it.
          </Notice>
        </div>
      </AppShell>
    );
  }

  if (!isServiceConfigured()) {
    return (
      <AppShell email={user.email} active="usage">
        <Notice tone="warn" title="Worker not configured">
          <code>SUPABASE_SERVICE_ROLE_KEY</code> is missing.
        </Notice>
      </AppShell>
    );
  }

  const db = await getServiceClientAsync();
  const usage = await getUsageSummary(db);
  const circuitOpen = await isProviderCircuitOpen(db);
  const provider = describeActiveProvider();

  const { data: dispatches } = await db
    .from('dispatch_runs')
    .select(
      'bucket, status, runs_claimed, searches_executed, searches_saved, credits_charged, alerts_created, emails_sent, errors, duration_ms',
    )
    .order('bucket', { ascending: false })
    .limit(12);

  const pct = usage.budget > 0 ? Math.min(100, (usage.creditsUsed / usage.budget) * 100) : 0;
  const barTone = usage.hardStopped ? 'bg-danger' : usage.softStopped ? 'bg-warn' : 'bg-save';

  return (
    <AppShell email={user.email} active="usage">
      <h1 className="text-[28px] font-bold tracking-tight text-ink sm:text-[32px]">
        Provider usage
      </h1>
      <p className="mt-1.5 text-[14px] text-muted">
        Month to date. Credits are read from the provider&rsquo;s own response headers where
        available, and fall back to the configured estimate.
      </p>

      {!provider.isLive ? (
        <div className="mt-5">
          <Notice tone="danger" title="A non-live fare provider is active">
            <code>FARE_PROVIDER={provider.id}</code>. Fares shown to users are simulated. This must
            never be the case in production.
          </Notice>
        </div>
      ) : null}

      {circuitOpen ? (
        <div className="mt-5">
          <Notice tone="danger" title="Provider circuit is open">
            Recent consecutive failures exceeded the threshold. Scheduled checks will not call the
            provider until it recovers.
          </Notice>
        </div>
      ) : null}

      <Section title="Credit budget" className="mt-8">
        <div className="rd-card px-5 py-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="tnum text-[34px] font-bold leading-none tracking-tight text-ink">
                {usage.creditsUsed.toLocaleString()}
              </div>
              <p className="tnum mt-1.5 text-[13px] text-muted">
                of {usage.budget.toLocaleString()} credits · {usage.creditsPerSearch} per search
              </p>
            </div>
            <div className="text-right">
              <div className="tnum text-[13px] text-muted">
                Projected month end{' '}
                <strong className="text-ink">{usage.projectedMonthEnd.toLocaleString()}</strong>
              </div>
              <div className="mt-1.5">
                {usage.hardStopped ? (
                  <Badge tone="danger">Hard stop reached</Badge>
                ) : usage.softStopped ? (
                  <Badge tone="warn">Soft stop threshold</Badge>
                ) : (
                  <Badge tone="save">Within budget</Badge>
                )}
              </div>
            </div>
          </div>

          <div
            className="mt-4 h-2 w-full overflow-hidden rounded-full bg-line"
            role="img"
            aria-label={`${pct.toFixed(0)} percent of the monthly credit budget used`}
          >
            <div className={`h-full ${barTone}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Section>

      <Section title="Requests this month" className="mt-8">
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="Requests" value={usage.requests.toLocaleString()} />
          <Metric label="Succeeded" value={usage.successes.toLocaleString()} />
          <Metric
            label="Failed"
            value={usage.failures.toLocaleString()}
            tone={usage.failures > 0 ? 'warn' : 'ink'}
          />
          <Metric label="Avg latency" value={`${usage.avgLatencyMs} ms`} />
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          Deduplication saved <strong className="tnum">{usage.dedupeFanoutSaved}</strong> calls this
          month by serving overlapping travel windows from a single request.
        </p>
      </Section>

      <Section title="Recent dispatches" className="mt-8">
        <div className="rd-card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <caption className="sr-only">Recent hourly dispatch runs</caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-faint">
                {[
                  'Hour',
                  'Status',
                  'Runs',
                  'Calls',
                  'Saved',
                  'Credits',
                  'Alerts',
                  'Emails',
                  'Errors',
                  'ms',
                ].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(dispatches ?? []).length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-muted">
                    No dispatch has run yet.
                  </td>
                </tr>
              ) : (
                (dispatches as Array<Record<string, number | string>>).map((d) => (
                  <tr key={String(d.bucket)} className="border-b border-line last:border-0">
                    <td className="tnum px-3 py-2.5 text-muted">
                      {new Date(String(d.bucket)).toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={d.status === 'DONE' ? 'neutral' : 'danger'}>
                        {String(d.status)}
                      </Badge>
                    </td>
                    <td className="tnum px-3 py-2.5">{d.runs_claimed}</td>
                    <td className="tnum px-3 py-2.5">{d.searches_executed}</td>
                    <td className="tnum px-3 py-2.5 text-save">{d.searches_saved}</td>
                    <td className="tnum px-3 py-2.5">{d.credits_charged}</td>
                    <td className="tnum px-3 py-2.5">{d.alerts_created}</td>
                    <td className="tnum px-3 py-2.5">{d.emails_sent}</td>
                    <td className="tnum px-3 py-2.5">{d.errors}</td>
                    <td className="tnum px-3 py-2.5 text-faint">{d.duration_ms}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Configuration" className="mt-8">
        <dl className="rd-card divide-y divide-line text-[13px]">
          <ConfigRow
            label="Fare provider"
            value={`${provider.id}${provider.isLive ? ' (live)' : ' (SIMULATED)'}`}
          />
          <ConfigRow label="Provider key configured" value={provider.configured ? 'yes' : 'no'} />
          <ConfigRow label="Pricing basis" value={env.pricingBasis} />
          <ConfigRow label="Credits per search" value={String(env.creditsPerSearch)} />
          <ConfigRow label="Monthly budget" value={String(env.monthlyCreditBudget)} />
          <ConfigRow label="Max searches per dispatch" value={String(env.maxSearchesPerDispatch)} />
          <ConfigRow
            label="Manual check cooldown"
            value={`${env.manualCheckCooldownMinutes} min`}
          />
          <ConfigRow
            label="Amtrak deep link verified"
            value={env.amtrakDeeplinkVerified ? 'yes' : 'no (generic handoff)'}
          />
        </dl>
      </Section>
    </AppShell>
  );
}

function Metric({
  label,
  value,
  tone = 'ink',
}: {
  label: string;
  value: string;
  tone?: 'ink' | 'warn';
}) {
  return (
    <div className="rd-card px-4 py-4">
      <div className="rd-label">{label}</div>
      <div
        className={`tnum mt-1.5 text-[22px] font-bold leading-none tracking-tight ${
          tone === 'warn' ? 'text-warn' : 'text-ink'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="tnum font-semibold text-ink">{value}</dd>
    </div>
  );
}
