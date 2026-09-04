import { getConfig } from "@/lib/config";
import { getMemoryRepositoryForTests } from "@/lib/services";
import { createUserClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const config = getConfig();
  if (config.isOffline) {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const raw = store.get("raildrop_e2e_user")?.value ?? store.get("raildrop_local_user")?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUser;
    const repo = getMemoryRepositoryForTests();
    await repo.upsertProfile({
      id: parsed.id,
      email: parsed.email,
      timezone: "America/New_York",
      createdAt: new Date().toISOString(),
    });
    return parsed;
  }

  try {
    const supabase = await createUserClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user?.email) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}
