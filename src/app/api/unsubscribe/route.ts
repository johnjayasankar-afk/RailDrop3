import { NextResponse } from "next/server";
import { getRepository } from "@/lib/services";
import { unsubscribeTokenValid } from "@/lib/notifications/unsubscribe";
import { logger } from "@/lib/logger";
import { routeGuard } from "@/lib/api/respond";

/**
 * RFC 8058 one-click. A mail client POSTs here with no session and no body it
 * expects us to read; it just wants a 2xx and the mail to stop.
 *
 * Deliberately unauthenticated: the signed token in the URL is the
 * authorisation. Requiring a login to stop unwanted mail would defeat the
 * point — the person receiving it may never have had an account.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  return handle(url.searchParams.get("w"), url.searchParams.get("t"));
}

/** Some clients follow the link with GET. Same outcome, same token. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return handle(url.searchParams.get("w"), url.searchParams.get("t"));
}

async function handle(watchId: string | null, token: string | null): Promise<NextResponse> {
  return routeGuard({ route: "/api/unsubscribe" }, () => act(watchId, token));
}

async function act(watchId: string | null, token: string | null): Promise<NextResponse> {
  if (!watchId || !token || !unsubscribeTokenValid(watchId, token)) {
    // Deliberately vague: a precise error would let someone probe which watch
    // ids exist.
    return NextResponse.json({ ok: false, error: "This link is not valid." }, { status: 400 });
  }

  const repo = getRepository();
  const watch = await repo.getWatch(watchId);
  const email = watch?.alertEmail?.trim();
  if (!watch || !email) {
    // Nothing to stop. Still a success: the caller asked for no more mail and
    // there will be none.
    return NextResponse.json({ ok: true, alreadyStopped: true });
  }

  await repo.suppressEmail({
    email,
    reason: "UNSUBSCRIBED",
    watchId,
    detail: "One-click unsubscribe from an alert email.",
  });
  // Clearing the address as well means the watch keeps working on the board
  // for whoever opens it, without ever mailing again. Emptied rather than
  // nulled: the column is non-null, and "" is already how the code spells
  // "no alert email".
  await repo.updateWatch(watchId, { alertEmail: "" });
  logger.info("alert.unsubscribed", { watch_id: watchId });

  return NextResponse.json({ ok: true });
}
