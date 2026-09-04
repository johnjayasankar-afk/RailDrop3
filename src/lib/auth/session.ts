import { getConfig } from "@/lib/config";
import { getMemoryRepositoryForTests } from "@/lib/services";
import { createUserClient } from "@/lib/supabase/server";
import { GUEST_COOKIE, parseGuestCookie } from "@/lib/auth/guest";
import type { Route } from "next";

export interface SessionUser {
  id: string;
  email: string;
  isGuest?: boolean;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const config = getConfig();
  const { cookies } = await import("next/headers");
  const store = await cookies();

  if (config.isOffline) {
    const raw = store.get("raildrop_e2e_user")?.value ?? store.get("raildrop_local_user")?.value;
    if (!raw) {
      return readGuest(store.get(GUEST_COOKIE)?.value);
    }
    const parsed = JSON.parse(raw) as SessionUser;
    const repo = getMemoryRepositoryForTests();
    await repo.upsertProfile({
      id: parsed.id,
      email: parsed.email || "guest@local",
      timezone: "America/New_York",
      createdAt: new Date().toISOString(),
    });
    return { ...parsed, isGuest: false };
  }

  try {
    const supabase = await createUserClient();
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) {
      return { id: data.user.id, email: data.user.email, isGuest: false };
    }
    if (data.user?.id) {
      return { id: data.user.id, email: data.user.email ?? "", isGuest: false };
    }
  } catch {
    // Fall through to guest cookie when Supabase is missing or session is empty.
  }

  return readGuest(store.get(GUEST_COOKIE)?.value);
}

function readGuest(raw: string | undefined): SessionUser | null {
  const guest = parseGuestCookie(raw);
  if (!guest) return null;
  return { id: guest.id, email: guest.email, isGuest: true };
}

/** Send unauthenticated visitors through guest mint, then back to the page. */
export function guestEntryHref(nextPath: string): Route {
  const next = nextPath.startsWith("/") ? nextPath : "/watches/new";
  return `/api/auth/guest?next=${encodeURIComponent(next)}` as Route;
}
