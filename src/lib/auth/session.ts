import { getConfig } from "@/lib/config";
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
    /* Reading the session is not a creation event.
     *
     * This used to upsert a profile row here, stamped `new Date()`. Two things
     * were wrong with that and only one of them is cosmetic. A render that
     * writes is a render that cannot be replayed, and under Cache Components
     * an unstable value in a prerender is an error, not a warning — 107 of
     * them across /watches/[id], /watches/new and /dashboard, every one of
     * them invisible to `next build`, because the branch they came from only
     * runs offline. The field itself had no reader anywhere in the codebase.
     *
     * The profile that matters is written by create-watch, on the path that
     * actually creates something, from a clock it is entitled to read. */
    return { ...(JSON.parse(raw) as SessionUser), isGuest: false };
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
