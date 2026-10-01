import { createHash, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "@/lib/config";

/* The operator credential.
 *
 * One endpoint does work that costs money without a user asking for it: the
 * live provider probe, which launches Chromium and runs a real search. It is
 * gated on CRON_SECRET, presented as `Authorization: Bearer <secret>`. The
 * cron dispatcher used the same gate and is gone with the watch feature.
 *
 * This is all that survives of src/lib/auth. There are no accounts, no
 * sessions and no guests any more — the product reads public fares and asks
 * nobody who they are. What is left is not user auth; it is a key on the one
 * door that spends money.
 *
 * Header only. The query-string form this used to accept put the secret into
 * Vercel's access logs, into any Referer sent onward, and into the history of
 * every browser it was pasted into. Vercel Cron sends the header, so nothing
 * needed the query form.
 */
export function operatorAuthorized(request: Request, config: AppConfig): boolean {
  // Local and E2E runs have no secret to present. getConfig() refuses to
  // produce either flag in production, so this cannot open a deployed app.
  if (config.isOffline) return true;
  if (!config.cronSecret) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;
  return constantTimeEquals(header, `Bearer ${config.cronSecret}`);
}

/**
 * A plain `===` on a secret returns sooner the earlier it differs, which is
 * enough to recover it byte by byte from an endpoint that can be called
 * repeatedly. Comparing fixed-width digests keeps the timing flat and avoids
 * timingSafeEqual's throw on length mismatch — which would itself leak length.
 */
function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
