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
import { FallbackFareProvider } from "@/lib/providers/fallback-fare-provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

const globalStore = globalThis as unknown as {
  __raildropMemory?: MemoryRepository;
  __raildropSaidLocal?: boolean;
  __raildropMailer?: RecordingMailer;
  __raildropFareProvider?: FareProvider;
};

export function getRepository(): RailDropRepository {
  const config = getConfig();
  if (config.isOffline) {
    if (config.localByDefault && !globalStore.__raildropSaidLocal) {
      globalStore.__raildropSaidLocal = true;
      // Once, loudly. Falling back is better than refusing to start, but a
      // developer who thinks they are writing to Supabase must not find out
      // from a missing row.
      logger.warn("config.local_by_default", {
        reason: "No NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in this environment",
        using: ".data/raildrop-local.json",
        note: "Set them in .env.local to use Supabase, or RAILDROP_LOCAL=1 to keep this on purpose.",
      });
    }
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
 * Default: Wanderu (works local + Vercel without a Parse key).
 * Optional Parse: set FARE_PROVIDER=parse, or leave a PARSE_API_KEY and Wanderu will
 * fall back to Parse only when Wanderu returns PROVIDER_ERROR.
 */
export function getFareProvider(): FareProvider {
  if (globalStore.__raildropFareProvider) return globalStore.__raildropFareProvider;
  const config = getConfig();
  if (config.isE2E) {
    globalStore.__raildropFareProvider = new FixtureFareProvider();
    return globalStore.__raildropFareProvider;
  }
  const prefer = (process.env.FARE_PROVIDER ?? "").trim().toLowerCase();
  if (prefer === "parse") {
    globalStore.__raildropFareProvider = new ParseFareProvider();
    return globalStore.__raildropFareProvider;
  }
  const wanderu = new WanderuBrowserProvider();
  const parse = config.parseApiKey ? new ParseFareProvider() : null;
  globalStore.__raildropFareProvider = new FallbackFareProvider(wanderu, parse);
  return globalStore.__raildropFareProvider;
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
