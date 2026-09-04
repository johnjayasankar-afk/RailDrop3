import { createBrowserClient } from "@supabase/ssr";
import { getConfig } from "@/lib/config";

export function createBrowserSupabase() {
  const config = getConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Supabase is not configured");
  }
  return createBrowserClient(config.supabaseUrl, config.supabaseAnonKey);
}
