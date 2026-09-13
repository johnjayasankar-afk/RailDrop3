import { AppShell } from '@/components/AppShell';

/** Shown while the dashboard's queries run, so a slow DB never blanks the page. */
export default function DashboardLoading() {
  return (
    <AppShell active="dashboard">
      <div className="animate-pulse" aria-busy="true" aria-label="Loading your trips">
        <div className="h-9 w-44 rounded-lg bg-raised" />
        <div className="mt-2 h-4 w-64 rounded bg-raised" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rd-card px-5 py-5">
              <div className="h-6 w-48 rounded bg-raised" />
              <div className="mt-5 flex gap-8">
                <div className="h-9 w-24 rounded bg-raised" />
                <div className="h-9 w-24 rounded bg-raised" />
              </div>
              <div className="mt-4 h-4 w-3/4 rounded bg-raised" />
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
