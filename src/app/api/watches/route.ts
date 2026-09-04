import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getFareProvider, getMailer, getRepository } from "@/lib/services";
import { createWatchAndScan } from "@/lib/watches/create-watch";
import { ProviderNotConfiguredError } from "@/lib/providers/fare-provider";

export const maxDuration = 120;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const watches = await getRepository().listWatchesForUser(user.id);
  return NextResponse.json({ watches });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const watch = await createWatchAndScan({
      userId: user.id,
      email: user.email,
      body,
      repo: getRepository(),
      provider: getFareProvider(),
      mailer: getMailer(),
    });
    return NextResponse.json({ watch }, { status: 201 });
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Could not create watch";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
