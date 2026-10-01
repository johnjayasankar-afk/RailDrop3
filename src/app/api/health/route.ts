import { NextResponse, connection } from "next/server";
import { getConfig } from "@/lib/config";
import { fareProviderStatus } from "@/lib/providers/create-provider";

/* What can be wrong, now that there is only one thing that can be wrong.
 *
 * This route used to dial Supabase, classify the failure into one of six
 * database faults and report which. There is no database: the product reads
 * live fares and renders them, and the only dependency that can be down is
 * the fare provider. Reporting on things that no longer exist is how a
 * health check becomes decoration.
 */
export async function GET() {
  /* Cache Components refuses a route segment config, and this answer must
     not be baked into the shell: it reports what THIS deployment has
     configured right now. connection() is how a route says that. */
  await connection();
  const config = getConfig();
  const provider = fareProviderStatus();
  return NextResponse.json({
    ok: true,
    app: "raildrop",
    environment: config.isLocal ? "local" : "production",
    checks: {
      application: "ok",
      fareProvider: provider.provider,
      fareProviderConfigured: provider.configured,
      /* Stated because it changes what every price on the site means: in
         fixture mode the fares are canned, and a health check that did not
         say so would let a test deployment look like a live one. */
      fixtures: config.isE2E,
    },
  });
}
