export const GUEST_COOKIE = "raildrop_guest_user";

export type GuestCookieUser = {
  id: string;
  email: string;
  isGuest: true;
};

export function parseGuestCookie(raw: string | undefined | null): GuestCookieUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; email?: unknown };
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    return {
      id: parsed.id,
      email: typeof parsed.email === "string" ? parsed.email : "",
      isGuest: true,
    };
  } catch {
    return null;
  }
}

export function mintGuestUser(email = ""): GuestCookieUser {
  return {
    id: crypto.randomUUID(),
    email: email.trim(),
    isGuest: true,
  };
}

export function guestCookieOptions(maxAgeSeconds = 60 * 60 * 24 * 400) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
    secure: process.env.NODE_ENV === "production",
  };
}
