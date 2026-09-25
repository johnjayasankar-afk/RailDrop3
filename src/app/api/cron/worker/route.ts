import { NextResponse } from "next/server";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { operatorAuthorized } from "@/lib/auth/operator";
import { runLeasedWatch } from "@/lib/orchestration/dispatcher";
import { getFareProvider, getMailer, getRepository } from "@/lib/services";

/**
 * One watch, one invocation, its own budget.
 *
 * This is the half of dispatch that costs money and time: Chromium launches,
 * up to three dated searches, ranking, and possibly an email. Giving it its
 * own function means a corridor that takes three minutes delays nobody else,
 * and the cycle deadline inside runWatchCycle keeps it inside the ceiling.
 */
export const maxDuration = 300;
export const runtime = "nodejs";

const jobSchema = z.object({
  watchId: z.string().min(1),
  runId: z.string().min(1),
});

export async function POST(request: Request) {
  if (!operatorAuthorized(request, getConfig())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let job: z.infer<typeof jobSchema>;
  try {
    job = jobSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "watchId and runId are required" }, { status: 400 });
  }

  const result = await runLeasedWatch({
    repo: getRepository(),
    provider: getFareProvider(),
    mailer: getMailer(),
    watchId: job.watchId,
    runId: job.runId,
  });

  // A failed run is reported as 200 with ok:false: the lease was closed and
  // recorded, which is a successful outcome for this route even when the check
  // itself did not succeed. A 5xx here would invite a retry that the lease
  // machinery already owns.
  return NextResponse.json(result);
}
