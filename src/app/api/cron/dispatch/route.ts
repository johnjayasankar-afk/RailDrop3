import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { dispatchScheduledChecks } from "@/lib/orchestration/dispatcher";
import { getFareProvider, getMailer, getRepository } from "@/lib/services";

function authorized(request: Request): boolean {
  const config = getConfig();
  const header = request.headers.get("authorization");
  const query = new URL(request.url).searchParams.get("secret");
  if (config.isOffline) return true;
  if (!config.cronSecret) return false;
  return header === `Bearer ${config.cronSecret}` || query === config.cronSecret;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await dispatchScheduledChecks({
    repo: getRepository(),
    provider: getFareProvider(),
    mailer: getMailer(),
  });
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return POST(request);
}
