import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { GUEST_COOKIE, parseGuestCookie } from "@/lib/auth/guest";

const PROTECTED = ["/dashboard", "/watches", "/settings"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (!needsAuth) return NextResponse.next();

  // Guest cookie is enough — sign-in is optional.
  if (parseGuestCookie(request.cookies.get(GUEST_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const offline =
    process.env.E2E_TEST === "1" ||
    process.env.RAILDROP_LOCAL === "1" ||
    process.env.NEXT_PUBLIC_RAILDROP_LOCAL === "1";
  if (offline) {
    if (!request.cookies.get("raildrop_e2e_user") && !request.cookies.get("raildrop_local_user")) {
      const login = new URL("/api/auth/guest", request.url);
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // No Supabase — still allow guest watches via cookie mint.
    const login = new URL("/api/auth/guest", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
        }
        response = NextResponse.next({ request });
        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    return response;
  }

  const guest = new URL("/api/auth/guest", request.url);
  guest.searchParams.set("next", pathname);
  return NextResponse.redirect(guest);
}

export const config = {
  matcher: ["/dashboard/:path*", "/dashboard", "/watches/:path*", "/settings"],
};
