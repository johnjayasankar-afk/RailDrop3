import { NextResponse } from "next/server";
import { appOrigin, getConfig } from "@/lib/config";
import { operatorAuthorized } from "@/lib/auth/operator";
import { dispatchScheduledChecks, runLeasedWatch } from "@/lib/orchestration/dispatcher";
import { getFareProvider, getMailer, getRepository } from "@/lib/services";
import { logger } from "@/lib/logger";

/**
 * Enqueue only. This route runs no fare searches, so it returns in about the
 * time of a few queries rather than dying partway through a sequential loop of
 * 165-second checks — which is what used to burn a slot per unreached watch.
 *
 * 60 seconds is generous for what it does; the old 300 was sized for the work
 * it no longer performs.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const config = getConfig();
  if (!operatorAuthorized(request, config)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const counts = await dispatchScheduledChecks({
    repo: getRepository(),
    invokeWorker: async (job) => {
      // Offline runs have no second function to call, so the work happens
      // inline. In production each watch gets its own invocation and its own
      // 300-second budget, and one slow corridor cannot starve the rest.
      if (config.isOffline) {
        await runLeasedWatch({
          repo: getRepository(),
          provider: getFareProvider(),
          mailer: getMailer(),
          watchId: job.watchId,
          runId: job.runId,
        });
        return;
      }
      await invokeWorkerRoute(job, config.cronSecret);
    },
  });

  return NextResponse.json(counts);
}

/**
 * Hands one watch to the worker route.
 *
 * The response is deliberately not awaited to completion: the worker may take
 * minutes, and this route's job is to hand off, not to wait. The request is
 * awaited far enough to know it was accepted. If even that fails, the lease
 * simply expires and the reaper hands the slot back — a fan-out failure costs
 * a delay, never a missed check.
 */
async function invokeWorkerRoute(
  job: { watchId: string; runId: string },
  cronSecret: string | null,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    await fetch(`${appOrigin()}/api/cron/worker`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}),
      },
      body: JSON.stringify(job),
      signal: controller.signal,
    });
  } catch (error) {
    // An abort here means the worker took longer than the handoff window to
    // respond, which is the expected case for real work — not a failure.
    if (error instanceof Error && error.name === "AbortError") {
      logger.info("dispatcher.worker_handed_off", { run_id: job.runId });
      return;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Vercel Cron issues GET, with the same Authorization header. */
export async function GET(request: Request) {
  return POST(request);
}
