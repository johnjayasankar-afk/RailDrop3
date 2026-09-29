import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { operatorAuthorized } from "@/lib/auth/operator";
import { logger } from "@/lib/logger";
import { ProvisionUnavailableError, provisionDatabase } from "@/lib/db/provision";
import { errorDetail } from "@/lib/errors";

/* Nine migrations against a cold Supabase project. The default 10s is not
   enough and a half-applied schema is the state this exists to end. */
export const maxDuration = 300;

/**
 * Apply the schema this app needs.
 *
 *   curl -X POST https://<deployment>/api/admin/setup-database \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Operator-gated, because it runs DDL. It is safe to run more than once —
 * supabase/SETUP_ALL.sql guards every object with `if not exists` and drops
 * each policy before creating it — so re-running it after a partial failure
 * finishes the job rather than erroring on what already exists.
 *
 * GET reports whether this deployment can do it at all, so you can find out
 * without changing anything.
 */
export async function GET(request: Request) {
  const config = getConfig();
  if (!operatorAuthorized(request, config)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const available = Boolean(config.databaseUrl);
  return NextResponse.json({
    available,
    how: available
      ? "POST this URL with the same Authorization header to apply supabase/SETUP_ALL.sql."
      : "Set SUPABASE_DB_URL to the Supabase connection string (Project Settings → Database → " +
        "Connection string, the pooled URI) and redeploy. The service role key cannot run DDL.",
  });
}

export async function POST(request: Request) {
  const config = getConfig();
  if (!operatorAuthorized(request, config)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await provisionDatabase();
    const created = report.after.filter((table) => !report.before.includes(table));
    return NextResponse.json(
      {
        ok: report.ok,
        created,
        alreadyPresent: report.before,
        missing: report.missing,
        failures: report.failures,
        elapsedMs: report.elapsedMs,
        next: report.ok
          ? "Saving a trip should work now. /api/health will report database: ok."
          : "Some objects are still missing. The failures above are verbatim from Postgres.",
      },
      { status: report.ok ? 200 : 500 },
    );
  } catch (error) {
    if (error instanceof ProvisionUnavailableError) {
      // Not a server fault: the deployment is simply not set up to do this.
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    logger.error("db.provision_failed", { detail: errorDetail(error) });
    return NextResponse.json(
      {
        error: "Could not apply the schema. The detail below is verbatim from the database driver.",
        detail: errorDetail(error),
      },
      { status: 503 },
    );
  }
}
