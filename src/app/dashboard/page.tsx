import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { SetupChecklist } from '@/components/SetupChecklist';
import { DashboardList, DashboardStats } from '@/components/DashboardList';
import { ButtonLink, Notice } from '@/components/ui';
import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { isAdminEmail, isSupabaseConfigured } from '@/lib/env';
import { loadDashboard, loadSetupProgress } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trips' };

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) {
    return (
      <AppShell active="dashboard">
        <Notice tone="warn" title="RailDrop is not configured yet">
          Supabase environment variables are missing. See <code>SETUP_REQUIRED.md</code>.
        </Notice>
      </AppShell>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/dashboard');

  const db = await getServerSupabase();
  const [summaries, setup] = await Promise.all([loadDashboard(db), loadSetupProgress(db, user.id)]);

  const active = summaries.filter((s) => s.row.status === 'ACTIVE');

  return (
    <AppShell email={user.email} active="dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-ink sm:text-[32px]">
            Your trips
          </h1>
          <p className="mt-1.5 text-[14px] text-muted">
            {summaries.length === 0
              ? 'Nothing being watched yet.'
              : `${active.length} active · checked at 8am, 2pm and 8pm`}
          </p>
        </div>
        <ButtonLink href="/watches/new">
          <PlusIcon />
          Watch a trip
        </ButtonLink>
      </div>

      <div className="mt-6">
        <SetupChecklist progress={setup} />
      </div>

      <div className="mt-4">
        <DashboardStats summaries={summaries} />
      </div>

      <div className="mt-4">
        <DashboardList summaries={summaries} />
      </div>

      {/* Operations-only, so it is not offered to people who cannot open it. */}
      {isAdminEmail(user.email) ? (
        <p className="mt-10 text-[12px] leading-relaxed text-faint">
          <Link href="/usage" className="underline underline-offset-2 hover:text-muted">
            See how many provider credits your watches are using
          </Link>
        </p>
      ) : null}
    </AppShell>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7 2v10M2 7h10" />
    </svg>
  );
}
