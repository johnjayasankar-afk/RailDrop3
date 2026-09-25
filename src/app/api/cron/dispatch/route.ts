import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { operatorAuthorized } from "@/lib/auth/operator";
import { dispatchScheduledChecks } from "@/lib/orchestration/dispatcher";
import { getFareProvider, getMailer, getRepository } from "@/lib/services";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!operatorAuthorized(request, getConfig())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await dispatchScheduledChecks({
    repo: getRepository(),
    provider: getFareProvider(),
    mailer: getMailer(),
  });
  return NextResponse.json(result);
}

/**
 * Vercel Cron issues GET. It carries the same Authorization header, so the
 * delegation is kept — but the header is required on both verbs, and a browser
 * that simply visits this URL now gets 401 rather than triggering a dispatch.
 */
export async function GET(request: Request) {
  return POST(request);
}
