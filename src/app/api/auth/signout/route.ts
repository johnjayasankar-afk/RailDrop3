import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { createUserClient } from "@/lib/supabase/server";

export async function POST() {
  const config = getConfig();
  if (!config.isOffline) {
    const supabase = await createUserClient();
    await supabase.auth.signOut();
  }
  const response = NextResponse.redirect(new URL("/", config.appUrl));
  response.cookies.delete("raildrop_e2e_user");
  response.cookies.delete("raildrop_local_user");
  response.cookies.delete("raildrop_guest_user");
  return response;
}
