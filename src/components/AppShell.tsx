import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getServerSupabase } from '@/lib/db/server';
import { isAdminEmail } from '@/lib/env';
import { DemoBanner } from './DemoBanner';
import { ThemeToggle } from './ThemeToggle';

export async function signOut(): Promise<void> {
  'use server';
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect('/login');
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-[7px] ${className}`}>
      <span className="text-[15px] font-bold uppercase tracking-[0.2em] text-ink">Rail</span>
      <span className="text-[15px] font-bold uppercase tracking-[0.2em] text-rust">Drop</span>
    </span>
  );
}

export function AppShell({
  children,
  email,
  active,
}: {
  children: ReactNode;
  email?: string | null;
  active?: NavKey;
}) {
  // Operations-only. Showing it to everyone put a primary navigation tab —
  // and a dashboard link — in front of every user that dead-ends in "you
  // cannot see this page".
  const showUsage = isAdminEmail(email);
  const navLink = (href: string, label: string, key: NavKey) => (
    <Link
      href={href}
      aria-current={active === key ? 'page' : undefined}
      className={`inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-semibold transition-colors ${
        active === key ? 'bg-ink text-white' : 'text-muted hover:text-ink'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-dvh">
      <DemoBanner />
      <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/dashboard" className="shrink-0" aria-label="RailDrop home">
            <Wordmark />
          </Link>

          {/* Below sm the primary nav lives in the bottom tab bar, where a
              thumb can reach it — five inline items cannot fit 390px without
              either overflowing or shrinking below a usable tap target. */}
          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            {navLink('/dashboard', 'Trips', 'dashboard')}
            {navLink('/alerts', 'Alerts', 'alerts')}
            {navLink('/settings', 'Settings', 'settings')}
            <span className="mx-1.5">
              <ThemeToggle />
            </span>
            {email ? (
              <form action={signOut}>
                <button type="submit" className="rd-btn rd-btn-ghost !min-h-11 !px-3 !text-[13px]">
                  Sign out
                </button>
              </form>
            ) : null}
          </nav>

          <span className="sm:hidden">
            <ThemeToggle />
          </span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
        {children}
      </main>

      <MobileTabBar active={active} showUsage={showUsage} />

      <footer className="border-t border-line pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-6">
          <p className="max-w-xl text-[12px] leading-relaxed text-faint">
            RailDrop monitors published Amtrak fares and never modifies your reservation. Fares and
            availability change constantly — always confirm on Amtrak before booking.
          </p>
        </div>
      </footer>
    </div>
  );
}

type NavKey = 'dashboard' | 'alerts' | 'settings' | 'usage';

const TABS: Array<{ href: string; label: string; key: NavKey; path: string }> = [
  // Single-stroke glyphs in the same weight as the rest of the interface —
  // no icon font, no third-party set, nothing to load.
  { href: '/dashboard', label: 'Trips', key: 'dashboard', path: 'M3 7h18M6 7v10M18 7v10M3 17h18' },
  {
    href: '/alerts',
    label: 'Alerts',
    key: 'alerts',
    path: 'M6 9a6 6 0 1112 0c0 4 1.5 5 1.5 5h-15S6 13 6 9zM10 19a2 2 0 004 0',
  },
  { href: '/usage', label: 'Usage', key: 'usage', path: 'M4 19V9M10 19V5M16 19v-7M22 19H2' },
  {
    href: '/settings',
    label: 'Settings',
    key: 'settings',
    path: 'M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4m0-11.4l-1.4 1.4M7.7 16.3l-1.4 1.4',
  },
];

/**
 * Thumb-reachable navigation for the installed app. Hidden from sm upward,
 * where the header nav takes over.
 */
function MobileTabBar({ active, showUsage }: { active?: NavKey; showUsage: boolean }) {
  const tabs = TABS.filter((tab) => tab.key !== 'usage' || showUsage);
  return (
    <nav
      aria-label="Main"
      data-testid="tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {tabs.map((tab) => {
          const current = active === tab.key;
          return (
            <li key={tab.key} className="flex-1">
              <Link
                href={tab.href}
                aria-current={current ? 'page' : undefined}
                className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-1 text-[10.5px] font-semibold tracking-tight transition-colors ${
                  current ? 'text-ink' : 'text-faint'
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="size-[19px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={current ? 2.1 : 1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={tab.path} />
                </svg>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
