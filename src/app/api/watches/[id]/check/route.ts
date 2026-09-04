import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getFareProvider, getMailer, getRepository } from "@/lib/services";
import { runWatchCycle } from "@/lib/orchestration/check-cycle";

export const maxDuration = 300;

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const repo = getRepository();
  const watch = await repo.getWatch(id);
  if (!watch || watch.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (watch.status !== "ACTIVE") {
    return NextResponse.json({ error: "Watch is not active" }, { status: 409 });
  }
  const result = await runWatchCycle({
    watch,
    trigger: "MANUAL",
    repo,
    provider: getFareProvider(),
    mailer: getMailer(),
  });
  return NextResponse.json(result);
}
