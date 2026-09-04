import { getConfig } from "@/lib/config";
import path from "node:path";
import { MemoryRepository } from "@/lib/db/memory-store";
import { createPersistedMemoryRepository } from "@/lib/db/local-persist";
import type { RailDropRepository } from "@/lib/db/repository";
import { SupabaseRepository } from "@/lib/db/supabase-repository";
import { RecordingMailer, ResendMailer } from "@/lib/notifications/resend-mailer";
import type { Mailer } from "@/lib/notifications/send-alert";
import type { FareProvider } from "@/lib/providers/fare-provider";
import { ParseFareProvider } from "@/lib/providers/parse-fare-provider";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import { WanderuBrowserProvider } from "@/lib/providers/wanderu-browser-provider";
import { createAdminClient } from "@/lib/supabase/admin";

const globalStore = globalThis as unknown as {
  __raildropMemory?: MemoryRepository;
  __raildropMailer?: RecordingMailer;
};

export function getRepository(): RailDropRepository {
  const config = getConfig();
  if (config.isOffline) {
    globalStore.__raildropMemory ??=
      config.isLocal && !config.isE2E
        ? createPersistedMemoryRepository(path.join(process.cwd(), ".data/raildrop-local.json"))
        : new MemoryRepository();
    return globalStore.__raildropMemory;
  }
  return new SupabaseRepository(createAdminClient());
}

/**
 * Live fares only — never invent Amtrak prices.
 * - Local, or no Parse key → Wanderu (browser)
 * - PARSE_API_KEY in cloud → Parse
 */
export function getFareProvider(): FareProvider {
  const config = getConfig();
  if (config.isE2E) {
    return new FixtureFareProvider();
  }
  if (config.parseApiKey && !config.isLocal) {
    return new ParseFareProvider();
  }
  return new WanderuBrowserProvider();
}

export function getMailer(): Mailer {
  const config = getConfig();
  if (config.isOffline) {
    globalStore.__raildropMailer ??= new RecordingMailer();
    return globalStore.__raildropMailer;
  }
  return new ResendMailer();
}

export function getMemoryRepositoryForTests(): MemoryRepository {
  const config = getConfig();
  if (!config.isOffline) {
    throw new Error("Offline memory repository is only available in local or E2E mode");
  }
  return getRepository() as MemoryRepository;
}
