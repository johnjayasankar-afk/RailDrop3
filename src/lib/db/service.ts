import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getServerEnv, publicEnv } from '@/lib/env';

/**
 * Service-role Supabase client. Bypasses RLS, so it may ONLY be used by
 * background work (the dispatcher, cycle runner, alert service) and never in a
 * request path that renders another user's data.
 *
 * ESLint forbids importing this module from src/components/**.
 */
let client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (client) return client;
  const env = getServerEnv();
  if (env.e2eMode) {
    throw new Error('In E2E mode use getServiceClientAsync(); the harness is asynchronous.');
  }
  if (!publicEnv.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error(
      'Supabase service role is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  client = createClient(publicEnv.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'raildrop-worker' } },
  });
  return client;
}

export function isServiceConfigured(): boolean {
  try {
    const env = getServerEnv();
    if (env.e2eMode) return true;
    return Boolean(publicEnv.supabaseUrl && env.supabaseServiceRoleKey);
  } catch {
    return false;
  }
}

/**
 * The service-role client. In E2E mode this resolves to the in-process Postgres
 * harness so Playwright drives the real code path; everywhere else it is the
 * ordinary Supabase service client.
 */
export async function getServiceClientAsync(): Promise<SupabaseClient> {
  if (getServerEnv().e2eMode) {
    const { getE2EServiceClient } = await import('@/lib/e2e/harness');
    return getE2EServiceClient();
  }
  return getServiceClient();
}

/** Test hook. */
export function __setServiceClient(next: SupabaseClient | null): void {
  client = next;
}
