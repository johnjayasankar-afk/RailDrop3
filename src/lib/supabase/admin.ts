import { createClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";

export function createAdminClient() {
  const config = getConfig();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("Supabase service role is not configured");
  }
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient() {
  const config = getConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Supabase anon key is not configured");
  }
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
