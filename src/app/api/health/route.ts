import { NextResponse } from "next/server";
import { fareProviderStatus } from "@/lib/providers/create-provider";
import { getConfig } from "@/lib/config";
import { getRepository } from "@/lib/services";
import { budgetDecision, budgetPressure, monthStart } from "@/lib/domain/provider-budget";
import { localIsoDate } from "@/lib/domain/timezone";

export async function GET() {
  const config = getConfig();
  const provider = fareProviderStatus();

  // Whether checks are paused is operational truth, not a detail. A board that
  // quietly stops looking reads to a traveler exactly like a corridor with no
  // cheaper fares, so the pause has to be legible from outside the app.
  const day = localIsoDate(new Date(), "UTC");
  let budget: Record<string, unknown> = { known: false };
  try {
    const repo = getRepository();
    const [today, month] = await Promise.all([
      repo.getUsage(day),
      repo.sumUsage(monthStart(day), day),
    ]);
    const input = {
      searchesToday: today?.requests ?? 0,
      searchesThisMonth: month.requests,
      dailyCap: config.providerDailySearchBudget,
      monthlyCap: config.providerMonthlyCreditBudget,
    };
    const decision = budgetDecision(input);
    const pressure = budgetPressure(input);
    budget = {
      known: true,
      checksPaused: !decision.allow,
      pausedReason: decision.reason,
      scope: decision.scope,
      searchesToday: input.searchesToday,
      searchesThisMonth: input.searchesThisMonth,
      reusedToday: today?.reused ?? 0,
      dailyCap: input.dailyCap,
      monthlyCap: input.monthlyCap,
      nearingLimit: pressure.nearingLimit,
    };
  } catch {
    // A health endpoint that fails because the database is unreachable is
    // worse than one that reports what it can.
    budget = { known: false };
  }

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
    budget,
  });
}
