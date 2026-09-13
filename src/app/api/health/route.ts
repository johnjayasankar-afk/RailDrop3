import { NextResponse } from 'next/server';

import { json } from '@/lib/api';
import { getServerEnv, isSupabaseConfigured } from '@/lib/env';
import { getServiceClientAsync, isServiceConfigured } from '@/lib/db/service';
import { describeActiveProvider } from '@/lib/providers';
import { getUsageSummary, isProviderCircuitOpen } from '@/lib/services/usage';
import { isEmailConfigured } from '@/lib/email/transport';
import { isPushConfigured } from '@/lib/push/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Past this with no dispatch, a scheduled slot has certainly been missed. */
const STALE_DISPATCH_HOURS = 14;

export async function GET(): Promise<NextResponse> {
  const env = getServerEnv();
  const provider = describeActiveProvider();

  let database: 'ok' | 'unconfigured' | 'error' = 'unconfigured';
  let circuitOpen: boolean | null = null;
  let budget: { used: number; budget: number; softStopped: boolean; hardStopped: boolean } | null =
    null;
  let scheduler: { lastDispatchAt: string | null; ageHours: number | null; stale: boolean } = {
    lastDispatchAt: null,
    ageHours: null,
    stale: false,
  };

  if (isServiceConfigured()) {
    try {
      const db = await getServiceClientAsync();
      const { error } = await db
        .from('stations')
        .select('code', { head: true, count: 'exact' })
        .limit(1);
      database = error ? 'error' : 'ok';
      if (!error) {
        circuitOpen = await isProviderCircuitOpen(db);

        // The most dangerous failure this app has is a scheduler that stops
        // firing: every component reports healthy, no error is raised, and no
        // fare is ever checked again. Nothing else here would notice.
        const { data: lastRun } = await db
          .from('dispatch_runs')
          .select('started_at')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const lastDispatchAt = (lastRun as { started_at: string } | null)?.started_at ?? null;
        if (lastDispatchAt) {
          const ageHours = (Date.now() - new Date(lastDispatchAt).getTime()) / 3_600_000;
          scheduler = {
            lastDispatchAt,
            ageHours: Math.round(ageHours * 10) / 10,
            // The widest gap between scheduled slots is 20:00 → 08:00, twelve
            // hours. Anything past fourteen means a slot was missed outright.
            stale: ageHours > STALE_DISPATCH_HOURS,
          };
        }
        const usage = await getUsageSummary(db);
        budget = {
          used: usage.creditsUsed,
          budget: usage.budget,
          softStopped: usage.softStopped,
          hardStopped: usage.hardStopped,
        };
      }
    } catch {
      database = 'error';
    }
  }

  // A deploy with no CRON_SECRET can never run a scheduled check, so it is not
  // healthy however green everything else looks.
  const healthy =
    database === 'ok' &&
    provider.configured &&
    circuitOpen !== true &&
    Boolean(env.cronSecret) &&
    // A deployment that has never dispatched is new, not broken; one that used
    // to and then stopped is broken and looks fine everywhere else.
    !scheduler.stale;

  return json(
    {
      status: healthy ? 'ok' : 'degraded',
      // Surfaced deliberately: a non-live provider in production is an incident.
      provider: { id: provider.id, live: provider.isLive, configured: provider.configured },
      database,
      supabaseConfigured: isSupabaseConfigured(),
      emailConfigured: isEmailConfigured(),
      pricingBasis: env.pricingBasis,
      // A wrong unit multiplies every fare by 100 and silently stops all alerting,
      // so it must be visible post-deploy rather than inferred from absurd prices.
      amountUnit: env.amountUnit,
      creditsPerSearch: env.creditsPerSearch,
      monthlyCreditBudget: env.monthlyCreditBudget,
      cronConfigured: Boolean(env.cronSecret),
      pushConfigured: isPushConfigured(),
      scheduler,
      providerCircuitOpen: circuitOpen,
      budget,
      time: new Date().toISOString(),
    },
    healthy ? 200 : 503,
  );
}
