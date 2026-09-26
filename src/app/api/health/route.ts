import { NextResponse } from "next/server";
import { fareProviderStatus } from "@/lib/providers/create-provider";
import { getConfig } from "@/lib/config";
import { getRepository } from "@/lib/services";
import { budgetDecision, budgetPressure, monthStart } from "@/lib/domain/provider-budget";
import { localIsoDate } from "@/lib/domain/timezone";
import { errorDetail, isTransportFailure } from "@/lib/errors";

export async function GET() {
  const config = getConfig();
  const provider = fareProviderStatus();

  // Whether checks are paused is operational truth, not a detail. A board that
  // quietly stops looking reads to a traveler exactly like a corridor with no
  // cheaper fares, so the pause has to be legible from outside the app.
  const day = localIsoDate(new Date(), "UTC");
  let budget: Record<string, unknown> = { known: false };
  /* Reached, not configured.
   *
   * This endpoint used to report databaseConfigured from the presence of two
   * environment variables and ok:true regardless. It stayed green through a
   * total outage — the Supabase project the deployment pointed at had stopped
   * resolving entirely, every write failed, and the health check said the app
   * was fine. A check that cannot go red is not a check.
   *
   * The budget read below is the probe: it is one indexed row and it is on the
   * path everything else uses, so if it comes back the database is genuinely
   * answering. */
  let database: "ok" | "unreachable" | "erroring" | "not-configured" = config.isOffline
    ? "ok"
    : Boolean(config.supabaseUrl && config.supabaseServiceRoleKey)
      ? "unreachable"
      : "not-configured";
  let databaseDetail: string | null =
    database === "not-configured"
      ? "No Supabase URL or service role key is set for this environment."
      : null;
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
    database = "ok";
    databaseDetail = null;
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
  } catch (error) {
    // A health endpoint that fails because the database is unreachable is
    // worse than one that reports what it can — but it must still say so.
    budget = { known: false };
    if (database !== "not-configured") {
      database = isTransportFailure(error) ? "unreachable" : "erroring";
      /* The operator gets the errno and the host they need to go look at.
       *
       * supabase-js flattens the network error into a bare "TypeError: fetch
       * failed" before we ever see it, losing the hostname that undici had on
       * the cause — so the detail names the configured host itself. It is the
       * NEXT_PUBLIC_ URL, already in the client bundle, so this reveals
       * nothing; and it is the single fact that turns "the site is broken" into
       * "that project is gone". */
      databaseDetail = [
        errorDetail(error),
        config.supabaseUrl ? `host ${hostOf(config.supabaseUrl)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }

  const healthy = database === "ok";

  return NextResponse.json(
    {
      ok: healthy,
      app: "raildrop",
      environment: config.nodeEnv,
      checks: {
        application: "ok",
        fareProviderConfigured: provider.configured,
        emailConfigured: Boolean(config.resendApiKey && config.resendFrom),
        /** Whether it answered, not whether it was spelled. */
        database,
        databaseDetail,
        databaseConfigured:
          config.isOffline || Boolean(config.supabaseUrl && config.supabaseAnonKey),
        schedulerConfigured: Boolean(config.cronSecret) || config.isOffline,
        localMode: config.isLocal,
      },
      budget,
    },
    // 503 so anything watching this URL — uptime monitors, a load balancer, a
    // person running curl — finds out without having to read the body.
    { status: healthy ? 200 : 503 },
  );
}

/** Host only. A key is never in a Supabase URL, but a path might be. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}
