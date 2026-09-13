import { redirect } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { CreateWatchForm } from '@/components/CreateWatchForm';
import { Notice } from '@/components/ui';
import { todayInTimeZone } from '@/lib/domain/dates';
import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { StationOption } from '@/components/StationPicker';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Watch a trip' };

const DEFAULT_TIMEZONE = 'America/New_York';

export default async function NewWatchPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell>
        <Notice tone="warn" title="RailDrop is not configured yet">
          Supabase environment variables are missing. See <code>SETUP_REQUIRED.md</code>.
        </Notice>
      </AppShell>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/watches/new');

  const db = await getServerSupabase();
  const { data } = await db
    .from('stations')
    .select('code, name, city, state')
    .eq('is_active', true)
    .order('city');

  const stations = (data ?? []) as StationOption[];

  // The account's own defaults, so the summary states the threshold and the
  // timezone that will really apply rather than a hardcoded guess.
  const { data: profile } = await db
    .from('profiles')
    .select('timezone, default_min_savings_cents')
    .eq('id', user.id)
    .maybeSingle();
  const prefs = profile as {
    timezone: string | null;
    default_min_savings_cents: number | null;
  } | null;
  const timezone = prefs?.timezone ?? DEFAULT_TIMEZONE;
  const defaultMinSavingsCents = prefs?.default_min_savings_cents ?? 500;
  const today = todayInTimeZone(new Date(), timezone);

  return (
    <AppShell email={user.email}>
      <div className="mx-auto max-w-5xl">
        <h1 className="text-[28px] font-bold tracking-tight text-ink sm:text-[32px]">
          Watch a trip
        </h1>
        <p className="mt-1.5 max-w-lg text-[14px] leading-relaxed text-muted">
          Add a ticket you have already bought. We compare every eligible Amtrak option on your date
          and the days either side against what you actually paid.
        </p>

        {stations.length === 0 ? (
          <div className="mt-6">
            <Notice tone="warn" title="No stations loaded">
              Run the station seed (<code>supabase/seed/stations.sql</code>) or{' '}
              <code>npm run db:push</code> before creating a watch.
            </Notice>
          </div>
        ) : (
          <div className="mt-8">
            <CreateWatchForm
              stations={stations}
              today={today}
              timezone={timezone}
              defaultMinSavingsCents={defaultMinSavingsCents}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
