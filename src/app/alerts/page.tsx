import { redirect } from 'next/navigation';

import { AlertList } from '@/components/AlertList';
import { AppShell } from '@/components/AppShell';
import { ButtonLink, EmptyState } from '@/components/ui';
import { formatCents } from '@/lib/domain/money';
import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { isSupabaseConfigured } from '@/lib/env';
import { loadAlertHistory, loadRealisedSavings } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Alert history' };

export default async function AlertsPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/alerts');

  const db = await getServerSupabase();
  const [alerts, realised] = await Promise.all([loadAlertHistory(db), loadRealisedSavings(db)]);

  const { data: profile } = await db
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .maybeSingle();
  const timezone = (profile as { timezone: string | null } | null)?.timezone ?? 'America/New_York';

  const totalSavings = alerts.reduce((acc, a) => acc + Math.max(0, a.savingsCents), 0);

  return (
    <AppShell email={user.email} active="alerts">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-ink sm:text-[33px]">
            Alert history
          </h1>
          <p className="mt-1.5 text-[13.5px] text-muted">
            {alerts.length === 0
              ? 'Every alert RailDrop sends will be listed here, with what happened to it.'
              : `${alerts.length} alert${alerts.length === 1 ? '' : 's'} sent`}
          </p>
        </div>
      </div>

      {/* Two numbers, deliberately side by side. Every fare monitor can show
          the first; only one that knows what you actually paid can show the
          second, and the difference between them is the honest one. */}
      <dl className="mt-6 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2">
        <div className="bg-surface px-5 py-4">
          <dt className="rd-label">Savings surfaced</dt>
          <dd className="tnum mt-1.5 text-[26px] font-bold leading-none tracking-tight text-ink">
            {formatCents(totalSavings)}
          </dd>
          <dd className="mt-1.5 text-[12px] leading-relaxed text-faint">
            What the cheaper options we found were worth, added up.
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="rd-label">Actually saved</dt>
          <dd
            data-testid="realised-savings"
            className={`tnum mt-1.5 text-[26px] font-bold leading-none tracking-tight ${
              realised.totalCents > 0 ? 'text-save' : 'text-ink'
            }`}
          >
            {formatCents(realised.totalCents)}
          </dd>
          <dd className="mt-1.5 text-[12px] leading-relaxed text-faint">
            {realised.totalCents > 0
              ? `From ${realised.rebookings} rebooking${realised.rebookings === 1 ? '' : 's'} across ${realised.trips} trip${realised.trips === 1 ? '' : 's'}, measured against what you told us you paid.`
              : 'Rebook a cheaper fare and tell RailDrop what you paid — the difference is counted here.'}
          </dd>
        </div>
      </dl>

      {alerts.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No alerts yet"
            body="RailDrop only tells you when a fare is materially cheaper than what you paid, or reaches a target you set. Silence means it has been checking and found nothing worth interrupting you for."
            action={<ButtonLink href="/dashboard">Back to your trips</ButtonLink>}
          />
        </div>
      ) : (
        <AlertList alerts={alerts} timezone={timezone} />
      )}

      <p className="mt-8 text-[12px] leading-relaxed text-faint">
        A delivery marked <strong>failed</strong> is retried automatically with backoff. The alert
        itself is never lost — it is always visible here and on the trip.
      </p>
    </AppShell>
  );
}
