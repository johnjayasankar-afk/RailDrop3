import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Wordmark } from '@/components/AppShell';
import { LoginForm } from '@/components/LoginForm';
import { Notice } from '@/components/ui';
import { getCurrentUser } from '@/lib/db/server';
import { safeNextPath } from '@/lib/api';
import { getServerEnv, isSupabaseConfigured, publicEnv } from '@/lib/env';

// This page branches on the signed-in session, so it must never be cached
// and served to another visitor.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const e2e = getServerEnv().e2eMode;
  const configured = isSupabaseConfigured();
  if (configured) {
    const user = await getCurrentUser();
    if (user) redirect('/dashboard');
  }

  const params = await searchParams;
  // Resolved and origin-compared; see safeNextPath for why a prefix test is not enough.
  const next = safeNextPath(params.next, publicEnv.appUrl);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-5">
          <Link href="/" aria-label="RailDrop home">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-12"
      >
        <h1 className="text-[26px] font-bold tracking-tight text-ink">Sign in to RailDrop</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Watch a trip you have already booked and get told when it gets cheaper.
        </p>

        <div className="mt-7">
          {e2e ? (
            <a
              href={`/api/e2e/login?next=${encodeURIComponent(next)}`}
              data-testid="e2e-signin"
              className="rd-btn rd-btn-primary w-full"
            >
              Sign in as test user
            </a>
          ) : configured ? (
            <LoginForm next={next} />
          ) : (
            <Notice tone="warn" title="Authentication is not configured">
              Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then reload. See{' '}
              <code>SETUP_REQUIRED.md</code>.
            </Notice>
          )}
        </div>
      </main>
    </div>
  );
}
