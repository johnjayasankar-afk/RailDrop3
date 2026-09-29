import { NextResponse } from "next/server";
import { fareProviderStatus } from "@/lib/providers/create-provider";
import { getConfig } from "@/lib/config";
import { getRepository } from "@/lib/services";
import { budgetDecision, budgetPressure, monthStart } from "@/lib/domain/provider-budget";
import { localIsoDate } from "@/lib/domain/timezone";
import { databaseDiagnosis, errorDetail, isTransportFailure } from "@/lib/errors";
import type { DatabaseFault } from "@/lib/db/diagnosis";

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
  const configured =
    config.isOffline || Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
  let database: "ok" | "unreachable" | "erroring" | "not-configured" = config.isOffline
    ? "ok"
    : configured
      ? "unreachable"
      : "not-configured";
  let databaseDetail: string | null =
    database === "not-configured"
      ? "No Supabase URL or service role key is set for this environment."
      : null;
  /** Which of the six causes, so this can be read without interpreting prose. */
  let fault: DatabaseFault = config.isOffline ? "ok" : configured ? "unknown" : "not-configured";
  /** Whether anything is served by waiting. False means a person has to act. */
  let retryWorks = false;
  let remedy: string | null = configured
    ? null
    : "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY for this environment, then redeploy.";
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
    fault = "ok";
    retryWorks = false;
    remedy = null;
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
    /* The same classifier the reader's message comes from.
     *
     * This endpoint used to reach its own verdict — transport failure or not —
     * while src/lib/errors.ts reached a different one for the same error, so
     * the page could say "try again in a minute" while the health check said
     * "erroring", and neither named the cause. One classifier means the
     * sentence a traveler reads and the JSON an operator curls cannot
     * disagree about what is wrong.
     *
     * The operator also gets the errno and the host. supabase-js flattens the
     * network error into a bare "TypeError: fetch failed" before we ever see
     * it, losing the hostname undici had on the cause — so the detail names
     * the configured host itself. It is the NEXT_PUBLIC_ URL, already in the
     * client bundle, so this reveals nothing; and it is the single fact that
     * turns "the site is broken" into "that project is gone". */
    const verdict = databaseDiagnosis(error, configured);
    fault = verdict.fault;
    retryWorks = verdict.retryWorks;
    remedy = verdict.operatorHint;
    database =
      verdict.fault === "not-configured"
        ? "not-configured"
        : isTransportFailure(error) || verdict.fault === "refused"
          ? "unreachable"
          : "erroring";
    databaseDetail = [
      errorDetail(error),
      config.supabaseUrl ? `host ${hostOf(config.supabaseUrl)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
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
        /** Which cause, and whether waiting helps. The remedy is the fix. */
        databaseFault: fault,
        databaseRetryWorks: retryWorks,
        databaseRemedy: remedy,
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
