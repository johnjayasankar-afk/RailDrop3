import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerEnv, publicEnv } from '@/lib/env';

/**
 * User-scoped Supabase client for Server Components and Route Handlers.
 *
 * Reads go through RLS - the server never bypasses authorization on a user's
 * behalf. This is what makes IDOR structurally impossible rather than merely
 * unlikely.
 */
export async function getServerSupabase(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  if (getServerEnv().e2eMode) {
    const { getE2EUserClient, getE2EUserId, E2E_COOKIE, e2eUserExists } =
      await import('@/lib/e2e/harness');
    // The harness database is in memory, so it is rebuilt whenever the dev
    // server restarts. A cookie from an earlier database has to be treated as
    // no session at all — handing a dead id to a query fails a foreign key
    // several layers down, where the message says nothing about the session.
    const cookieUserId = cookieStore.get(E2E_COOKIE)?.value;
    const userId =
      cookieUserId && (await e2eUserExists(cookieUserId)) ? cookieUserId : await getE2EUserId();
    // Runs as the `authenticated` role, so RLS is enforced in E2E too.
    return getE2EUserClient(userId);
  }

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: middleware refreshes the session.
        }
      },
    },
  });
}

export async function getCurrentUser(): Promise<{ id: string; email: string | null } | null> {
  if (getServerEnv().e2eMode) {
    const cookieStore = await cookies();
    const { E2E_COOKIE, E2E_USER_EMAIL, e2eUserExists, getE2EUserId } =
      await import('@/lib/e2e/harness');
    const cookieUserId = cookieStore.get(E2E_COOKIE)?.value;
    if (!cookieUserId) return null;
    // Self-heal a cookie left over from a previous in-memory database rather
    // than reporting a signed-in session whose every write will fail.
    const id = (await e2eUserExists(cookieUserId)) ? cookieUserId : await getE2EUserId();
    return { id, email: E2E_USER_EMAIL };
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
