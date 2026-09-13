import { NextResponse, type NextRequest } from "next/server";
import {
  GUEST_COOKIE,
  guestCookieOptions,
  mintGuestUser,
  parseGuestCookie,
} from "@/lib/auth/guest";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/watches/new";
  return raw;
}

/** Mint or reuse a guest cookie, then continue to the app — no email required. */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const existing = parseGuestCookie(request.cookies.get(GUEST_COOKIE)?.value);
  const response = NextResponse.redirect(new URL(next, request.url));
  if (!existing) {
    response.cookies.set(GUEST_COOKIE, JSON.stringify(mintGuestUser()), guestCookieOptions());
  }
  return response;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: string; next?: string } | null;
  const next = safeNext(body?.next ?? null);
  const existing = parseGuestCookie(request.cookies.get(GUEST_COOKIE)?.value);
  const user =
    existing ??
    mintGuestUser(typeof body?.email === "string" ? body.email : "");
  if (existing && typeof body?.email === "string" && body.email.trim()) {
    user.email = body.email.trim();
  }
  const response = NextResponse.json({ user });
  response.cookies.set(GUEST_COOKIE, JSON.stringify(user), guestCookieOptions());
  return response;
}
