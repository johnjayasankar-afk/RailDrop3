import { NextResponse } from "next/server";
import { fareProviderStatus } from "@/lib/providers/create-provider";
import { getConfig } from "@/lib/config";

export async function GET() {
  const config = getConfig();
  const provider = fareProviderStatus();
  return NextResponse.json({
    ok: true,
    app: "raildrop",
    environment: config.nodeEnv,
    checks: {
      application: "ok",
      fareProviderConfigured: provider.configured,
      emailConfigured: Boolean(config.resendApiKey && config.resendFrom),
      databaseConfigured: Boolean(config.supabaseUrl && config.supabaseAnonKey),
      schedulerConfigured: Boolean(config.cronSecret) || config.isOffline,
      localMode: config.isLocal,
    },
  });
}
