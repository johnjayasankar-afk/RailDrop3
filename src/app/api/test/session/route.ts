import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";

export async function POST(request: Request) {
  const config = getConfig();
  if (!config.isOffline) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await request.json()) as { email?: string };
  const email = body.email ?? "qa@raildrop.test";
  const user = { id: config.isLocal ? `local-${email}` : "e2e-user", email };
  const response = NextResponse.json({ user });
  const cookieName = config.isLocal ? "raildrop_local_user" : "raildrop_e2e_user";
  response.cookies.set(cookieName, JSON.stringify(user), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
