import { redirect } from 'next/navigation';

import { AppShell, signOut } from '@/components/AppShell';
import { DangerZone } from '@/components/DangerZone';
import { SettingsForm, type SettingsValues } from '@/components/SettingsForm';
import { Notice } from '@/components/ui';
import { minutesToClock } from '@/lib/domain/quiet-hours';
import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { getServerEnv, isSupabaseConfigured } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  if (!isSupabaseConfigured()) redirect('/dashboard');
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/settings');

  const db = await getServerSupabase();
  const { data } = await db
    .from('profiles')
    .select(
      'email, email_alerts, push_alerts, quiet_hours_start, quiet_hours_end, timezone, default_min_savings_cents',
    )
    .eq('id', user.id)
    .maybeSingle();

  const row = data as {
    email: string | null;
    email_alerts: boolean | null;
    push_alerts: boolean | null;
    quiet_hours_start: number | null;
    quiet_hours_end: number | null;
    timezone: string | null;
    default_min_savings_cents: number | null;
  } | null;

  const env = getServerEnv();
  const initial: SettingsValues = {
    email: row?.email ?? user.email,
    emailAlerts: row?.email_alerts ?? true,
    pushAlerts: row?.push_alerts ?? true,
    quietHoursStart: minutesToClock(row?.quiet_hours_start ?? null),
    quietHoursEnd: minutesToClock(row?.quiet_hours_end ?? null),
    timezone: row?.timezone ?? env.defaultTimezone,
    defaultMinSavingsCents: row?.default_min_savings_cents ?? env.alertMaterialDropCents,
  };

  return (
    <AppShell email={user.email} active="settings">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-[28px] font-bold tracking-tight text-ink sm:text-[32px]">Settings</h1>
        <p className="mt-1.5 text-[14px] text-muted">
          How and when RailDrop reaches you, and the defaults for new trips.
        </p>

        {!row ? (
          <div className="mt-5">
            <Notice tone="warn" title="No profile row yet">
              Your profile is created on first sign-in. If this persists, the{' '}
              <code>on_auth_user_created</code> trigger may not be installed — run{' '}
              <code>npm run db:verify</code>.
            </Notice>
          </div>
        ) : null}

        <div className="mt-7">
          <SettingsForm initial={initial} />
        </div>

        {/* Account. Sign-out lives here as well as in the desktop header,
            because on mobile the header has no room for it. */}
        <section className="mt-8 border-t border-line pt-6">
          <h2 className="rd-label">Account</h2>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13.5px] text-muted">
              Signed in as <span className="font-semibold text-ink">{user.email}</span>
            </p>
            <form action={signOut}>
              <button
                type="submit"
                className="rd-btn rd-btn-secondary !min-h-11 !px-4 !text-[14px]"
              >
                Sign out
              </button>
            </form>
          </div>
        </section>

        <DangerZone />
      </div>
    </AppShell>
  );
}
